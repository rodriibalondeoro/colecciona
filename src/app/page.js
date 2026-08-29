"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import ProductCard from "@/components/ProductCard";
import AnimatedCounter from "@/components/AnimatedCounter";
import ScrollCardCarousel from "@/components/ScrollCardCarousel";
import HorizontalScroll from "@/components/HorizontalScroll";
import ScrambleText from "@/components/ScrambleText";
import CursorReveal from "@/components/CursorReveal";
import ParallaxBanner from "@/components/ParallaxBanner";
import TaglineSection from "@/components/TaglineSection";
import SpotlightBorder from "@/components/SpotlightBorder";
import { products, users } from "@/data/mockData";
import { collections } from "@/data/collections";
import { useStaggerReveal } from "@/lib/useScrollReveal";
import { useHeroScroll } from "@/hooks/useHeroScroll";
import styles from "./page.module.css";


export default function Home() {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedSection, setSelectedSection] = useState(null);
  const [featuredProducts, setFeaturedProducts] = useState([]);
  const [stats, setStats] = useState({ totalProducts: 0, activeSellers: 0, salesToday: 0 });
  const [statsReady, setStatsReady] = useState(false);
  const gridRef = useStaggerReveal({ delay: 50 });
  const heroRef = useHeroScroll(650);
  const subRowRef = useRef(null);

  const scrollSubRow = (dir) => {
    if (subRowRef.current) subRowRef.current.scrollBy({ left: dir * 240, behavior: "smooth" });
  };

  const testimonials = [
    "Perfecta entrega, todo genial · ★★★★★",
    "Llegó sellada y muy rapida · ★★★★★",
    "Vendedor muy serio, recomendado · ★★★★★",
    "Embalaje impecable · ★★★★★",
    "Todo perfecto, repetiré · ★★★★★",
  ];

  const tickerItems = [
    { title: `${stats.totalProducts.toLocaleString("es-ES")}`, price: "cartas publicadas", time: "MERCADO", stat: true },
    { title: `${stats.activeSellers.toLocaleString("es-ES")}`, price: "vendedores activos", time: "COMUNIDAD", stat: true },
    { title: `10`, price: "ventas hoy", time: "HOY", stat: true },
    ...testimonials.map((t, i) => ({ title: t, price: "", time: `OPINIÓN ${i + 1}`, stat: false })),
  ];

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stats")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data && typeof data.totalProducts === "number") setStats(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setStatsReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/products/search?sort=recent&limit=50")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const list = (data.products || []).map((p) => ({
          ...p,
          listedAt: p.listedAt || p.created_at,
        }));
        if (list.length) setFeaturedProducts(list);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Guarantee at least 5 products by combining with mockData if needed
  const displayProducts = [
    ...featuredProducts,
    ...products.filter((p) => !featuredProducts.some((fp) => fp.id === p.id)),
  ];

  const activeSection = collections.find((c) => c.id === selectedSection);

  const themeSectionIds = [
    'mundial', 'tlg-futbol', 'champions', 'baloncesto', 'beisbol',
    'nfl-ufc', 'motor', 'comics-cine', 'nintendo', 'especial-digital',
  ];
  const themeSections = themeSectionIds
    .map((id) => collections.find((c) => c.id === id))
    .filter(Boolean);

  const matchesCategory = (p) => {
    if (!selectedSection) return true;
    const section = collections.find((c) => c.id === selectedSection);
    if (!section) return true;
    const sectionIds = [section.id, ...section.subs.map((s) => s.id)];
    if (selectedCategory === "all") return sectionIds.includes(p.category);
    return p.category === selectedCategory;
  };

  const filteredProducts = displayProducts.filter(matchesCategory);

  const carouselItems = displayProducts
    .slice()
    .sort((a, b) => ((b.favorites || b.likes_count || b.likes || b.views || 0) - (a.favorites || a.likes_count || a.likes || a.views || 0)))
    .slice(0, 3)
    .map((p) => ({
      id: p.id,
      title: p.title || p.name || p.card_name || "Cromo",
      price: p.price ?? p.price_eur ?? 0,
      image: (p.images && p.images[0]) || p.image,
      code: p.code || p.card_id || p.condition || "",
      set: p.set || p.set_name || p.title || "TCG",
    }));

  const spotlightItem = carouselItems[0];
  const spotlightSeller =
    typeof displayProducts[0]?.seller === "object"
      ? displayProducts[0].seller
      : users.find((u) => u.id === displayProducts[0]?.seller);
  const spotlightSellerName = spotlightSeller?.name || spotlightSeller?.username || "Coleccionista";
  const spotlightUsername = spotlightSeller?.username ? `@${spotlightSeller.username}` : "";

  return (
    <div className={styles.wrapper}>
      {/* Mercado Ticker */}
      <div className={styles.tickerBar}>
        <div className={styles.tickerContainer}>
          {statsReady && (
          <div className={styles.tickerTrack}>
            {[0, 1].map((group) => (
              <div key={group} className={styles.tickerGroup}>
                {tickerItems.map((sale, idx) => (
                  <div key={idx} className={styles.tickerItem}>
                    <span className={styles.tickerMeta}>{sale.time}</span>
                    <span className={sale.stat ? styles.tickerStat : styles.tickerTitle}>{sale.title}</span>
                    {sale.price && <span className={styles.tickerPrice}>{sale.price}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
          )}
          <span className={styles.srOnly}>
            Cifras del mercado y opiniones de compradores.
          </span>
        </div>
      </div>

      {/* Hero Section */}
      <section ref={heroRef} className={styles.heroSection}>
        <div className={styles.heroContainer}>
          <div className={styles.heroContent}>
            <div className={styles.heroBadge}>
              <span>COMPRA Y VENDE EN COLECCIONA</span>
            </div>

            <h1 className={styles.heroTitle}>
              El <span className={styles.gradientText}>mejor mercado</span> para coleccionistas de todo tipo
            </h1>

            <p className={styles.heroSubtitle}>
              Compra y vende cromos de todas las colecciones y ahorra en tus pagos como nunca.
            </p>

            <div className={styles.heroActions} data-cursor>
              <Link href="/marketplace" className={styles.primaryBtn} data-magnetic data-magnetic-strength="0.25">
                <ScrambleText trigger="hover" text="Explorar Mercado" />
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>

              <Link href="/sell" className={styles.secondaryBtn}>
                <ScrambleText trigger="hover" text="Empezar a vender" />
              </Link>
            </div>

            {/* Metrics */}
            <div className={styles.metricsRow}>
              <div className={styles.metricItem}>
                <span className={styles.metricVal}>Envío</span>
                <span className={styles.metricLbl}>Gastos de envío baratos</span>
              </div>
              <div className={styles.metricDivider} />
              <div className={styles.metricItem}>
                <span className={styles.metricVal}>Rastreo</span>
                <span className={styles.metricLbl}>Rastrea tu pedido siempre</span>
              </div>
              <div className={styles.metricDivider} />
              <div className={styles.metricItem}>
                <span className={styles.metricVal}>Pago seguro</span>
                <span className={styles.metricLbl}>Protección total y soporte real</span>
              </div>
            </div>
          </div>

{/* Hero Card Spotlight Preview */}
          <div className={styles.heroSpotlight}>
            <SpotlightBorder className={styles.spotlightCard}>
              <div className={styles.spotlightHeader}>
                <span className={styles.spotlightBadge}>CROMO MÁS VISTO HOY</span>
              </div>

              <div className={styles.spotlightImageFrame}>
                {spotlightItem?.image ? (
                  <Image
                    src={spotlightItem.image}
                    alt={spotlightItem.title}
                    fill
                    priority
                    sizes="(max-width: 768px) 100vw, 400px"
                    className={styles.spotlightImage}
                  />
                ) : (
                  <div className={styles.spotlightNoImage}>Sin imagen</div>
                )}
              </div>

              <div className={styles.spotlightMeta}>
                <div className={styles.spotlightTitleRow}>
                  <h3>{spotlightItem?.title || "Sin productos aún"}</h3>
                  <span className={styles.spotlightPrice}>
                    {spotlightItem?.price ? `${spotlightItem.price.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}` : "—"} 
                  </span>
                </div>

                <div className={styles.spotlightFooter}>
                  <div className={styles.spotlightSeller}>
                    <div className={styles.sellerDot} />
                    <span>{spotlightSellerName} {spotlightUsername}</span>
                  </div>
                  {spotlightItem?.id && (
                    <Link href={`/product/${spotlightItem.id}`} className={styles.spotlightAction}>
                      Ver Oferta
                    </Link>
                  )}
                </div>
              </div>
            </SpotlightBorder>
          </div>
        </div>
      </section>

      {/* Category Nav Bar */}
      <section className={styles.categoriesSection}>
        <div className="container">
          <div className={styles.sectionTitleRow}>
            <span className={styles.sectionEyebrow}>EXPLORA</span>
            <h2 className={styles.sectionHeading}>Todas las colecciones disponibles</h2>
          </div>

          <div className={styles.categoryMarquee}>
            <div className={styles.categoryTrack}>
              {[0, 1].map((group) => (
                <div key={group} className={styles.categoryTrackGroup}>
                  <button
                    className={`${styles.pill} ${!selectedSection ? styles.pillActive : ""}`}
                    onClick={() => { setSelectedSection(null); setSelectedCategory("all"); }}
                  >
                    <span className={styles.pillLogo}>🃏</span>
                    <span className={styles.pillText}>Todas las colecciones</span>
                  </button>

                  {themeSections.map((col) => (
                    <button
                      key={col.id}
                      className={`${styles.pill} ${selectedSection === col.id ? styles.pillActive : ""}`}
                      onClick={() => { setSelectedSection(col.id); setSelectedCategory("all"); }}
                    >
                      <span className={styles.pillLogo}>{col.logo || "🪙"}</span>
                      <span className={styles.pillText}>{col.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {selectedSection && activeSection && (
            <div className={styles.subcategoryWrapper}>
              <button className={styles.subArrow} onClick={() => scrollSubRow(-1)} aria-label="Izquierda">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <div className={styles.subcategoryRow} ref={subRowRef}>
                <button
                  className={`${styles.subPill} ${selectedCategory === "all" ? styles.subPillActive : ""}`}
                  onClick={() => setSelectedCategory("all")}
                >
                  <span className={styles.subPillDot} />
                  <span className={styles.subPillText}>Todas — {activeSection.name}</span>
                </button>
                {activeSection.subs.map((sub) => (
                  <button
                    key={sub.id}
                    className={`${styles.subPill} ${selectedCategory === sub.id ? styles.subPillActive : ""}`}
                    onClick={() => setSelectedCategory(sub.id)}
                  >
                    <span className={styles.subPillDot} />
                    <span className={styles.subPillText}>{sub.name}</span>
                  </button>
                ))}
              </div>
              <button className={styles.subArrow} onClick={() => scrollSubRow(1)} aria-label="Derecha">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
          )}
        </div>
      </section>


      {/* Escaparate horizontal de cromos con más me gusta */}
      <HorizontalScroll
        items={carouselItems}
        eyebrow="CROMOS MÁS POPULARES"
        title="Cromos con más me gusta"
        subtitle="Explora los cromos más populares de la comunidad deslizando hacia arriba y abajo."
      />

      {/* Parallax banner con text tracking */}
      <ParallaxBanner />

      {/* Tagline — COMPRA Y VENDE CON TOTAL SEGURIDAD Y EVITA LAS ESTAFAS */}
      <TaglineSection />
    </div>
  );
}
