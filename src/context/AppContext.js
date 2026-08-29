"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { products, users } from "@/data/mockData";
import { persistMessage, getFavorites, toggleFavoriteAPI, notifyUser, getOffers, createOffer, updateOffer, sendPush } from "@/lib/dataService";
import { subscribeToMessages, subscribeToNotifications } from "@/lib/supabase";

/* ──────────────────────────────────────────────────────────────────────────
   AppContext — Estado global de Colecciona
   Gestiona: carrito, favoritos, notificaciones, mensajes, ofertas
   ────────────────────────────────────────────────────────────────────────── */

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // ── Session ──
  const [session, setSession] = useState(null);

  // ── Cart ──
  const [cart, setCart] = useState(() => {
    try {
      const stored = localStorage.getItem("colecciona_cart");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }); // [{product, qty, shippingMethod}]

  // ── Favorites / Wishlist ──
  const [favorites, setFavorites] = useState(() => {
    try {
      const stored = localStorage.getItem("colecciona_favorites");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  }); // Set of product ids

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
  // Load session on mount
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem("colecciona_session");
      if (stored) setSession(JSON.parse(stored));
    } catch {}
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Fetch notifications from API & subscribe to realtime
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session?.id) return;

    // Fetch existing notifications
    const fetchNotifications = async () => {
      try {
        const token = session?.access_token || session?.accessToken;
        if (!token) return;
        const res = await fetch("/api/notifications", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.notifications?.length) {
          setNotifications((prev) => {
            const mockIds = new Set(prev.filter((n) => n.id.startsWith("n")).map((n) => n.id));
            const serverNotifs = data.notifications.map((n) => ({
              id: n.id,
              type: n.type,
              read: n.read,
              title: n.title,
              body: n.body,
              icon: n.type === "favorite" ? "heart" : n.type === "message" ? "chart" : n.type === "offer" ? "offer" : "package",
              time: n.created_at,
              link: n.link || "#",
            }));
            return [...serverNotifs, ...prev.filter((n) => !mockIds.has(n.id))];
          });
        }
      } catch {}
    };
    fetchNotifications();

    // Subscribe to realtime notifications
    const unsubNotifs = subscribeToNotifications(session.id, (notif) => {
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

    return () => unsubNotifs();
  }, [session]);

  // ─────────────────────────────────────────────────────────────
  // Subscribe to realtime incoming messages
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session?.id) return;

    const unsub = subscribeToMessages(session.id, (msg) => {
      setThreads((prev) => {
        const thread = prev.find(
          (t) =>
            t.participants?.includes(msg.sender_id) &&
            t.productId === msg.product_id
        );
        if (thread) {
          return prev.map((t) =>
            t.id === thread.id
              ? {
                  ...t,
                  messages: [
                    ...t.messages,
                    { id: msg.id, from: msg.sender_id, text: msg.text, time: msg.created_at },
                  ],
                  lastMessage: msg.text,
                  lastTime: new Date().toISOString(),
                  unread: t.unread + 1,
                }
              : t
          );
        }
        return prev;
      });
    });

    return () => unsub();
  }, [session]);

  // --- Hilos de mensajes persistentes y semillas para pruebas ---
  useEffect(() => {
    if (!session?.id) {
      setThreads([]);
      return;
    }
    const key = `colecciona_threads_${session.id}`;
    let storedThreads = [];
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        storedThreads = JSON.parse(stored);
      }
    } catch (e) {
      console.error("[AppContext] Error al leer hilos de localStorage:", e);
    }

    const username = (session.username || "").toLowerCase();
    const email = (session.email || "").toLowerCase();
    const isCuenta2 = username.includes("cuenta2") || email.includes("cuenta2");

    if (storedThreads.length === 0 && (isCuenta2 || username === "cuenta2")) {
      // Sembramos conversaciones de prueba detalladas
      storedThreads = [
        {
          id: `th-u1-p1`,
          partner: {
            id: "u1",
            name: "Carlos Ruiz Gómez",
            username: "cruiz_tcg",
            verified: true,
          },
          product: {
            id: "p1",
            title: "Charizard Holo 1ª Edición",
            image: "/images/cards/fire-phoenix.png",
            price: 150.00,
          },
          messages: [
            { id: "m-init-1", from: "u1", text: "¡Hola! ¿Te interesa el Charizard? Sigue disponible.", time: "18:24" },
            { id: "m-init-2", from: "me", text: "Hola, sí. ¿Haces envíos certificados?", time: "18:25" },
            { id: "m-init-3", from: "u1", text: "Sí, claro, siempre envío protegido en toploader y con código de seguimiento.", time: "18:27" },
          ],
          lastMessage: "Sí, claro, siempre envío protegido en toploader y con código de seguimiento.",
          lastTime: new Date(Date.now() - 3600000).toISOString(),
          unread: 1,
        },
        {
          id: `th-u6-p2`,
          partner: {
            id: "u6",
            name: "Elena Costa Marín",
            username: "elena_magic",
            verified: true,
          },
          product: {
            id: "p2",
            title: "Aethelred The Celestial Dragon",
            image: "/images/cards/dragon.png",
            price: 95.50,
          },
          messages: [
            { id: "m-init-4", from: "me", text: "Buenas, ¿el precio es negociable?", time: "17:10" },
            { id: "m-init-5", from: "u6", text: "Hola. Podría dejarlo en 90€ si te quedas alguna otra carta de mi perfil.", time: "17:15" },
          ],
          lastMessage: "Hola. Podría dejarlo en 90€ si te quedas alguna otra carta de mi perfil.",
          lastTime: new Date(Date.now() - 7200000).toISOString(),
          unread: 0,
        },
        {
          id: `th-u2-normal`,
          partner: {
            id: "u2",
            name: "Lucía Fernández Ramos",
            username: "lucia_cards",
            verified: true,
          },
          product: null,
          messages: [
            { id: "m-init-6", from: "u2", text: "¡Hola! Vi que estabas buscando cromos de la colección de fútbol de 2024. Tengo bastantes repetidos.", time: "16:00" },
            { id: "m-init-7", from: "me", text: "¡Hola! Sí, me faltan los de la última página. ¿Tienes la lista?", time: "16:05" },
            { id: "m-init-8", from: "u2", text: "Sí, pásame tus faltas por aquí y te digo cuáles tengo.", time: "16:10" },
          ],
          lastMessage: "Sí, pásame tus faltas por aquí y te digo cuáles tengo.",
          lastTime: new Date(Date.now() - 14400000).toISOString(),
          unread: 1,
        },
        {
          id: `th-u5-p6`,
          partner: {
            id: "u5",
            name: "Alejandro Gómez Blanco",
            username: "alex_tcg",
            verified: true,
          },
          product: {
            id: "p6",
            title: "Ignis Blazing Phoenix Secret Rare",
            image: "/images/cards/fire-phoenix.png",
            price: 85.00,
          },
          messages: [
            { id: "m-init-9", from: "u5", text: "Hola, ya he realizado el envío de la carta. Debería llegarte en 2 días.", time: "Ayer" },
            { id: "m-init-10", from: "me", text: "Perfecto, muchas gracias. En cuanto llegue te aviso.", time: "Ayer" },
          ],
          lastMessage: "Perfecto, muchas gracias. En cuanto llegue te aviso.",
          lastTime: new Date(Date.now() - 86400000).toISOString(),
          unread: 0,
        },
        {
          id: `th-u3-normal`,
          partner: {
            id: "u3",
            name: "Miguel Ángel Torres",
            username: "miguel_collector",
            verified: false,
          },
          product: null,
          messages: [
            { id: "m-init-11", from: "me", text: "Hola Miguel, ¿sigues teniendo el álbum completo de Magic?", time: "Hace 2 días" },
            { id: "m-init-12", from: "u3", text: "Hola! Sí, aún lo tengo guardado. Si te interesa te puedo pasar fotos detalladas.", time: "Hace 2 días" },
          ],
          lastMessage: "Hola! Sí, aún lo tengo guardado. Si te interesa te puedo pasar fotos detalladas.",
          lastTime: new Date(Date.now() - 172800000).toISOString(),
          unread: 0,
        },
      ];
      try {
        localStorage.setItem(key, JSON.stringify(storedThreads));
      } catch (e) {}
    }

    setThreads(storedThreads);
  }, [session]);

  // Persistir hilos cuando cambian
  useEffect(() => {
    if (!session?.id) return;
    const key = `colecciona_threads_${session.id}`;
    try {
      localStorage.setItem(key, JSON.stringify(threads));
    } catch (e) {}
  }, [threads, session]);

  // ─────────────────────────────────────────────────────────────
  // Load favorites from server when session is available
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    getFavorites().then((ids) => {
      if (ids && ids.length > 0) setFavorites(new Set(ids));
    }).catch(() => {});
  }, [session]);

  // ─────────────────────────────────────────────────────────────
  // Load offers from server when session is available
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    getOffers().then((list) => {
      if (list.length) {
        setOffers(list.map((o) => ({
          id: o.id,
          productId: o.product_id,
          product: o.product,
          fromUser: o.from_user || { id: o.from_user_id },
          toUser: o.to_user || { id: o.to_user_id },
          amount: o.amount,
          originalPrice: o.original_price,
          status: o.status,
          message: o.message,
          createdAt: o.created_at,
        })));
      }
    }).catch(() => {});
  }, [session]);

  // ─────────────────────────────────────────────────────────────
  // Persist cart in localStorage (always)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem("colecciona_cart", JSON.stringify(cart));
    } catch {}
  }, [cart]);

  // ─────────────────────────────────────────────────────────────
  // Persist favorites locally when not logged in
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (session) return;
    try {
      localStorage.setItem("colecciona_favorites", JSON.stringify([...favorites]));
    } catch {}
  }, [favorites, session]);

  // ─────────────────────────────────────────────────────────────
  // Toast helpers
  // ─────────────────────────────────────────────────────────────
  const showToast = useCallback((message, type = "info") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

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
      commission: acc.commission + Math.max(0.35, item.product.price * 0.035),
    }),
    { subtotal: 0, shipping: 0, commission: 0 }
  );
  cartTotal.total = cartTotal.subtotal + cartTotal.shipping + cartTotal.commission;

  // ─────────────────────────────────────────────────────────────
  // Favorites helpers
  // ─────────────────────────────────────────────────────────────
  const toggleFavorite = useCallback((productId) => {
    const wasFavorite = favorites.has(productId);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
        showToast("Eliminado de favoritos", "info");
      } else {
        next.add(productId);
        showToast("Añadido a favoritos ♥", "success");
      }
      return next;
    });
    if (session) {
      toggleFavoriteAPI(productId).catch(() => {
        setFavorites((prev) => {
          const next = new Set(prev);
          if (wasFavorite) next.add(productId);
          else next.delete(productId);
          return next;
        });
        showToast("Error al actualizar favoritos", "error");
      });
    }
  }, [session, favorites, showToast]);

  // ─────────────────────────────────────────────────────────────
  // Notifications helpers
  // ─────────────────────────────────────────────────────────────
  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    const token = session?.access_token || session?.accessToken;
    if (!token) return;
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
  }, [session]);

  const markRead = useCallback((id) => {
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    const token = session?.access_token || session?.accessToken;
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
  const makeOffer = useCallback((productId, amount, message) => {
    const product = products.find((p) => p.id === productId);
    const seller = users.find((u) => u.id === product?.seller);
    const newOffer = {
      id: `o${Date.now()}`,
      productId,
      product,
      fromUser: session || users[2],
      toUser: seller,
      amount,
      originalPrice: product?.price,
      status: "pending",
      direction: "sent",
      message,
      createdAt: new Date().toISOString(),
    };
    setOffers((prev) => [newOffer, ...prev]);
    showToast(`Oferta de ${amount.toFixed(2)} € enviada`, "success");
    // Add notification
    setNotifications((prev) => [
      {
        id: `n${Date.now()}`,
        type: "offer",
        read: false,
        title: "Oferta enviada",
        body: `Tu oferta de ${amount.toFixed(2)} € por "${product?.title}" fue enviada al vendedor`,
        icon: "offer",
        time: "ahora",
        link: `/product/${productId}`,
      },
      ...prev,
    ]);
    notifyUser({
      recipientId: seller?.id,
      type: "offer",
      title: "Nueva oferta",
      body: `Han ofertado ${amount.toFixed(2)} € por "${product?.title}"`,
      link: `/product/${productId}`,
    });
    sendPush({
      recipientId: seller?.id,
      title: "Nueva oferta",
      body: `Han ofertado ${amount.toFixed(2)} € por "${product?.title}"`,
      link: `/product/${productId}`,
    });
    if (session?.id) {
      createOffer({ productId, amount, message }).catch(() => {});
    }
  }, [session, showToast]);

  const respondToOffer = useCallback((offerId, action) => {
    setOffers((prev) =>
      prev.map((o) => o.id === offerId ? { ...o, status: action } : o)
    );
    const labels = { accepted: "Oferta aceptada ✓", rejected: "Oferta rechazada" };
    showToast(labels[action] || "Oferta actualizada", action === "accepted" ? "success" : "info");
    if (session?.id) {
      updateOffer({ id: offerId, status: action }).catch(() => {});
    }
  }, [session, showToast]);

  // ── Contraofertas ──
  // Crea una nueva oferta con el precio contrario y la refleja en el chat
  // del producto para continuar la negociación de forma dinámica.
  const counterOffer = useCallback((offerId, amount, message = "") => {
    const original = offers.find((o) => o.id === offerId);
    if (!original) return;

    const me = session || users[2];
    const newOffer = {
      id: `o${Date.now()}`,
      productId: original.productId,
      product: original.product,
      fromUser: me,
      toUser: original.fromUser,
      amount,
      originalPrice: original.originalPrice || original.product?.price,
      status: "pending",
      direction: "sent",
      message: message || `Contraoferta: ${amount.toFixed(2)} €`,
      createdAt: new Date().toISOString(),
    };

    setOffers((prev) => [
      { ...original, status: "countered" },
      newOffer,
      ...prev.filter((o) => o.id !== offerId),
    ]);

    // Reflejar la contraoferta en el chat del producto.
    setThreads((prev) =>
      prev.map((t) =>
        t.productId === original.productId
          ? {
              ...t,
              messages: [
                ...t.messages,
                {
                  id: `m${Date.now()}`,
                  from: "me",
                  text: `💬 Contraoferta: ${amount.toFixed(2)} € — ${message}`,
                  time: new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }),
                },
              ],
              lastMessage: `Contraoferta: ${amount.toFixed(2)} €`,
              lastTime: new Date().toISOString(),
            }
          : t
      )
    );

    showToast(`Contraoferta de ${amount.toFixed(2)} € enviada al vendedor`, "success");

    notifyUser({
      recipientId: original.fromUser?.id,
      type: "offer",
      title: "Contraoferta recibida",
      body: `Te han contraofertado ${amount.toFixed(2)} € por "${original.product?.title}"`,
      link: `/product/${original.productId}`,
    });
    sendPush({
      recipientId: original.fromUser?.id,
      title: "Contraoferta recibida",
      body: `Te han contraofertado ${amount.toFixed(2)} € por "${original.product?.title}"`,
      link: `/product/${original.productId}`,
    });
  }, [offers, session, showToast]);

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
    const threadId = `th-${partnerId}-${productId || 'g'}`;

    setThreads((prev) => {
      const exists = prev.find((t) => t.id === threadId);
      if (exists) return prev;
      return [
        {
          id: threadId,
          partner: {
            id: partnerId,
            name: partner?.name || partner?.username || 'Vendedor',
            username: partner?.username,
            verified: partner?.verified,
          },
          product: productId ? {
            id: productId,
            title: product?.title || 'Anuncio',
            image: product?.image || '',
            price: product?.price || 0,
          } : null,
          messages: [],
          lastMessage: '',
          lastTime: '',
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
    const msgId = `m${Date.now()}`;
    const timestamp = new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: [...t.messages, { id: msgId, from: "me", text, time: timestamp, status: "sending" }],
              lastMessage: text,
              lastTime: new Date().toISOString(),
              unread: 0,
            }
          : t
      )
    );
    const thread = threads.find((t) => t.id === threadId);
    const receiverId = thread?.partner?.id || thread?.participants?.find((p) => p !== "me") || "u1";
    const productId = thread?.productId;
    persistMessage({
      senderId: session?.id || "me",
      receiverId,
      productId,
      text,
    }).then(() => {
      if (session?.id && receiverId && receiverId !== "me") {
        notifyUser({
          recipientId: receiverId,
          type: "message",
          title: "Nuevo mensaje",
          body: text,
          link: `/messages?thread=${threadId}`,
        });
        sendPush({
          recipientId: receiverId,
          title: "Nuevo mensaje",
          body: text,
          link: `/messages?thread=${threadId}`,
        });
      }
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? {
                ...t,
                messages: t.messages.map((m) =>
                  m.id === msgId ? { ...m, status: "sent" } : m
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
  }, [session, threads, showToast]);

  // ─────────────────────────────────────────────────────────────
  // Orders helpers
  // ─────────────────────────────────────────────────────────────
  const confirmReceived = useCallback((orderId) => {
    setOrders((prev) =>
      prev.map((o) => o.id === orderId ? { ...o, status: "completed", confirmedAt: new Date().toISOString() } : o)
    );
    showToast("¡Recepción confirmada! Valoración disponible.", "success");
  }, [showToast]);

  const markSaleShipped = useCallback((saleId, trackingCode) => {
    setSales((prev) =>
      prev.map((s) => s.id === saleId ? { ...s, status: "shipped", trackingCode } : s)
    );
    showToast("Envío marcado como enviado", "success");
  }, [showToast]);

  const checkout = useCallback((address, paymentMethod) => {
    const newOrders = cart.map((item) => ({
      id: `CV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      product: item.product,
      seller: users.find((u) => u.id === item.product.seller) || users[0],
      buyer: "me",
      price: item.product.price,
      shipping: item.shippingMethod?.price || 1.8,
      commission: Math.max(0.35, item.product.price * 0.035),
      total: item.product.price + (item.shippingMethod?.price || 1.8) + Math.max(0.35, item.product.price * 0.035),
      shippingMethod: item.shippingMethod?.name || "Sobre acolchado Correos",
      trackingCode: null,
      status: "paid",
      purchasedAt: new Date().toISOString(),
      confirmedAt: null,
      address,
    }));
    setOrders((prev) => [...newOrders, ...prev]);
    clearCart();
    showToast("¡Pedido realizado! Dinero en custodia segura.", "success");
    return newOrders[0]?.id;
  }, [cart, clearCart, showToast]);

  // ─────────────────────────────────────────────────────────────
  // Reviews
  // ─────────────────────────────────────────────────────────────
  const [reviews, setReviews] = useState([]);

  const addReview = useCallback((orderId, targetUserId, rating, comment) => {
    setReviews((prev) => [
      ...prev,
      {
        id: `r${Date.now()}`,
        orderId,
        reviewer: session || users[2],
        targetUserId,
        rating,
        comment,
        date: new Date().toISOString(),
      },
    ]);
    setOrders((prev) =>
      prev.map((o) => o.id === orderId ? { ...o, reviewed: true } : o)
    );
    showToast("¡Valoración enviada! Gracias.", "success");
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
