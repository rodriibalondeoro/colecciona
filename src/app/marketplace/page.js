"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ProductCard from "@/components/ProductCard";
import Skeleton from "@/components/Skeleton";
import { products, users } from "@/data/mockData";
import { collections } from "@/data/collections";
import { getPersistedProducts, deleteProduct } from "@/lib/dataService";
import { getRecentlyViewed } from "@/lib/recentlyViewed";
import SearchOverlay from "@/components/SearchOverlay";
import Link from "next/link";
import Image from "next/image";
import TextReveal from "@/components/TextReveal";
import { useStaggerReveal } from "@/lib/useScrollReveal";
import styles from "./page.module.css";

const themeSectionIds = [
  'mundial', 'tlg-futbol', 'champions', 'baloncesto', 'beisbol',
  'nfl-ufc', 'motor', 'comics-cine', 'nintendo', 'especial-digital',
];

const PAGE_LIMIT = 20;

function timeAgo(iso) {
  if (!iso) return "Reciente";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Hace un momento";
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days} d`;
}

function normalize(s) {
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

function buildSearchParams({ q, category, condition, sort, page, minPrice, maxPrice, includeLimit = true }) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category && category !== "all") params.set("category", category);
  if (condition && condition !== "all") params.set("condition", condition);
  if (sort && sort !== "recent") params.set("sort", sort);
  if (minPrice) params.set("min_price", minPrice);
  if (maxPrice) params.set("max_price", maxPrice);
  if (page > 1) params.set("page", String(page));
  if (includeLimit) params.set("limit", String(PAGE_LIMIT));
  return params.toString();
}

export default function MarketplacePage() {
  return (
    <Suspense fallback={<div className="container"><Skeleton type="card" count={8} /></div>}>
      <MarketplaceContent />
    </Suspense>
  );
}

function MarketplaceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get("category") || "all");
  const [conditionFilter, setConditionFilter] = useState(searchParams.get("condition") || "all");
  const [sortBy, setSortBy] = useState(searchParams.get("sort") || "recent");
  const [minPrice, setMinPrice] = useState(searchParams.get("min_price") || "");
  const [maxPrice, setMaxPrice] = useState(searchParams.get("max_price") || "");
  const [dbProducts, setDbProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [mounted, setMounted] = useState(false);
  const [persisted, setPersisted] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [session, setSession] = useState(null);
  const [recentItems, setRecentItems] = useState([]);
  const [myMissingCards, setMyMissingCards] = useState([]);
  const [scrolled, setScrolled] = useState(false);
  const [leavingId, setLeavingId] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyAtStart, setHistoryAtStart] = useState(true);
  const [historyAtEnd, setHistoryAtEnd] = useState(false);
  const debounceRef = useRef(null);
  const isInitialMount = useRef(true);
  const trackRef = useRef(null);
  const sentinelRef = useRef(null);

  const checkHistoryScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setHistoryAtStart(track.scrollLeft <= 0);
    setHistoryAtEnd(track.scrollLeft + track.clientWidth >= track.scrollWidth - 1);
  }, []);

  useEffect(() => {
    if (searchParams.get("openSearch") === "true") {
      setSearchOpen(true);
      window.history.replaceState({}, "", "/marketplace");
    }
  }, [searchParams]);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("colecciona_session") || "null");
      setSession(s);
      if (s?.id) loadMissingCards(s.id);
    } catch {}
  }, []);

  const loadMissingCards = async (userId) => {
    try {
      const token = (() => { try { return JSON.parse(localStorage.getItem("colecciona_session") || "{}").access_token || JSON.parse(localStorage.getItem("colecciona_session") || "{}").accessToken || ''; } catch { return ''; } })();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const colRes = await fetch(`/api/collections?userId=${userId}`, { headers });
      const colData = await colRes.json();
      const collections = colData.collections || [];
      const missing = [];
      for (const col of collections) {
        const itemRes = await fetch(`/api/collections/${col.id}/items?status=MISSING`, { headers });
        const itemData = await itemRes.json();
        for (const item of itemData.items || []) {
          missing.push(item.card_name.toLowerCase().trim());
        }
      }
      setMyMissingCards([...new Set(missing)]);
    } catch {}
  };

  useEffect(() => {
    setRecentItems(getRecentlyViewed());
    setPersisted(getPersistedProducts());
    setMounted(true);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    checkHistoryScroll();
    track.addEventListener("scroll", checkHistoryScroll, { passive: true });
    window.addEventListener("resize", checkHistoryScroll);
    return () => {
      track.removeEventListener("scroll", checkHistoryScroll);
      window.removeEventListener("resize", checkHistoryScroll);
    };
  }, [checkHistoryScroll, recentItems.length]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 120);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Atajo de teclado para abrir la búsqueda (⌘K / Ctrl+K / "/")
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "/") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading && dbProducts.length > 0) {
          handleLoadMore();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, dbProducts.length, currentPage]);

  const fetchProducts = useCallback(async (page, append = false) => {
    const params = buildSearchParams({
      q: searchQuery,
      category: selectedCategory,
      condition: conditionFilter,
      sort: sortBy,
      minPrice,
      maxPrice,
      page,
    });

    try {
      const res = await fetch(`/api/products/search?${params}`);
      const data = await res.json();
      const normalized = (data.products || []).map((p) => ({
        ...p,
        listedAt: p.listedAt || p.created_at,
      }));

      if (append) {
        setDbProducts((prev) => [...prev, ...normalized]);
      } else {
        setDbProducts(normalized);
      }
      setTotal(data.total || normalized.length);
      setHasMore(normalized.length >= PAGE_LIMIT);
      setCurrentPage(data.page || page);
    } catch {
      if (!append) setDbProducts([]);
    }
  }, [searchQuery, selectedCategory, conditionFilter, sortBy, minPrice, maxPrice]);

  // Initial load from URL params
  useEffect(() => {
    const initialPage = parseInt(searchParams.get("page") || "1", 10);
    setCurrentPage(initialPage);
    fetchProducts(initialPage, false).then(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync URL and re-fetch when filters change (skip initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const params = buildSearchParams({
      q: searchQuery,
      category: selectedCategory,
      condition: conditionFilter,
      sort: sortBy,
      minPrice,
      maxPrice,
      page: 1,
      includeLimit: false,
    });
    router.replace(params ? `/marketplace?${params}` : "/marketplace", { scroll: false });

    setCurrentPage(1);
    setDbProducts([]);
    setHasMore(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchProducts(1, false);
    }, searchQuery ? 300 : 0);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, selectedCategory, conditionFilter, sortBy, minPrice, maxPrice, router, fetchProducts]);

  const handleLoadMore = async () => {
    const nextPage = currentPage + 1;
    setLoadingMore(true);
    await fetchProducts(nextPage, true);
    setLoadingMore(false);
  };

  const handleDelete = async (productId) => {
    const removed = dbProducts.find((p) => p.id === productId);
    setDbProducts((prev) => prev.filter((p) => p.id !== productId));
    try {
      await deleteProduct(productId);
    } catch {
      if (removed) setDbProducts((prev) => [removed, ...prev]);
      alert("No se pudo eliminar. Inténtalo de nuevo.");
    }
  };

  const clearSearchContext = () => {
    setSearchQuery("");
    setSelectedCategory("all");
    router.replace("/marketplace", { scroll: false });
  };

  const handleCategoryChange = (categoryId) => {
    setSelectedCategory(categoryId);
    setSearchQuery(categoryId === "all" ? "" : findCollectionInfo(categoryId).name);
  };

  const allProducts = [...persisted, ...dbProducts, ...products];

  // Filter products
  const q = searchQuery.trim().toLowerCase();
  // Deduplicate: dbProducts take priority over persisted/mock (same ID)
  const seenIds = new Set(dbProducts.map((p) => p.id));
  const mergedProducts = [...dbProducts, ...allProducts.filter((p) => !seenIds.has(p.id))];

  const activeInfo = findCollectionInfo(selectedCategory);
  const activeParentName = activeInfo.parentName;
  const activeSubName = activeInfo.subName;

  const breadcrumbText = selectedCategory === "all"
    ? "COMPRA Y VENDE"
    : `${activeParentName.toUpperCase()}${activeSubName ? ` / ${activeSubName.toUpperCase()}` : ""}`;

  const titleText = selectedCategory === "all"
    ? "MERCADO DE COLECCIONA"
    : activeSubName || activeParentName;

  const minP = minPrice !== "" && !isNaN(parseFloat(minPrice)) ? parseFloat(minPrice) : null;
  const maxP = maxPrice !== "" && !isNaN(parseFloat(maxPrice)) ? parseFloat(maxPrice) : null;

  const hasActiveFilter = searchQuery.trim() || selectedCategory !== "all" || conditionFilter !== "all";

  let filtered = mergedProducts.filter((p) => {
    const hasImage = Boolean(p.image);
    const section = collections.find((c) => c.id === selectedCategory);
    const matchesCategory =
      selectedCategory === "all" ||
      p.category === selectedCategory ||
      (section && section.subs.some((s) => s.id === p.category));
    const matchesCondition =
      conditionFilter === "all" || p.condition === conditionFilter;
    const matchesPrice =
      (minP === null || p.price >= minP) &&
      (maxP === null || p.price <= maxP);
    const matchesQuery = (() => {
      if (!q) return true;
      const qn = normalize(q);
      if (
        normalize(p.title).includes(qn) ||
        normalize(p.set).includes(qn) ||
        normalize(p.code).includes(qn)
      ) {
        return true;
      }
      const col = collections.find((c) => c.id === p.category);
      if (col && normalize(col.name).includes(qn)) return true;
      const parent = collections.find((c) => (c.subs || []).some((s) => s.id === p.category));
      if (parent && normalize(parent.name).includes(qn)) return true;
      const sub = parent?.subs?.find((s) => s.id === p.category);
      if (sub && normalize(sub.name).includes(qn)) return true;
      return false;
    })();
    return hasImage && matchesCategory && matchesCondition && matchesPrice && matchesQuery;
  });

  // Sort products
  if (sortBy === "price-low") {
    filtered.sort((a, b) => a.price - b.price);
  } else if (sortBy === "price-high") {
    filtered.sort((a, b) => b.price - a.price);
  } else if (sortBy === "oldest") {
    filtered.sort((a, b) => new Date(a.listedAt) - new Date(b.listedAt));
  } else {
    filtered.sort((a, b) => new Date(b.listedAt) - new Date(a.listedAt));
  }

  const staggerGridRef = useStaggerReveal({ delay: 50 });

  const scrollHistory = (dir) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: dir * Math.round(track.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <div className={`${styles.wrapper} page-enter`}>
      <div className="container">
        {/* Header Bar */}
        <div className={styles.headerBar}>
          <div className={styles.headerText}>
            <span className={`${styles.breadcrumb} hero-animate`}>{breadcrumbText}</span>
            <h1 className={`${styles.pageTitle} hero-animate-delay-1`}>
              <TextReveal key={titleText} text={titleText} delay={100} accentWords={["COLECCIONA"]} />
            </h1>
          </div>
        </div>

        {/* Search Trigger (barra de búsqueda) */}
        <div className={`${styles.toolbar} ${styles.toolbarSticky} ${scrolled ? styles.scrolled : ""}`}>
          <button className={styles.searchTrigger} onClick={() => setSearchOpen(true)} type="button" aria-label="Abrir búsqueda">
            <span className={styles.searchTriggerIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <span className={`${styles.searchTriggerLabel} ${searchQuery.trim() ? styles.hasQuery : ""}`}>
              {searchQuery.trim() ? searchQuery.trim() : "Buscar por nombre, colección o usuario..."}
            </span>
            {searchQuery.trim() && (
              <span
                role="button"
                tabIndex={0}
                className={styles.searchClearBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  clearSearchContext();
                }}
                aria-label="Borrar búsqueda"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </span>
            )}
          </button>
        </div>

        {/* Mercado 1: historial (solo sin filtros) */}
        {!hasActiveFilter && recentItems.length > 0 && (
        <section className={styles.historySection} aria-label="Historial reciente">
          <div className={styles.historyHeader}>
            <h2 className={styles.historyTitle}>Últimas publicaciones vistas</h2>
            <div className={styles.historyControls}>
              <span className={styles.historyCount}>
                {recentItems.length} {recentItems.length === 1 ? "publicación" : "publicaciones"}
              </span>
              <button className={styles.historyArrow} onClick={() => scrollHistory(-1)} disabled={historyAtStart} type="button" aria-label="Anterior">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <button className={styles.historyArrow} onClick={() => scrollHistory(1)} disabled={historyAtEnd} type="button" aria-label="Siguiente">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </div>
          <div ref={trackRef} className={styles.historyTrack}>
            {recentItems.map((item) => (
              <Link key={item.id} href={`/product/${item.id}`} className={styles.historyCard}>
                <div className={styles.historyCardImg}>
                  <Image src={item.image} alt={item.title} fill sizes="200px" style={{ objectFit: "cover" }} />
                </div>
                <div className={styles.historyCardBody}>
                  <p className={styles.historyCardTitle}>{item.title}</p>
                  <span className={styles.historyCardPrice}>{item.price.toFixed(2)} €</span>
                  <span className={styles.historyCardTime}>{timeAgo(item.viewedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
        )}

        {/* Full-screen Search Overlay (historial, atrás, teclado) */}
        <SearchOverlay
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onSearch={(t) => setSearchQuery(t)}
          onSelectCategory={handleCategoryChange}
          fallbackUsers={users}
          selectedCategory={selectedCategory}
        />

        {hasActiveFilter && (
        <>
        {/* Filtros y ordenación */}
        <div className={styles.filterBar}>
          <div className={styles.filterField}>
            <label className={styles.filterLabel} htmlFor="sortBy">Ordenar</label>
            <select
              id="sortBy"
              className={styles.filterSelect}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="recent">Más reciente</option>
              <option value="oldest">Más antiguo</option>
              <option value="price-low">Precio: menor a mayor</option>
              <option value="price-high">Precio: mayor a menor</option>
            </select>
          </div>

          <div className={styles.filterField}>
            <label className={styles.filterLabel} htmlFor="categoryFilter">Colección</label>
            <select
              id="categoryFilter"
              className={styles.filterSelect}
              value={selectedCategory}
              onChange={(e) => handleCategoryChange(e.target.value)}
            >
              <option value="all">Todas las colecciones</option>
              {collections
                .filter((col) => themeSectionIds.includes(col.id))
                .map((col) => (
                <optgroup key={col.id} label={col.name}>
                  <option value={col.id}>{col.name} (Todo)</option>
                  {col.subs?.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className={styles.filterField}>
            <label className={styles.filterLabel}>Precio (€)</label>
            <div className={styles.priceInputs}>
              <input
                type="text"
                inputMode="decimal"
                placeholder="Mín"
                value={minPrice}
                onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"); setMinPrice(v); }}
                className={styles.priceInput}
                aria-label="Precio mínimo"
              />
              <span className={styles.priceDash}>–</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="Máx"
                value={maxPrice}
                onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"); setMaxPrice(v); }}
                className={styles.priceInput}
                aria-label="Precio máximo"
              />
            </div>
          </div>
        </div>
        </>
        )}

        {/* Results Grid */}
        {loading ? (
          <Skeleton type="card" count={8} />
        ) : filtered.length > 0 ? (
          <>
            <div
              key={`${selectedCategory}-${conditionFilter}-${sortBy}-${searchQuery}`}
              ref={staggerGridRef}
              className={styles.productGrid}
            >
              {filtered.map((product, idx) => {
                const seller = product.seller && typeof product.seller === "object"
                  ? product.seller
                  : users.find((u) => u.id === product.seller);
                const isOwner = session && (
                  session.id === product.seller?.id ||
                  session.id === product.seller ||
                  session.email === product.seller?.email
                );
                return (
                  <div
                    key={product.id}
                    className={styles.cardEnter}
                    style={{ animationDelay: `${Math.min(idx, 20) * 45}ms` }}
                  >
                    <ProductCard
                      product={product}
                      seller={seller}
                      onDelete={isOwner ? handleDelete : undefined}
                      onSelect={() => router.push(`/product/${product.id}`)}
                      session={session}
                      myMissingCards={myMissingCards}
                    />
                  </div>
                );
              })}
            </div>
            {dbProducts.length > 0 && hasMore && (
              <div ref={sentinelRef} style={{ display: "flex", justifyContent: "center", padding: "2rem 0" }}>
                {loadingMore && <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Cargando mas...</span>}
              </div>
            )}
            {dbProducts.length > 0 && !hasMore && filtered.length > 0 && (
              <div style={{ textAlign: "center", padding: "2rem 0", color: "var(--text-muted)", fontSize: 13 }}>
                Has visto todos los resultados
              </div>
            )}
          </>
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <h3>No se encontraron cromos</h3>
            <p>Prueba a buscar con otras palabras clave o con otros filtros.</p>
          </div>
        )}
      </div>
    </div>
  );
}
