"use client";

import { useEffect, useRef, useState } from "react";
import JellyText from "./JellyText";
import styles from "./ParallaxBanner.module.css";

/* Palabra animada: va entre COLECCIONA y AUTÉNTICO, más pequeña */
const FLIP_WORD = "DE MANERA";

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/**
 * ParallaxBanner — Banner COLECCIONA / AUTÉNTICO
 * - Las dos palabras grandes (COLECCIONA contorneada, AUTÉNTICO con
 *   colorines) con efecto gelatina interactivo.
 * - Al hacer scroll hacia abajo: COLECCIONA se desplaza entera a la
 *   derecha, AUTÉNTICO a la izquierda y "DE MANERA" se abre (sus letras
 *   se alejan del centro). En la segunda mitad del recorrido todo
 *   RECONVERGE al centro, así el banner termina igual que empezó.
 */
export default function ParallaxBanner({ className = "" }) {
  const sectionRef = useRef(null);
  const flipWrapRef = useRef(null);
  const groupARef = useRef(null);
  const lineATrackRef = useRef(null);
  const lineBTrackRef = useRef(null);

  const [mounted, setMounted] = useState(false);

  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  /* --------------------------- Reveal de líneas al montar --------------------------- */
  useEffect(() => {
    if (reduced) return;
    const id = window.setTimeout(() => {
      setMounted(true);
    }, 80);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------- Desplazamiento horizontal + alargado de DE MANERA ------------- */
  useEffect(() => {
    const groupA = groupARef.current;
    if (!groupA) return;
    if (reduced) return;

    let travelA = 0;
    let travelB = 0;
    let lsMax = 0;
    let lsBase = 0;
    let axTarget = 0;
    let bxTarget = 0;
    let rafId = null;

    /* Todas las mediciones se calculan fuera del bucle de scroll para no
       forzar relayout cada frame. Se re-miden al montar, al redimensionar
       y cuando cargan las fuentes (los anchos cambian tras la carga). */
    const compute = () => {
      const vw = window.innerWidth;
      const pad = Math.max(vw * 0.05, 24);
      const lineA = lineATrackRef.current;
      const lineB = lineBTrackRef.current;
      const wA = lineA ? lineA.clientWidth : 0;
      const wB = lineB ? lineB.clientWidth : 0;
      travelA = Math.max(0, vw - 2 * pad - wA);
      travelB = Math.min(0, wB + 2 * pad - vw);

      /* DE MANERA: medir ancho natural y calcular el espaciado máximo
         entre letras para que la palabra ocupe todo el ancho al llegar
         abajo. Espaciado base del reposo = 0.16em (igual que el CSS). */
      groupA.style.letterSpacing = "0px";
      Array.from(groupA.children).forEach((ch) => {
        ch.style.marginRight = "0px";
      });
      const naturalW = groupA.clientWidth;
      const targetW = vw - 2 * pad;
      const n = FLIP_WORD.length;
      lsBase = parseFloat(getComputedStyle(groupA).fontSize) * 0.16;
      const target = n > 1 ? Math.max(0, (targetW - naturalW) / (n - 1)) : 0;
      lsMax = Math.max(lsBase, target);

      /* Posición ideal centrada de cada línea (depende del ancho) */
      const lineAW = lineA ? lineA.clientWidth : 0;
      const lineBW = lineB ? lineB.clientWidth : 0;
      const cxTarget = vw / 2;
      axTarget = cxTarget - (pad + lineAW / 2);
      bxTarget = cxTarget - (vw - pad - lineBW / 2);
    };

    const apply = () => {
      const section = sectionRef.current;
      if (!section) return;
      const r = section.getBoundingClientRect();
      const vh = window.innerHeight;
      /* Tres fases:
         - 0→0.35: las palabras se separan (dry)
         - 0.35→0.6: convergen al centro
         - 0.6→1: SE QUEDAN centradas mientras el scroll entrega la
           sección a la siguiente. */
      const avail = Math.max(0, r.height - vh);
      const progress = clamp(-r.top / Math.max(1, avail), 0, 1);

      const pSpread = clamp(progress / 0.35, 0, 1);
      const pConverge = clamp((progress - 0.35) / 0.25, 0, 1);
      const easeConverge = pConverge * pConverge * (3 - 2 * pConverge);
      /* 1 cuando se separa del todo, 0 cuando ya está centrado */
      const k = pSpread * (1 - easeConverge);

      const lineA = lineATrackRef.current;
      const lineB = lineBTrackRef.current;

      const ax = travelA * k + axTarget * easeConverge;
      const bx = travelB * k + bxTarget * easeConverge;
      if (lineA) lineA.style.transform = `translate3d(${ax.toFixed(1)}px, 0, 0)`;
      if (lineB) lineB.style.transform = `translate3d(${bx.toFixed(1)}px, 0, 0)`;

      /* DE MANERA se alarga con la separación y vuelve al espaciado base
         cuando todo queda centrado (k=0 → espaciado base) */
      const ls = lsBase + (lsMax - lsBase) * k;
      groupA.style.letterSpacing = "0px";
      Array.from(groupA.children).forEach((ch, ci, arr) => {
        ch.style.marginRight = ci === arr.length - 1 ? "0px" : `${ls.toFixed(2)}px`;
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
      compute();
      apply();
    };

    compute();
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    let fontsReady = null;
    if (document.fonts?.ready) {
      fontsReady = document.fonts.ready.then(() => {
        compute();
        apply();
      });
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (fontsReady && fontsReady.cancel) fontsReady.cancel();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      groupA.style.letterSpacing = "";
      Array.from(groupA.children).forEach((ch) => {
        ch.style.marginRight = "";
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section ref={sectionRef} className={`${styles.banner} ${className}`} aria-label="Colecciona de manera auténtica">
      <div className={styles.stage}>
        <div className={styles.col}>
          {/* Línea 1 — COLECCIONA */}
          <div className={styles.lineMask}>
            <div
              className={`${styles.titleLine} ${styles.lineA} ${!mounted && !reduced ? styles.pending : ""}`}
              style={{ transitionDelay: "0.1s" }}
            >
              <div ref={lineATrackRef} className={styles.track}>
                <JellyText text="COLECCIONA" outline />
              </div>
            </div>
          </div>

          {/* Palabra animada "DE MANERA" — debajo de COLECCIONA, más pequeña */}
          <div
            ref={flipWrapRef}
            className={`${styles.flipWord} ${!mounted && !reduced ? styles.pending : ""}`}
            style={{ transitionDelay: "0.28s" }}
            aria-hidden="true"
          >
            <div ref={groupARef} className={styles.flipGroup}>
              {FLIP_WORD.split("").map((ch, i) => (
                <span key={`a-${i}`} className={styles.flipLetter}>
                  {ch === " " ? "\u00A0" : ch}
                </span>
              ))}
            </div>
          </div>

          {/* Línea 2 — AUTÉNTICA con colorines */}
          <div className={styles.lineMask}>
            <div
              className={`${styles.titleLine} ${styles.lineB} ${!mounted && !reduced ? styles.pending : ""}`}
              style={{ transitionDelay: "0.45s" }}
            >
              <div ref={lineBTrackRef} className={styles.track}>
                <JellyText text="AUTÉNTICA" filled />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}