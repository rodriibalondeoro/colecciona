"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import FoilCard from "./FoilCard";
import SpinStamp from "./SpinStamp";
import styles from "./HorizontalScroll.module.css";

export default function HorizontalScroll({
  items = [],
  eyebrow = "CROMOS MÁS POPULARES",
  title = "Cromos con más me gusta",
  subtitle = "Explora los cromos más populares de la comunidad deslizando hacia arriba y abajo.",
}) {
  const sectionRef = useRef(null);
  const trackRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    const track = trackRef.current;
    if (!section || !track || typeof window === "undefined") return;

    let rafId = null;

    const update = () => {
      rafId = null;
      const rect = section.getBoundingClientRect();
      const scrollable = section.offsetHeight - window.innerHeight;

      if (rect.top > 0 || scrollable <= 0) {
        track.style.transform = "translate3d(0, 0, 0)";
        setActiveIdx(0);
        return;
      }

      const p = Math.max(0, Math.min(1, -rect.top / scrollable));
      const count = items.length;
      const active = Math.min(count - 1, Math.floor(p * count));
      setActiveIdx(active);

      // Desplazamiento horizontal fluido y centrado
      const maxScroll = Math.max(0, track.scrollWidth - window.innerWidth + (window.innerWidth > 1400 ? (window.innerWidth - 1400) / 2 : 60));
      const tx = p * maxScroll;
      track.style.transform = `translate3d(${-tx.toFixed(1)}px, 0, 0)`;
    };

    const onScroll = () => {
      if (!rafId) rafId = requestAnimationFrame(update);
    };

    const onResize = () => update();

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [items.length]);

  if (!items.length) return null;

  return (
    <section ref={sectionRef} className={styles.section}>
      <div className={styles.sticky}>
        <div ref={trackRef} className={styles.track}>
          {/* Bloque intro a la izquierda */}
          <div className={styles.intro}>
            <span className={styles.eyebrow}>{eyebrow}</span>
            <h2 className={styles.heading}>{title}</h2>
            <p className={styles.sub}>{subtitle}</p>
            <span className={styles.shimmer}>DESLIZA PARA EXPLORAR →</span>
          </div>

          {/* Los 3 cromos con más me gusta */}
          {items.map((item, idx) => {
            const isActive = idx === activeIdx;
            return (
              <Link
                key={item.id}
                href={`/product/${item.id}`}
                className={`${styles.card} ${isActive ? styles.activeCard : ""}`}
                style={{ "--tilt": `${(idx - 1) * 2}deg` }}
                draggable={false}
              >
                <div className={styles.frame}>
                  <FoilCard>
                    <Image
                      src={item.image}
                      alt={item.title}
                      fill
                      sizes="280px"
                      className={styles.img}
                      priority={idx < 3}
                      draggable={false}
                    />
                  </FoilCard>
                  <span className={styles.badge}>
                    #{String(idx + 1).padStart(2, "0")}
                  </span>
                </div>
                <div className={styles.meta}>
                  <span className={styles.set}>{item.set}</span>
                  <h3 className={styles.name}>{item.title}</h3>
                  <span className={styles.price}>
                    {Number(item.price).toFixed(2)} €
                  </span>
                </div>
              </Link>
            );
          })}

          {/* Outro a la derecha centrado con el bloque izquierdo */}
          <div className={styles.outro}>
            <span className={styles.outroCode}>COLECCIONA</span>
            <Link href="/marketplace" className={styles.outroLink}>
              Ver todo el mercado →
            </Link>
          </div>
        </div>

        {/* Sello circular giratorio con texto COLECCIONA en colorines */}
        <div className={styles.bottomStampWrapper}>
          <SpinStamp text="COLECCIONA · COLECCIONA · COLECCIONA · " colorines={true} className={styles.outroStamp} />
        </div>

        {/* Barra inferior coordinada con la carta activa */}
        <div className={styles.bar}>
          <div className={styles.barLine} />
          <span className={styles.barText}>
            {activeIdx + 1} / {items.length} cromos
          </span>
        </div>
      </div>
    </section>
  );
}