"use client";

import { useRef, useEffect } from "react";
import styles from "./FoilCard.module.css";

/**
 * FoilCard — Efecto carta holográfica Foil 3D.
 * - Desktop: tilt 3D + brillo que sigue al cursor.
 * - Móvil: usa el acelerómetro (deviceorientation) si está disponible.
 *
 * Envuelve cualquier contenido (carta). No añade contenedor extra: pasa el
 * className por si el padre necesita aplicar estilos de tamaño.
 */
export default function FoilCard({ children, className = "", intensity = 14 }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const tilt = intensity * 2;

    const apply = (rx, ry) => {
      el.style.setProperty("--rx", `${Math.max(-tilt, Math.min(tilt, rx))}deg`);
      el.style.setProperty("--ry", `${Math.max(-tilt, Math.min(tilt, ry))}deg`);
    };

    const isCoarse = window.matchMedia?.("(pointer: coarse)").matches;

    if (!isCoarse) {
      const onPointerMove = (e) => {
        const rect = el.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        apply((0.5 - py) * tilt * 2, (px - 0.5) * tilt * 2);
        el.style.setProperty("--shine-x", `${px * 100}%`);
        el.style.setProperty("--shine-y", `${py * 100}%`);
      };
      const onPointerLeave = () => {
        apply(0, 0);
        el.style.setProperty("--shine-x", "50%");
        el.style.setProperty("--shine-y", "50%");
      };
      el.addEventListener("pointermove", onPointerMove);
      el.addEventListener("pointerleave", onPointerLeave);
      return () => {
        el.removeEventListener("pointermove", onPointerMove);
        el.removeEventListener("pointerleave", onPointerLeave);
      };
    }

    if (typeof window !== "undefined" && "DeviceOrientationEvent" in window) {
      const onDeviceOrientation = (e) => {
        const beta = e.beta ?? 0; // inclinación frontal/trasera
        const gamma = e.gamma ?? 0; // inclinación derecha/izquierda
        const rx = (beta > 0 ? -beta : -beta) * 0.4;
        const ry = gamma * 0.6;
        apply(rx, ry);
        el.style.setProperty("--shine-x", `${50 + ry * 4}%`);
        el.style.setProperty("--shine-y", `${50 - rx * 4}%`);
      };
      window.addEventListener("deviceorientation", onDeviceOrientation);
      return () =>
        window.removeEventListener("deviceorientation", onDeviceOrientation);
    }
  }, [intensity]);

  return (
    <div ref={ref} className={styles.foil}>
      {children}
      <div className={styles.shine} aria-hidden="true" />
      <div className={styles.holo} aria-hidden="true" />
      <div className={styles.borderGlow} aria-hidden="true" />
    </div>
  );
}