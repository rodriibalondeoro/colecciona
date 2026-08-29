"use client";

import { useEffect, useRef } from "react";

/**
 * useHeroScroll — Efecto del hero tipo ciaoenergy: al hacer scroll,
 * el contenido se escala, baja, se desenfoca y se desvanece.
 * Aplica variables CSS sobre el elemento: --hero-scale, --hero-y,
 * --hero-opacity, --hero-blur.
 */
export function useHeroScroll(distance = 650) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let raf;
    const update = () => {
      raf = requestAnimationFrame(() => {
        const p = Math.min(1, Math.max(0, window.scrollY / distance));
        el.style.setProperty("--hero-scale", (1 - p * 0.12).toFixed(3));
        el.style.setProperty("--hero-y", `${p * 90}px`);
        el.style.setProperty("--hero-opacity", (1 - p * 0.95).toFixed(3));
        el.style.setProperty("--hero-blur", `${p * 10}px`);
      });
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      cancelAnimationFrame(raf);
    };
  }, [distance]);

  return ref;
}