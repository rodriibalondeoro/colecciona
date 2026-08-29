"use client";

import { useEffect } from "react";
import Lenis from "lenis";

/**
 * SmoothScroll — Scroll sedoso con Lenis.
 * Se desactiva si el usuario prefiere menos movimiento.
 */
export default function SmoothScroll() {
  useEffect(() => {
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || !window.matchMedia?.("(pointer: fine)").matches) return;

    const lenis = new Lenis({
      duration: 1.6,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      lerp: 0.09,
      wheelMultiplier: 0.7,
      touchMultiplier: 1.4,
      syncTouch: false,
    });

    let rafId;
    const raf = (time) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);

  return null;
}