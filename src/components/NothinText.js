"use client";

import { useEffect, useRef } from "react";
import styles from "./NothinText.module.css";

/**
 * NothinText — Tipografía Cinética con Física de Repulsión de noth.in
 * Modos:
 * - outline: Contorno nítido neón (COLECCIONA)
 * - filled: Relleno completo de degradado de colorines (AUTÉNTICA)
 * - mix: Híbrido estilizado (DE MANERA) con contorno fino y resplandor de colorines
 */
export default function NothinText({
  text = "",
  className = "",
  filled = false,
  outline = false,
  mix = false,
}) {
  const containerRef = useRef(null);
  const letterRefs = useRef([]);
  const stateRef = useRef([]);

  const letters = text.split("");

  useEffect(() => {
    stateRef.current = letters.map(() => ({
      currentX: 0,
      currentY: 0,
      targetX: 0,
      targetY: 0,
      currentRot: 0,
      targetRot: 0,
    }));

    let rafId = null;

    const onMouseMove = (e) => {
      const mouseX = e.clientX;
      const mouseY = e.clientY;
      const RADIUS = 220;
      const MAX_DISPERSION = 140;

      letterRefs.current.forEach((el, i) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const dx = centerX - mouseX;
        const dy = centerY - mouseY;
        const dist = Math.hypot(dx, dy);

        const st = stateRef.current[i];
        if (!st) return;

        if (dist < RADIUS && dist > 0) {
          const angle = Math.atan2(mouseY - centerY, mouseX - centerX);
          const force = ((RADIUS - dist) / RADIUS) * MAX_DISPERSION;

          st.targetX = -Math.cos(angle) * force;
          st.targetY = -Math.sin(angle) * force;
          st.targetRot = (st.targetX / MAX_DISPERSION) * 16;
        } else {
          st.targetX = 0;
          st.targetY = 0;
          st.targetRot = 0;
        }
      });
    };

    const onMouseLeave = () => {
      stateRef.current.forEach((st) => {
        if (st) {
          st.targetX = 0;
          st.targetY = 0;
          st.targetRot = 0;
        }
      });
    };

    const render = () => {
      stateRef.current.forEach((st, i) => {
        const el = letterRefs.current[i];
        if (!el || !st) return;

        st.currentX += (st.targetX - st.currentX) * 0.14;
        st.currentY += (st.targetY - st.currentY) * 0.14;
        st.currentRot += (st.targetRot - st.currentRot) * 0.14;

        el.style.transform = `translate3d(${st.currentX.toFixed(2)}px, ${st.currentY.toFixed(2)}px, 0) rotate(${st.currentRot.toFixed(2)}deg)`;
      });

      rafId = requestAnimationFrame(render);
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseleave", onMouseLeave);
    render();

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeave);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [letters.length]);

  return (
    <div
      ref={containerRef}
      className={`${styles.nothinWrap} ${className} ${filled ? styles.filled : ""} ${outline ? styles.outline : ""} ${mix ? styles.mix : ""}`}
      aria-label={text}
    >
      {letters.map((char, idx) => {
        if (char === "É") {
          return (
            <span
              key={idx}
              ref={(el) => (letterRefs.current[idx] = el)}
              className={`${styles.char} ${styles.charWithAccent}`}
            >
              <span className={styles.cleanAccent} aria-hidden="true" />
              <span className={styles.baseChar}>E</span>
            </span>
          );
        }

        return (
          <span
            key={idx}
            ref={(el) => (letterRefs.current[idx] = el)}
            className={styles.char}
            style={{ display: char === " " ? "inline" : "inline-block" }}
          >
            {char === " " ? "\u00A0" : char}
          </span>
        );
      })}
    </div>
  );
}
