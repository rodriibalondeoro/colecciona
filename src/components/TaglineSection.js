"use client";

import { useEffect, useRef } from "react";
import styles from "./TaglineSection.module.css";

/* El tagline de la marca, partido en grupos. Cada grupo se revela como
   un "muñeco" de scroll: conforme avanzas, sus palabras suben con un
   pequeño asentamiento (rotación) en cascada. Al final, un fade de
   acento (glow) y un micro zoom de clímax cierran la sección. */
const TAGLINE_GROUPS = [
  ["COMPRA", "Y", "VENDE"],
  ["CON", "TOTAL", "SEGURIDAD"],
  ["Y"],
  ["EVITA", "LAS", "ESTAFAS"],
];

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export default function TaglineSection({ className = "" }) {
  const sectionRef = useRef(null);
  const stackRef = useRef(null);
  const glowRef = useRef(null);
  const groupsRef = useRef([]);

  useEffect(() => {
    const section = sectionRef.current;
    const stack = stackRef.current;
    if (!section || !stack) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    let rafId = null;
    let maskHeights = new Map();

    /* Medición única de alturas: fuera del bucle de scroll para no forzar
       relayout en cada frame. Se re-mide al redimensionar y tras cargar
       las fuentes. */
    const measure = () => {
      maskHeights = new Map();
      groupsRef.current.forEach((groupEl) => {
        if (!groupEl) return;
        Array.from(groupEl.children).forEach((mask) => {
          maskHeights.set(mask, mask.scrollHeight);
        });
      });
    };

    const apply = () => {
      const r = section.getBoundingClientRect();
      const vh = window.innerHeight;
      const avail = Math.max(0, r.height - vh);
      const progress = clamp(-r.top / Math.max(1, avail), 0, 1);

      /* El reveal se completa en la primera mitad del scroll (progress
         0→0.5). La segunda mitad es el tagline visible y estático,
         centrado, antes de que el footer se suba por encima. */
      const revealP = clamp(progress * 2.5, 0, 1);

      const nGroups = TAGLINE_GROUPS.length;
      const step = revealP * nGroups;
      const active = clamp(Math.floor(step), 0, nGroups - 1);
      const notcha = clamp((step - active) / 0.6, 0, 1);
      const easeOut = (t) => 1 - Math.pow(1 - t, 3);

      const fullP = clamp((revealP - (nGroups - 1) / nGroups) / (1 / nGroups), 0, 1);
      const scale = 1 + 0.035 * easeOut(fullP);
      stack.style.transform = `scale(${scale.toFixed(4)})`;

      const glow = glowRef.current;
      if (glow) {
        glow.style.opacity = easeOut(clamp((revealP - 0.4) / 0.6, 0, 1)).toFixed(3);
      }

      groupsRef.current.forEach((groupEl, g) => {
        if (!groupEl) return;
        const inV = g < active ? 1 : g === active ? notcha : 0;
        Array.from(groupEl.children).forEach((mask, wi) => {
          const word = mask.children[0] || mask;
          /* La cascada (stagger) solo aplica al grupo en transición; un
             grupo ya revelado queda siempre al completo (inV = 1), así
             la última palabra no se queda a medio asentarse. */
          const e = inV >= 1 ? 1 : easeOut(clamp(inV * 1.15 - wi * 0.28, 0, 1));
          const y = 120 * (1 - e);
          const rot = (1 - e) * 6;
          word.style.transform = `translate3d(0, ${y.toFixed(2)}%, 0) rotate(${rot.toFixed(2)}deg)`;
          word.style.opacity = e.toFixed(3);
          const vis = e > 0.01;
          mask.style.maxHeight = vis ? `${maskHeights.get(mask) || 0}px` : "0";
          mask.style.marginTop = vis ? "" : "0";
        });
      });
    };

    const onScroll = () => {
      if (document.hidden) return;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        apply();
      });
    };

    const onResize = () => {
      measure();
      apply();
    };

    measure();
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    let fontsReady = null;
    if (document.fonts?.ready) {
      fontsReady = document.fonts.ready.then(() => {
        measure();
        apply();
      });
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (fontsReady && fontsReady.cancel) fontsReady.cancel();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className={`${styles.section} ${className}`}
      aria-label="Compra y vende con total seguridad y evita las estafas"
    >
      <div className={styles.stage}>
        <div ref={glowRef} className={styles.glow} aria-hidden="true"></div>
        <div ref={stackRef} className={styles.stack}>
          {TAGLINE_GROUPS.map((group, gi) => (
            <div
              key={gi}
              ref={(el) => {
                groupsRef.current[gi] = el;
              }}
              className={styles.group}
            >
              {group.map((w, wi) => (
                <span key={wi} className={styles.mask}>
                  <span className={styles.word}>{w}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}