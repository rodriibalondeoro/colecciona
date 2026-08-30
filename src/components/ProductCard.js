"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { VerifiedBadge } from "./Badge";
import FoilCard from "./FoilCard";
import { useApp } from "@/context/AppContext";
import { hapticLight } from "@/lib/haptics";
import { collections } from "@/data/collections";
import styles from "./ProductCard.module.css";

export default function ProductCard({ product, seller, onDelete, onSelect, session }) {
  const [loaded, setLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0, shine: 50 });
  const cardRef = useRef(null);
  const { favorites, toggleFavorite } = useApp();
  const isFavorite = favorites.has(product.id);
  const hasImage = product.image && !imgError;
  const isOwner = session && (
    session.id === product.seller?.id ||
    session.id === product.seller ||
    session.email === product.seller?.email
  );

  const themeSectionIds = [
    'mundial', 'tlg-futbol', 'champions', 'baloncesto', 'beisbol',
    'nfl-ufc', 'motor', 'comics-cine', 'nintendo', 'especial-digital',
  ];

  function getCollectionName(categoryId) {
    for (const col of collections) {
      if (!themeSectionIds.includes(col.id)) continue;
      if (col.id === categoryId) return col.name;
      for (const sub of col.subs || []) {
        if (sub.id === categoryId) return `${col.name} / ${sub.name}`;
      }
    }
    return "";
  }
  const collectionName = getCollectionName(product.category);
  const baseLikes = product.favorites || product.favorites_count || product.likes || 0;

  const reducedRef = useRef(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );

  // Navegación garantizada: un flag + temporizador, no depende del evento
  // de animación (que no siempre dispara).
  const firedRef = useRef(false);
  const timerRef = useRef(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const triggerSelect = useCallback(() => {
    if (firedRef.current || !onSelect) return;
    firedRef.current = true;
    if (reducedRef.current) {
      onSelect();
      return;
    }
    const el = cardRef.current;
    if (el && el.parentElement) el.parentElement.style.zIndex = 90;
    setLeaving(true);
    timerRef.current = setTimeout(() => onSelect(), 780);
  }, [onSelect]);

  // Toda la tarjeta clicable (excepto botones) para entrar en la carta
  const handleCardClick = useCallback(
    (e) => {
      if (!onSelect) return;
      if (e.target.closest("button")) return;
      if (e.defaultPrevented) return;
      e.preventDefault();
      hapticLight();
      triggerSelect();
    },
    [onSelect, triggerSelect]
  );

  // Clic en los enlaces de imagen/título: si hay onSelect, evitamos la
  // navegación de Next y lanzamos el giro. En la home (sin onSelect) actúa
  // como un enlace normal.
  const handleLinkClick = useCallback(
    (e) => {
      if (!onSelect) return;
      e.preventDefault();
      hapticLight();
      triggerSelect();
    },
    [onSelect, triggerSelect]
  );

  const handleMouseMove = useCallback((e) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const tiltX = (0.5 - y) * 8;
    const tiltY = (x - 0.5) * 8;
    const shine = x * 100;
    card.style.setProperty("--spot-x", `${x * 100}%`);
    card.style.setProperty("--spot-y", `${y * 100}%`);
    setTilt({ x: tiltX, y: tiltY, shine });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTilt({ x: 0, y: 0, shine: 50 });
  }, []);

  return (
    <div
      ref={cardRef}
      className={`${styles.card} ${leaving ? styles.leaving : ""}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={onSelect ? handleCardClick : undefined}
      style={{
        transform: `perspective(600px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        transition: tilt.x === 0 ? "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)" : "transform 0.1s ease-out",
      }}
    >
      <div className={styles.cardClip}>
        <div className={styles.spotlight} aria-hidden="true" />
        <Link href={`/product/${product.id}`} className={styles.imageLink} onClick={handleLinkClick}>
        <div className={styles.imageBox}>
          <div className={styles.flip}>
            <div className={styles.flipInner}>
              <div className={styles.front}>
                {!loaded && <div className={styles.skeleton} />}
                {hasImage ? (
                  <FoilCard>
                    <Image
                      src={product.image}
                      alt={product.title}
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      className={`${styles.cardImage} ${loaded ? styles.loaded : ""}`}
                      onLoad={() => setLoaded(true)}
                      onError={() => setImgError(true)}
                    />
                  </FoilCard>
                ) : (
                  <div className={styles.placeholder}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    <span className={styles.placeholderText}>{product.code || "TCG"}</span>
                  </div>
                )}
              </div>
              <div className={styles.back}>
                <span className={styles.backLogo}>C</span>
                <span className={styles.backTitle}>{product.title}</span>
                {collectionName && <span className={styles.backSetName}>{collectionName}</span>}
                <div className={styles.backDivider} />
                <strong className={styles.backPrice}>
                  {typeof product.price === "number" ? product.price.toFixed(2) : product.price} €
                </strong>
                <span className={styles.backBrand}>COLLECCIONA</span>
              </div>
            </div>
          </div>
          <div className={styles.shineOverlay} style={{ background: `linear-gradient(105deg, transparent ${tilt.shine - 15}%, rgba(255,255,255,0.06) ${tilt.shine}%, transparent ${tilt.shine + 15}%)` }} />
        </div>
      </Link>
      </div>

      {/* Favorite / Heart button */}
      <button
        className={`${styles.bookmarkBtn} ${isFavorite ? styles.saved : ""}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          hapticLight();
          toggleFavorite(product.id);
        }}
        aria-label={isFavorite ? "Quitar de favoritos" : "Guardar en favoritos"}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill={isFavorite ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </button>

      {onDelete && (
        <button
          className={styles.deleteBtn}
          disabled={deleting}
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!confirm("¿Eliminar esta carta del mercado?")) return;
            setDeleting(true);
            try {
              await onDelete(product.id);
            } finally {
              setDeleting(false);
            }
          }}
          aria-label="Eliminar producto"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      )}

      <div className={styles.metaBox}>
        <Link href={`/product/${product.id}`} className={styles.titleLink} onClick={handleLinkClick}>
          <h3 className={styles.title}>{product.title}</h3>
        </Link>

        {collectionName && (
          <span className={styles.collectionLabel}>{collectionName}</span>
        )}

        <div className={styles.priceRow}>
          <div className={styles.priceContainer}>
            <span className={styles.priceLabel}>Precio</span>
            <span className={styles.priceValue}>
              {product.price.toFixed(2)} €
            </span>
          </div>
          <div className={styles.likesCount}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            {baseLikes + (isFavorite ? 1 : 0)}
          </div>
        </div>

        {isOwner && product.views > 0 && (
          <div className={styles.ownerStats}>
            <span className={styles.statItem}>👁️ {product.views} visitas</span>
          </div>
        )}

        {seller && (
          <div className={styles.sellerRow}>
            <div className={styles.avatarCircle}>
              {seller.initials || seller.name?.charAt(0)}
            </div>
            <span className={styles.sellerHandle}>@{seller.username}</span>
            {seller.verified && <VerifiedBadge />}
          </div>
        )}
      </div>
    </div>
  );
}
