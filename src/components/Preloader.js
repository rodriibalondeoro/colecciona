"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./Preloader.module.css";

export default function Preloader() {
  const [progress, setProgress] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setLeaving(true);
      setTimeout(() => setGone(true), 300);
      return;
    }

    document.documentElement.classList.add("preloader-active");

    // Easing suave y uniforme: contador y barra suben a la par, sin cola lenta
    const easeSmooth = (t) => t * t * (3 - 2 * t);
    const duration = 1500;
    const start = performance.now();
    let raf;

    const tick = (t) => {
      const raw = Math.min(1, (t - start) / duration);
      const pct = Math.floor(easeSmooth(raw) * 100);
      setProgress(pct);
      if (raw < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setTimeout(() => {
          setLeaving(true);
          document.documentElement.classList.remove("preloader-active");
          setTimeout(() => setGone(true), 800);
        }, 250);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove("preloader-active");
    };
  }, []);

  if (gone) return null;

  return (
    <div className={`${styles.preloader} ${leaving ? styles.leaving : ""}`} aria-hidden="true">
      <div className={styles.center}>
        <div className={styles.wordmark}>
          {"Colecciona".split("").map((ch, i) => (
            <span key={i} className={styles.letter} style={{ animationDelay: `${i * 45}ms` }}>
              {ch}
            </span>
          ))}
        </div>

        <div className={styles.counterWrap}>
          <span className={styles.counter}>{String(progress).padStart(3, "0")}</span>
          <span className={styles.percent}>%</span>
        </div>

        <div className={styles.barTrack}>
          <div className={styles.bar} style={{ width: `${progress}%` }} />
        </div>
      </div>

      <span className={styles.tag}>COMPRA · VENDE · COLECCIONA</span>
    </div>
  );
}