"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { persistMessage, getFavorites, toggleFavoriteAPI, getOffers } from "@/lib/dataService";
import { subscribeToMessages, subscribeToNotifications, supabase } from "@/lib/supabase";
import { ORDER_STATES } from "@/lib/orderStates";

/* ──────────────────────────────────────────────────────────────────────────
   AppContext — Estado global de Colecciona
   Gestiona: carrito, favoritos, notificaciones, mensajes, ofertas
   ────────────────────────────────────────────────────────────────────────── */

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // ── Session ──
  // Supabase Auth is the source of truth. localStorage is fallback for demo only.
  const [session, setSession] = useState(null);
  const prevSessionIdRef = useRef(null);

  // Initialize session from Supabase Auth on mount
  useEffect(() => {
    if (!supabase) {
      // Demo mode: fall back to localStorage
      try {
        const stored = localStorage.getItem("colecciona_session");
        if (stored) setSession(JSON.parse(stored));
      } catch {}
      return;
    }

    // Get current session from Supabase
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
    });

    // Listen for auth changes (login, logout, token refresh, other tabs)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Cart ── (per-user, loaded lazily after session is known)
  const [cart, setCart] = useState([]);

  // Load cart for current user when session changes
  const cartLoadedRef = useRef(null);
  useEffect(() => {
    const userId = session?.id || session?.user?.id || "guest";
    if (cartLoadedRef.current === userId) return;
    cartLoadedRef.current = userId;
    try {
      const stored = localStorage.getItem(`colecciona_cart_${userId}`);
      setCart(stored ? JSON.parse(stored) : []);
    } catch {
      setCart([]);
    }
  }, [session]);

  // ── Favorites / Wishlist ──
  const [favorites, setFavorites] = useState(() => {
    try {
      const stored = localStorage.getItem("colecciona_favorites");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  }); // Set of product ids

  // Migrate favorites to per-user storage (re-runs per user login)
  useEffect(() => {
    const userId = session?.id || session?.user?.id;
    if (!userId) return;
    try {
      const globalKey = "colecciona_favorites";
      const userKey = `colecciona_favorites_${userId}`;
      const userStored = localStorage.getItem(userKey);
      const globalStored = localStorage.getItem(globalKey);
      if (userStored) {
        setFavorites(new Set(JSON.parse(userStored)));
      } else if (globalStored) {
        const globalFavs = JSON.parse(globalStored);
        if (globalFavs.length > 0) {
          localStorage.setItem(userKey, JSON.stringify(globalFavs));
          setFavorites(new Set(globalFavs));
        }
        localStorage.removeItem(globalKey);
      } else {
        // No favorites for this user yet — ensure a clean state
        setFavorites(new Set());
      }
    } catch {
      setFavorites(new Set());
    }
  }, [session?.id, session?.user?.id]);

  // ── Notifications ──
  const [notifications, setNotifications] = useState([]);

  // ── Messages / Chat threads ──
  const [threads, setThreads] = useState([]);

  // ── Offers (ofertas de precio) ──
  const [offers, setOffers] = useState([]);

  // ── Orders (pedidos) ──
  const [orders, setOrders] = useState([]);

  // ── My Sales (mis ventas) ──
  const [sales, setSales] = useState([]);

  // ── Toast Queue ──
  const [toasts, setToasts] = useState([]);

  // ─────────────────────────────────────────────────────────────
  // Clear all private state on logout / user change
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const currentId = session?.id || session?.user?.id || null;

    // Detect user change (logout or different user login)
    if (prevSessionIdRef.current && prevSessionIdRef.current !== currentId) {
      setThreads([]);
      setNotifications([]);
      setOffers([]);
      setOrders([]);
      setSales([]);
      setFavorites(new Set()); // clear old user's favorites (reloaded by migration effect)
      setCart([]); // clear old user's cart (reloaded by cart lazy-load effect)
    }
    prevSessionIdRef.current = currentId;
  }, [session]);

  // ─────────────────────────────────────────────────────────────
  // Fetch notifications from API & subscribe to realtime
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!(session?.user?.id || session?.id)) return;

    let cancelled = false;

    // Fetch existing notifications
    const fetchNotifications = async () => {
      try {
        const token = session?.access_token;
        if (!token) return;
        const res = await fetch("/api/notifications", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!cancelled && data.notifications?.length) {
          setNotifications(data.notifications.map((n) => ({
            id: n.id,
            type: n.type,
            read: n.read,
            title: n.title,
            body: n.body,
            icon: n.type === "favorite" ? "heart" : n.type === "message" ? "chart" : n.type === "offer" ? "offer" : "package",
            time: n.created_at,
            link: n.link || "#",
          })));
        }
      } catch (e) {
        console.warn("[AppContext] Notifications fetch error:", e?.message);
      }
    };
    fetchNotifications();
    const unsubNotifs = subscribeToNotifications(session?.user?.id || session?.id, (notif) => {
      if (cancelled) return;
      setNotifications((prev) => [
        {
          id: notif.id,
          type: notif.type,
          read: notif.read,
          title: notif.title,
          body: notif.body,
          icon: notif.type === "favorite" ? "heart" : notif.type === "message" ? "chart" : notif.type === "offer" ? "offer" : "package",
          time: notif.created_at,
          link: notif.link || "#",
        },
        ...prev,
      ]);
    });

    return () => {
      cancelled = true;
      unsubNotifs();
    };
  }, [session]);

  // ─────────────────────────────────────────────────────────────
  // Messages: load from server + realtime
  // ─────────────────────────────────────────────────────────────
  // Load threads from server on mount
  useEffect(() => {
    if (!(session?.user?.id || session?.id)) {
      setThreads([]);
      return;
    }

    let cancelled = false;

    const loadThreads = async () => {
      try {
        const token = session?.access_token;
        if (!token) return;
        const res = await fetch("/api/threads", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!cancelled && data.threads) setThreads(data.threads);
      } catch (err) {
        console.warn("[AppContext] Error loading threads:", err);
      }
    };
    loadThreads();

    return () => { cancelled = true; };
  }, [session]);

  // Subscribe to realtime incoming messages
  useEffect(() => {
    if (!(session?.user?.id || session?.id)) return;

    const unsub = subscribeToMessages(session?.user?.id || session?.id, (msg) => {
      // Ignore own messages (already added optimistically)
      if (msg.sender_id === (session?.user?.id || session?.id)) return;

      setThreads((prev) => {
        const partnerId = msg.sender_id;
        const threadKey = `th-${partnerId}-${msg.product_id || "g"}`;

        const thread = prev.find((t) => t.id === threadKey);

        if (thread) {
          // Deduplicate: skip if message already exists
          if (thread.messages.some((m) => m.id === msg.id)) return prev;

          return prev.map((t) =>
            t.id === threadKey
              ? {
                  ...t,
                  messages: [...t.messages, { id: msg.id, from: partnerId, text: msg.text, time: msg.created_at }],
                  lastMessage: msg.text,
                  lastTime: msg.created_at || new Date().toISOString(),
                  unread: t.unread + 1,
                }
              : t
          );
        }

        // Thread doesn't exist — create it
        const newThread = {
          id: threadKey,
          partnerId,
          productId: msg.product_id || null,
          partner: { id: partnerId, name: "Usuario" },
          product: null,
          messages: [{ id: msg.id, from: partnerId, text: msg.text, time: msg.created_at }],
          lastMessage: msg.text,
          lastTime: msg.created_at || new Date().toISOString(),
          unread: 1,
        };
        return [newThread, ...prev];
      });
    });

    return () => unsub();
  }, [session]);

  // ─────────────────────────────────────────────────────────────
  // Load favorites from server when session is available
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    getFavorites().then((ids) => {
      if (!cancelled && ids && ids.length > 0) {
        setFavorites((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.add(id));
          return next;
        });
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [session]);

  // ─────────────────────────────────────────────────────────────
  // Load offers from server when session is available
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    getOffers().then((list) => {
      if (!cancelled && list.length) {
        setOffers(list.map((o) => ({
          id: o.id,
          productId: o.product_id,
          product: o.product,
          fromUser: o.from_user || { id: o.from_user_id },
          toUser: o.to_user || { id: o.to_user_id },
          amount: o.amount,
          originalPrice: o.original_price,
          status: o.status,
          direction: o.direction,
          message: o.message,
          createdAt: o.created_at,
        })));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [session]);

  // ─────────────────────────────────────────────────────────────
  // Persist cart in localStorage (per-user)
  useEffect(() => {
    try {
      const userId = session?.id || session?.user?.id || "guest";
      localStorage.setItem(`colecciona_cart_${userId}`, JSON.stringify(cart));
    } catch {}
  }, [cart, session]);

  // ─────────────────────────────────────────────────────────────
  // Persist favorites locally per user
  useEffect(() => {
    try {
      const key = (session?.user?.id || session?.id) ? `colecciona_favorites_${session?.user?.id || session?.id}` : "colecciona_favorites";
      localStorage.setItem(key, JSON.stringify([...favorites]));
    } catch {}
  }, [favorites, session]);

  // ─────────────────────────────────────────────────────────────
  // Toast helpers
  // ─────────────────────────────────────────────────────────────
  const toastCounterRef = useRef(0);
  const showToast = useCallback((message, type = "info") => {
    const id = `${Date.now()}-${++toastCounterRef.current}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    const timer = setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
    return () => clearTimeout(timer);
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Auth token helper
  // ─────────────────────────────────────────────────────────────
  const getToken = useCallback(() => session?.access_token || null, [session]);

  // ─────────────────────────────────────────────────────────────
  // Cart helpers
  // ─────────────────────────────────────────────────────────────
  const addToCart = useCallback((product, shippingMethod) => {
    setCart((prev) => {
      const exists = prev.find((i) => i.product.id === product.id);
      if (exists) return prev;
      return [...prev, { product, shippingMethod, qty: 1 }];
    });
    showToast(`"${product.title}" añadido a la cesta`, "success");
  }, [showToast]);

  const removeFromCart = useCallback((productId) => {
    setCart((prev) => prev.filter((i) => i.product.id !== productId));
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const cartTotal = cart.reduce(
    (acc, item) => ({
      subtotal: acc.subtotal + item.product.price,
      shipping: acc.shipping + (item.shippingMethod?.price || 1.8),
      commission: acc.commission + item.product.price * 0.08,
    }),
    { subtotal: 0, shipping: 0, commission: 0 }
  );
  cartTotal.total = cartTotal.subtotal + cartTotal.shipping + cartTotal.commission;

  // ─────────────────────────────────────────────────────────────
  // Favorites helpers
  // ─────────────────────────────────────────────────────────────
  const toggleFavorite = useCallback(async (productId) => {
    const wasFavorited = favorites.has(productId);

    // Optimistic update
    setFavorites((prev) => {
      const next = new Set(prev);
      if (wasFavorited) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
    showToast(wasFavorited ? "Eliminado de favoritos" : "Añadido a favoritos ♥", "success");

    // Sync with server
    try {
      const result = await toggleFavoriteAPI(productId);
      if (result !== null && result !== undefined) {
        // Server confirmed — reconcile if different from optimistic
        setFavorites((prev) => {
          const next = new Set(prev);
          if (result) {
            next.add(productId);
          } else {
            next.delete(productId);
          }
          return next;
        });
      }
    } catch {
      // Rollback on failure
      setFavorites((prev) => {
        const next = new Set(prev);
        if (wasFavorited) {
          next.add(productId);
        } else {
          next.delete(productId);
        }
        return next;
      });
      showToast("Error al actualizar favorito", "error");
    }
  }, [favorites, showToast]);

  // ─────────────────────────────────────────────────────────────
  // Notifications helpers
  // ─────────────────────────────────────────────────────────────
  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    const token = session?.access_token;
    if (!token) return;
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
  }, [session]);

  const markRead = useCallback((id) => {
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    const token = session?.access_token;
    if (!token) return;
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }, [session]);

  // ─────────────────────────────────────────────────────────────
  // Offers helpers
  // ─────────────────────────────────────────────────────────────
  const makeOffer = useCallback(async (productId, amount, message) => {
    const token = getToken();
    if (!token) {
      showToast("No autenticado", "error");
      return null;
    }

    try {
      const res = await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ productId, amount, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al crear oferta");

      const o = data.offer;
      const newOffer = {
        id: o.id,
        productId: o.product_id,
        product: null,
        fromUser: { id: o.from_user_id },
        toUser: { id: o.to_user_id },
        amount: o.amount,
        originalPrice: o.original_price,
        status: o.status,
        direction: "sent",
        message: o.message,
        createdAt: o.created_at,
      };

      setOffers((prev) => [newOffer, ...prev]);
      showToast(`Oferta de ${amount.toFixed(2)} € enviada`, "success");
      return newOffer;
    } catch (err) {
      showToast(err.message || "Error al enviar oferta", "error");
      return null;
    }
  }, [session, getToken, showToast]);

  const respondToOffer = useCallback(async (offerId, action) => {
    const token = getToken();
    if (!token) {
      showToast("No autenticado", "error");
      return false;
    }

    try {
      const res = await fetch(`/api/offers/${offerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al actualizar oferta");

      const result = data.result;

      setOffers((prev) =>
        prev.map((o) => o.id === offerId ? { ...o, status: result.status } : o)
      );

      const labels = { accepted: "Oferta aceptada ✓", rejected: "Oferta rechazada" };
      showToast(labels[result.status] || "Oferta actualizada", result.status === "accepted" ? "success" : "info");
      return true;
    } catch (err) {
      showToast(err.message || "Error al actualizar oferta", "error");
      return false;
    }
  }, [session, getToken, showToast]);

  // ── Contraofertas ──
  const counterOffer = useCallback(async (offerId, amount, message = "") => {
    const token = getToken();
    if (!token) {
      showToast("No autenticado", "error");
      return null;
    }

    try {
      const res = await fetch(`/api/offers/${offerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "counter", amount, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al enviar contraoferta");

      const result = data.result;
      const orig = result.original_offer;
      const newOffer = result.new_offer;

      // Use statuses from server, not assumptions
      setOffers((prev) => {
        const updated = prev.map((o) =>
          o.id === offerId ? { ...o, status: orig.status } : o
        );
        const mapped = {
          id: newOffer.id,
          productId: newOffer.product_id,
          product: null,
          fromUser: { id: newOffer.from_user_id },
          toUser: { id: newOffer.to_user_id },
          amount: newOffer.amount,
          originalPrice: newOffer.original_price,
          status: newOffer.status,
          direction: "sent",
          message: newOffer.message,
          createdAt: newOffer.created_at,
        };
        return [mapped, ...updated];
      });

      showToast(`Contraoferta de ${amount.toFixed(2)} € enviada`, "success");
      return result;
    } catch (err) {
      showToast(err.message || "Error al enviar contraoferta", "error");
      return null;
    }
  }, [session, getToken, showToast]);

  // ─────────────────────────────────────────────────────────────
  // Messages helpers
  // ─────────────────────────────────────────────────────────────
  const markThreadRead = useCallback((threadId) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, unread: 0 } : t))
    );
  }, []);

  const startThread = useCallback((partner, product) => {
    const partnerId = partner?.id || partner?.userId;
    const productId = product?.id;
    if (!partnerId) return null;
    const threadId = `th-${partnerId}-${productId || "g"}`;

    setThreads((prev) => {
      const exists = prev.find((t) => t.id === threadId);
      if (exists) return prev;
      return [
        {
          id: threadId,
          partnerId,
          productId: productId || null,
          partner: {
            id: partnerId,
            name: partner?.name || partner?.username || "Vendedor",
            username: partner?.username,
            verified: partner?.verified,
          },
          product: productId
            ? { id: productId, title: product?.title || "Anuncio", image: product?.image || "", price: product?.price || 0 }
            : null,
          messages: [],
          lastMessage: "",
          lastTime: "",
          unread: 0,
        },
        ...prev,
      ];
    });
    return threadId;
  }, []);

  const deleteThread = useCallback((threadId) => {
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
  }, []);

  const sendMessage = useCallback((threadId, text) => {
    if (!text?.trim()) return;

    // Find thread via functional state to avoid stale closure
    let receiverId = null;
    let productId = null;

    setThreads((prev) => {
      const thread = prev.find((t) => t.id === threadId);
      if (!thread) return prev;
      receiverId = thread.partnerId || thread.partner?.id;
      productId = thread.productId || thread.product?.id || null;
      return prev;
    });

    if (!receiverId) {
      showToast("No se pudo enviar: receptor no encontrado", "error");
      return;
    }

    const msgId = `m${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date().toISOString();

    // Optimistic add
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: [...t.messages, { id: msgId, from: "me", text, time: timestamp, status: "sending" }],
              lastMessage: text,
              lastTime: timestamp,
              unread: 0,
            }
          : t
      )
    );

    // Send to server
    persistMessage({
      senderId: session?.user?.id || session?.id,
      receiverId,
      productId,
      text,
    }).then((result) => {
      // Reconcile: replace optimistic message with server message
      const serverId = result?.messageId;
      const serverTime = result?.createdAt || timestamp;
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? {
                ...t,
                messages: t.messages.map((m) =>
                  m.id === msgId
                    ? { ...m, id: serverId || msgId, time: serverTime, status: "sent" }
                    : m
                ),
              }
            : t
        )
      );
    }).catch(() => {
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? {
                ...t,
                messages: t.messages.map((m) =>
                  m.id === msgId ? { ...m, status: "failed" } : m
                ),
              }
            : t
        )
      );
      showToast("Error al enviar mensaje", "error");
    });
  }, [session, showToast]);

  // ─────────────────────────────────────────────────────────────
  // Orders helpers
  // ─────────────────────────────────────────────────────────────
  const confirmReceived = useCallback(async (orderId) => {
    try {
      const token = session?.access_token;
      if (!token) throw new Error("No autenticado");
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: "COMPLETED" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOrders((prev) =>
        prev.map((o) => o.id === orderId ? { ...o, status: "COMPLETED", confirmedAt: new Date().toISOString() } : o)
      );
      showToast("¡Recepción confirmada! Valoración disponible.", "success");
    } catch (err) {
      showToast(err.message || "Error al confirmar recepción", "error");
    }
  }, [session, showToast]);

  const markSaleShipped = useCallback(async (saleId, trackingCode) => {
    try {
      const token = session?.access_token;
      if (!token) throw new Error("No autenticado");
      const res = await fetch(`/api/orders/${saleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: "SHIPPED", tracking_code: trackingCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSales((prev) =>
        prev.map((s) => s.id === saleId ? { ...s, status: "SHIPPED", trackingCode } : s)
      );
      showToast("Envío marcado como enviado", "success");
    } catch (err) {
      showToast(err.message || "Error al marcar envío", "error");
    }
  }, [session, showToast]);

  const checkout = useCallback(async (address, paymentMethod) => {
    try {
      const token = session?.access_token;
      if (!token) throw new Error("No autenticado");

      const productIds = cart.map((item) => item.product.id).filter(Boolean);
      if (productIds.length === 0) throw new Error("Carrito vacío");

      // Single endpoint: reserve → order → Stripe
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          productIds,
          shippingMethod: cart[0]?.shippingMethod?.id || "standard",
          shippingAddress: address,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      clearCart();
      showToast("¡Pedido realizado! Procesando pago...", "success");
      return { orderId: data.orderId, clientSecret: data.clientSecret };
    } catch (err) {
      showToast(err.message || "Error al procesar el pedido", "error");
      return null;
    }
  }, [session, cart, clearCart, showToast]);

  // ─────────────────────────────────────────────────────────────
  // Reviews
  // ─────────────────────────────────────────────────────────────
  const [reviews, setReviews] = useState([]);

  const addReview = useCallback(async (orderId, targetUserId, rating, comment) => {
    try {
      const token = session?.access_token;
      if (!token) throw new Error("No autenticado");
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId, rating, comment }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOrders((prev) =>
        prev.map((o) => o.id === orderId ? { ...o, reviewed: true } : o)
      );
      showToast("¡Valoración enviada! Gracias.", "success");
    } catch (err) {
      showToast(err.message || "Error al enviar valoración", "error");
    }
  }, [session, showToast]);

  const getReviewsForUser = useCallback((userId) => {
    return reviews.filter((r) => r.targetUserId === userId);
  }, [reviews]);

  // ─────────────────────────────────────────────────────────────

  const value = {
    // session
    session, setSession,
    // cart
    cart, addToCart, removeFromCart, clearCart, cartTotal,
    // favorites
    favorites, toggleFavorite,
    // notifications
    notifications, unreadCount, markAllRead, markRead,
    // toasts
    toasts, showToast,
    // messages
    threads, sendMessage, markThreadRead, startThread, deleteThread,
    // offers
    offers, makeOffer, respondToOffer, counterOffer,
    // orders
    orders, confirmReceived, checkout,
    // sales
    sales, markSaleShipped,
    // reviews
    reviews, addReview, getReviewsForUser,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
