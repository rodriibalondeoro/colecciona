"use client";

import { useEffect, useRef } from "react";
import styles from "./SetMarquee.module.css";

const WORDS = [
  "POKÉMON",
  "MAGIC THE GATHERING",
  "YU-GI-OH!",
  "ONE PIECE",
  "ESCROW",
  "ENVÍO QR",
  "AUTENTICADO",
  "8% COMISIÓN",
];

/**
 * SetMarquee — Banda infinita de palabras que se mueve en bucle y
 * acelera / se inclina según la velocidad del scroll (efecto awwwards).
 */
export default function SetMarquee({ words = WORDS, className = "" }) {
  const skewRef = useRef(null);
  const rowRef = useRef(null);

  useEffect(() => {
    const skew = skewRef.current;
    const row = rowRef.current;
    if (!skew || !row) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let raf;
    let lastY = window.scrollY;
    const loop = () => {
      const y = window.scrollY;
      const v = (y - lastY) * 0.12;
      lastY = y;
      row.style.animationDuration = `${Math.max(16, 34 - Math.abs(v) * 0.35).toFixed(2)}s`;
      skew.style.setProperty("--skew", `${Math.max(-3, Math.min(3, v * 0.03))}deg`);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const doubled = [...words, ...words];

  return (
    <div className={`${styles.band} ${className}`} aria-hidden="true">
      <div ref={skewRef} className={styles.skew}>
        <div ref={rowRef} className={styles.row}>
          {doubled.map((w, i) => (
            <span className={styles.item} key={i}>
              <span className={styles.word}>{w}</span>
              <span className={styles.dot}>✦</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}