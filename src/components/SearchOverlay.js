"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  getRecentSearches,
  addRecentSearch,
  removeRecentSearch,
  clearRecentSearches,
} from "@/lib/recentSearches";
import { collections } from "@/data/collections";
import styles from "./SearchOverlay.module.css";

const themeSectionIds = [
  'mundial', 'tlg-futbol', 'champions', 'baloncesto', 'beisbol',
  'nfl-ufc', 'motor', 'comics-cine', 'nintendo', 'especial-digital',
];

function normalizeStr(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function findCollectionInfo(categoryId) {
  for (const col of collections) {
    if (col.id === categoryId) {
      return { id: col.id, name: col.name, parentName: col.name, subName: "" };
    }
    const sub = col.subs?.find((s) => s.id === categoryId);
    if (sub) {
      return { id: sub.id, name: sub.name, parentName: col.name, subName: sub.name };
    }
  }
  return { id: categoryId, name: "", parentName: "", subName: "" };
}

export default function SearchOverlay({
  open,
  onClose,
  onSearch,
  onSelectCategory,
  fallbackUsers = [],
  selectedCategory = "all",
}) {
  const router = useRouter();
  const activeSectionName = selectedCategory !== "all"
    ? findCollectionInfo(selectedCategory).name
    : "";

  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState([]);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [products, setProducts] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [mounted, setMounted] = useState(false);

  function getProductCollectionName(categoryId) {
    for (const col of collections) {
      if (!themeSectionIds.includes(col.id)) continue;
      if (col.id === categoryId) return col.name;
      for (const sub of col.subs || []) {
        if (sub.id === categoryId) return `${col.name} / ${sub.name}`;
      }
    }
    return "";
  }

  const inputRef = useRef(null);
  const resultsListRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Navegación con historial del navegador
  const onCloseRef = useRef(onClose);
  const routerRef = useRef(router);
  const historyPushedRef = useRef(false);
  const pendingNavRef = useRef(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    const onPop = () => {
      if (historyPushedRef.current) {
        historyPushedRef.current = false;
        onCloseRef.current();
      }
      const nav = pendingNavRef.current;
      pendingNavRef.current = null;
      if (nav) routerRef.current.push(nav);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const close = useCallback(() => {
    if (!historyPushedRef.current) {
      onCloseRef.current();
      return;
    }
    historyPushedRef.current = false;
    onCloseRef.current();
    window.history.back();
  }, []);

  const navigate = useCallback((url) => {
    if (!historyPushedRef.current) {
      routerRef.current.push(url);
      onCloseRef.current();
      return;
    }
    pendingNavRef.current = url;
    historyPushedRef.current = false;
    onCloseRef.current();
    window.history.back();
  }, []);

  // Al abrir/cerrar
  useEffect(() => {
    if (open) {
      if (!historyPushedRef.current) {
        historyPushedRef.current = true;
        window.history.pushState({ coleccionaSearch: true }, "");
      }
      setRecent(getRecentSearches());
      setQuery("");
      setUsers([]);
      setProducts([]);
      setActiveIndex(0);

      // Bloquear scroll del fondo — método position:fixed (funciona en Safari)
      const scrollY = window.scrollY;
      const body = document.body;
      body.style.position = "fixed";
      body.style.top = `-${scrollY}px`;
      body.style.left = "0";
      body.style.right = "0";
      body.style.overflow = "hidden";

      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => {
        clearTimeout(t);
        body.style.position = "";
        body.style.top = "";
        body.style.left = "";
        body.style.right = "";
        body.style.overflow = "";
        window.scrollTo(0, scrollY);
      };
    }
    historyPushedRef.current = false;
  }, [open]);

  const q = query.trim();

  // Búsqueda en vivo de usuarios
  useEffect(() => {
    if (!open || !q) {
      setUsers([]);
      setUsersLoading(false);
      return;
    }
    setUsersLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        const ql = q.toLowerCase();
        const seen = new Set();
        const merged = [];
        for (const u of [...(data.users || []), ...fallbackUsers]) {
          const key = (u.username || "").toLowerCase();
          if (!key || seen.has(key)) continue;
          const matches =
            (u.username || "").toLowerCase().includes(ql) ||
            (u.name || "").toLowerCase().includes(ql);
          if (!matches) continue;
          seen.add(key);
          merged.push(u);
          if (merged.length >= 8) break;
        }
        setUsers(merged);
      } catch {
        if (!controller.signal.aborted) {
          const ql = q.toLowerCase();
          setUsers(
            fallbackUsers
              .filter(
                (u) =>
                  (u.username || "").toLowerCase().includes(ql) ||
                  (u.name || "").toLowerCase().includes(ql)
              )
              .slice(0, 8)
          );
        }
      } finally {
        if (!controller.signal.aborted) setUsersLoading(false);
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, open, fallbackUsers]);

  // Búsqueda de productos
  useEffect(() => {
    if (!open || !q || q.length < 2) {
      setProducts([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const catParam = selectedCategory !== "all" ? `&category=${selectedCategory}` : "";
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}${catParam}&limit=5`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (!controller.signal.aborted) {
          setProducts(data.products || []);
        }
      } catch {
        if (!controller.signal.aborted) setProducts([]);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, open, selectedCategory]);

  // Colecciones que coinciden
  const matchingCollections = useMemo(() => {
    if (!q) return [];
    const ql = normalizeStr(q);
    const results = [];
    const sectionsToShow = selectedCategory !== "all"
      ? collections.filter((col) => col.id === selectedCategory)
      : collections.filter((col) => themeSectionIds.includes(col.id));
    for (const c of sectionsToShow) {
      if (normalizeStr(c.name).includes(ql)) {
        results.push({ id: c.id, name: c.name, type: "collection", color: c.color });
      }
    }
    return results.slice(0, 5);
  }, [q, selectedCategory]);

  // Lista unificada para teclado
  const flatItems = useMemo(() => {
    if (!q) return [];
    const list = [];
    products.forEach((p) => list.push({ kind: "product", data: p }));
    matchingCollections.forEach((c) => list.push({ kind: "collection", data: c }));
    users.forEach((u) => list.push({ kind: "user", data: u }));
    return list;
  }, [q, products, matchingCollections, users]);

  const submitSearch = useCallback(
    (term) => {
      const t = String(term || "").trim();
      if (!t) return;
      addRecentSearch(t);
      onSearch(t);
      close();
    },
    [onSearch, close]
  );

  const handleSelectItem = useCallback(
    (item) => {
      if (!item) return;
      if (item.kind === "user") {
        addRecentSearch(q);
        navigate(`/seller/${item.data.username}`);
      } else if (item.kind === "product") {
        addRecentSearch(q);
        navigate(`/product/${item.data.id}`);
      } else if (item.kind === "collection") {
        addRecentSearch(item.data.name);
        if (onSelectCategory) {
          onSelectCategory(item.data.id);
        } else {
          onSearch(item.data.name);
        }
        close();
      }
    },
    [q, navigate, onSearch, onSelectCategory, close]
  );

  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (flatItems.length === 0) {
      if (e.key === "Enter" && q) {
        e.preventDefault();
        submitSearch(q);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % flatItems.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? flatItems.length - 1 : prev - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < flatItems.length) {
        handleSelectItem(flatItems[activeIndex]);
      } else {
        submitSearch(q);
      }
    }
  };

  const handleRemoveRecent = (term, e) => {
    e.stopPropagation();
    removeRecentSearch(term);
    setRecent(getRecentSearches());
  };

  const handleClearAll = () => {
    clearRecentSearches();
    setRecent([]);
  };

  useEffect(() => {
    if (activeIndex < 0) return;
    const el = resultsListRef.current?.querySelector(`[data-active="true"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  if (!mounted) return null;

  const totalResults = products.length + users.length + matchingCollections.length;
  const isLoading = usersLoading;

  return createPortal(
    <div
      className={`${styles.backdrop} ${open ? styles.open : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Buscador global"
    >
      <div className={styles.modal}>
        {/* Barra superior de entrada */}
        <div className={styles.searchBar}>
          <span className={styles.searchIcon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>

          <input
            ref={inputRef}
            type="search"
            placeholder={selectedCategory !== "all" ? `Buscar en ${activeSectionName}...` : "Buscar cromos, colecciones, vendedores..."}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className={styles.searchInput}
            autoComplete="off"
            enterKeyHint="search"
          />



          <button
            type="button"
            className={styles.closeBtn}
            onClick={close}
            aria-label="Cerrar buscador"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Contenedor de contenido scrollable */}
        <div ref={resultsListRef} className={styles.modalBody}>
          {/* ── ESTADO INICIAL (SIN BÚSQUEDA) ── */}
          {!q && (
            <div className={styles.defaultView}>
              {recent.length > 0 ? (
                <>
                  <div className={styles.sectionHeader}>
                    <span className={styles.sectionLabel}>Búsquedas recientes</span>
                    <button type="button" className={styles.clearAllBtn} onClick={handleClearAll}>
                      Borrar historial
                    </button>
                  </div>
                  <div className={styles.recentGrid}>
                    {recent.map((item) => (
                      <div
                        key={item.q}
                        className={styles.recentItem}
                        onClick={() => submitSearch(item.q)}
                        role="button"
                        tabIndex={0}
                      >
                        <span className={styles.recentClock}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                        </span>
                        <span className={styles.recentText}>{item.q}</span>
                        <button
                          type="button"
                          className={styles.recentDelete}
                          onClick={(e) => handleRemoveRecent(item.q, e)}
                          aria-label="Eliminar búsqueda"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className={styles.emptyRecentPrompt}>
                  <p>No hay búsquedas recientes</p>
                </div>
              )}
            </div>
          )}

          {/* ── ESTADO CON BÚSQUEDA ACTIVA: DOS COLUMNAS EN SPLIT VERTICAL ── */}
          {q && (
            <div className={styles.searchResults}>


              {isLoading && (
                <div className={styles.loadingIndicator}>
                  <div className={styles.spinner} />
                  <span>Buscando resultados...</span>
                </div>
              )}

              {/* Layout de 2 columnas separadas en vertical */}
              <div className={styles.splitColumns}>
                {/* ── COLUMNA IZQUIERDA: Cartas y Colecciones ── */}
                <div className={styles.leftColumn}>
                  {/* Cartas */}
                  {products.length > 0 && (
                    <div className={styles.resultGroup}>
                      <div className={styles.groupHeader}>Cartas</div>
                      <div className={styles.collectionsList}>
                        {products.slice(0, 5).map((prod) => {
                          const itemIndex = flatItems.findIndex(
                            (fi) => fi.kind === "product" && fi.data.id === prod.id
                          );
                          const active = activeIndex === itemIndex;
                          return (
                            <div
                              key={prod.id}
                              className={`${styles.collectionRow} ${active ? styles.activeRow : ""}`}
                              data-active={active}
                              onClick={() => handleSelectItem({ kind: "product", data: prod })}
                              onMouseEnter={() => setActiveIndex(itemIndex)}
                            >
                              <div className={styles.collectionBadge} style={{ borderColor: "var(--accent-primary)" }}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="3" y="3" width="18" height="18" rx="2" />
                                  <circle cx="8.5" cy="8.5" r="1.5" />
                                  <polyline points="21 15 16 10 5 21" />
                                </svg>
                              </div>
                              <div className={styles.collectionMeta}>
                                <span className={styles.collectionTitle}>{prod.title}</span>
                                <span className={styles.collectionParent}>{getProductCollectionName(prod.category)} · {prod.price?.toFixed(2)} €</span>
                              </div>
                              <span className={styles.actionArrow}>→</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Colecciones */}
                  {matchingCollections.length > 0 && (
                    <div className={styles.resultGroup}>
                      <div className={styles.groupHeader}>Colecciones</div>
                      <div className={styles.collectionsList}>
                        {matchingCollections.map((col) => {
                          const itemIndex = flatItems.findIndex(
                            (fi) => fi.kind === "collection" && fi.data.id === col.id
                          );
                          const active = activeIndex === itemIndex;
                          return (
                            <div
                              key={col.id}
                              className={`${styles.collectionRow} ${active ? styles.activeRow : ""}`}
                              data-active={active}
                              onClick={() => handleSelectItem({ kind: "collection", data: col })}
                              onMouseEnter={() => setActiveIndex(itemIndex)}
                            >
                              <div className={styles.collectionBadge} style={{ borderColor: col.color || "var(--accent-primary)" }}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                                  <polyline points="2 17 12 22 22 17" />
                                  <polyline points="2 12 12 17 22 12" />
                                </svg>
                              </div>
                              <div className={styles.collectionMeta}>
                                <span className={styles.collectionTitle}>{col.name}</span>
                                {col.parent && <span className={styles.collectionParent}>{col.parent}</span>}
                              </div>
                              <span className={styles.actionArrow}>→</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}



                  {products.length === 0 && matchingCollections.length === 0 && !isLoading && (
                    <div className={styles.resultGroup}>
                      <div className={styles.groupHeader}>Colecciones</div>
                      <p className={styles.emptyColMessage}>No se encontraron resultados</p>
                    </div>
                  )}
                </div>

                {/* ── COLUMNA DERECHA: Usuarios / Vendedores ── */}
                <div className={styles.rightColumn}>
                  <div className={styles.resultGroup}>
                    <div className={styles.groupHeader}>Vendedores</div>
                    {users.length > 0 ? (
                      <div className={styles.usersList}>
                        {users.map((u) => {
                          const itemIndex = flatItems.findIndex(
                            (fi) => fi.kind === "user" && fi.data.id === u.id
                          );
                          const active = activeIndex === itemIndex;
                          return (
                            <div
                              key={u.id || u.username}
                              className={`${styles.userRow} ${active ? styles.activeRow : ""}`}
                              data-active={active}
                              onClick={() => handleSelectItem({ kind: "user", data: u })}
                              onMouseEnter={() => setActiveIndex(itemIndex)}
                            >
                              <div className={styles.userAvatar}>
                                {u.avatar ? (
                                  <Image src={u.avatar} alt="" fill sizes="34px" style={{ objectFit: "cover" }} />
                                ) : (
                                  (u.initials || (u.username || "?").charAt(0)).toUpperCase()
                                )}
                              </div>
                              <div className={styles.userMeta}>
                                <span className={styles.userName}>@{u.username}</span>
                                <span className={styles.userFullName}>{u.name || "Coleccionista"}</span>
                              </div>
                              {u.rating && (
                                <div className={styles.userRating}>
                                  <span>★ {u.rating}</span>
                                </div>
                              )}
                              <span className={styles.actionArrow}>→</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : !isLoading ? (
                      <p className={styles.emptyColMessage}>No se encontraron vendedores</p>
                    ) : null}
                  </div>
                </div>
              </div>


            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
