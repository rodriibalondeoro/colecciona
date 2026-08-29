"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import FoilCard from "./FoilCard";
import styles from "./ScrollCardCarousel.module.css";

/**
 * ScrollCardCarousel — Galería horizontal "arrastra y desliza":
 * el usuario mueve la fila de cartas hacia la izquierda o derecha
 * (arrastre, swipe, rueda o trackpad). Parallax por tarjeta según
 * su posición horizontal respecto al centro.
 */
export default function ScrollCardCarousel({ items, eyebrow = "MÁS POPULARES", className = "" }) {
  const viewportRef = useRef(null);
  const cardRefs = useRef([]);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startScroll = useRef(0);
  const [progress, setProgress] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reduced || items.length === 0) return;
    const vp = viewportRef.current;
    if (!vp) return;

    let raf;
    const updateParallax = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = vp.scrollWidth - vp.clientWidth;
        setProgress(max > 0 ? vp.scrollLeft / max : 0);

        const center = vp.clientWidth / 2;
        cardRefs.current.forEach((card) => {
          if (!card) return;
          const cr = card.getBoundingClientRect();
          const cc = cr.left + cr.width / 2;
          const ease = Math.min(1, Math.abs(cc - center) / (window.innerWidth * 0.55));
          card.style.setProperty("--par-scale", (1 - ease * 0.18).toFixed(3));
          card.style.setProperty("--par-op", (1 - ease * 0.55).toFixed(3));
          card.style.setProperty("--par-y", `${(ease * 36).toFixed(1)}px`);
        });
      });
    };

    const onScroll = () => updateParallax();

    const onWheel = (e) => {
      e.preventDefault();
      vp.scrollLeft += (e.deltaX || e.deltaY) * 1.2;
      updateParallax();
    };

    const onPointerDown = (e) => {
      dragging.current = true;
      startX.current = e.clientX;
      startScroll.current = vp.scrollLeft;
      vp.classList.add(styles.dragging);
      try {
        vp.setPointerCapture(e.pointerId);
      } catch {}
    };

    const onPointerMove = (e) => {
      if (!dragging.current) return;
      vp.scrollLeft = startScroll.current - (e.clientX - startX.current);
      updateParallax();
    };

    const endDrag = () => {
      if (!dragging.current) return;
      dragging.current = false;
      vp.classList.remove(styles.dragging);
    };

    vp.addEventListener("wheel", onWheel, { passive: false });
    vp.addEventListener("pointerdown", onPointerDown);
    vp.addEventListener("pointermove", onPointerMove);
    vp.addEventListener("pointerup", endDrag);
    vp.addEventListener("pointercancel", endDrag);
    vp.addEventListener("pointerleave", endDrag);
    vp.addEventListener("scroll", onScroll, { passive: true });
    updateParallax();

    return () => {
      vp.removeEventListener("wheel", onWheel);
      vp.removeEventListener("pointerdown", onPointerDown);
      vp.removeEventListener("pointermove", onPointerMove);
      vp.removeEventListener("pointerup", endDrag);
      vp.removeEventListener("pointercancel", endDrag);
      vp.removeEventListener("pointerleave", endDrag);
      vp.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced, items.length]);

  if (reduced || items.length === 0) {
    return (
      <section className={`${styles.simple} ${className}`}>
        <div className={styles.simpleTitle}>{eyebrow}</div>
        <div className={styles.simpleGrid}>
          {items.map((item) => (
            <Link key={item.id} href={`/product/${item.id}`} className={styles.simpleCard}>
              <Image src={item.image} alt={item.title} fill sizes="300px" style={{ objectFit: "cover" }} />
            </Link>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.wrap} ${className}`}>
      {/* Cabecera */}
      <div className={styles.head}>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h2 className={styles.title}>Colección que está arrasando</h2>
        <span className={styles.dragHint}>DESLIZA →</span>
      </div>

      {/* Fila arrastrable */}
      <div ref={viewportRef} className={styles.viewport}>
        <div className={styles.track}>
          {items.map((item, i) => (
            <Link
              key={item.id}
              ref={(el) => (cardRefs.current[i] = el)}
              href={`/product/${item.id}`}
              className={styles.card}
              data-cursor
              draggable={false}
            >
              <span className={styles.cardIndex}>{String(i + 1).padStart(2, "0")}</span>
              <div className={styles.cardMedia}>
                <FoilCard>
                  <Image
                    src={item.image}
                    alt={item.title}
                    fill
                    placeholder="empty"
                    quality={85}
                    sizes="280px"
                    style={{ objectFit: "cover", pointerEvents: "none" }}
                    draggable={false}
                  />
                </FoilCard>
                <div className={styles.cardShade} aria-hidden="true" />
              </div>
              <div className={styles.cardBody}>
                <span className={styles.cardSet}>{item.set}</span>
                <span className={styles.cardTitle}>{item.title}</span>
                <span className={styles.cardPrice}>{Number(item.price).toFixed(2)} €</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Barra de progreso */}
      <div className={styles.pbar}>
        <div className={styles.pbarTrack}>
          <div className={styles.pbarFill} style={{ transform: `scaleX(${progress})` }} />
        </div>
        <span className={styles.pbarCount}>{Math.round(progress * items.length)} / {items.length}</span>
      </div>
    </section>
  );
}