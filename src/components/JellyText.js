"use client";

import { useEffect, useRef } from "react";
import styles from "./JellyText.module.css";

/**
 * JellyText — Efecto de texto interactivo tipo gelatina (inspirado en haoqi.design).
 * Cada letra reacciona a la velocidad y posición del cursor con deformación física
 * de squash & stretch, oscilación elástica y rebote orgánico.
 */
export default function JellyText({
  text = "",
  className = "",
  filled = false,
  outline = false,
}) {
  const containerRef = useRef(null);
  const lettersRef = useRef([]);
  const physicsRef = useRef([]);

  const letters = text.split("");

  useEffect(() => {
    // Inicializar estado físico para cada letra
    physicsRef.current = letters.map(() => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      sx: 1,
      sy: 1,
      vsx: 0,
      vsy: 0,
      rot: 0,
      vrot: 0,
    }));

    let prevMouse = { x: 0, y: 0, time: Date.now() };
    let mouseSpeed = { x: 0, y: 0, mag: 0 };
    let rafId = null;
    let isActive = false;

    const onPointerMove = (e) => {
      const now = Date.now();
      const dt = Math.max(1, now - prevMouse.time);
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;

      mouseSpeed = {
        x: dx / dt,
        y: dy / dt,
        mag: Math.hypot(dx, dy) / dt,
      };

      prevMouse = { x: e.clientX, y: e.clientY, time: now };
      isActive = true;

      // Aplicar impulso de gelatina a las letras cercanas
      lettersRef.current.forEach((el, i) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const dist = Math.hypot(e.clientX - centerX, e.clientY - centerY);
        const radius = Math.max(80, rect.width * 1.5);

        if (dist < radius) {
          const power = Math.pow(1 - dist / radius, 1.6);
          const p = physicsRef.current[i];
          if (!p) return;

          // Squash & stretch según velocidad del cursor
          const speedFactor = Math.min(2.5, mouseSpeed.mag * 0.4);
          const dirX = mouseSpeed.x !== 0 ? Math.sign(mouseSpeed.x) : 1;
          const dirY = mouseSpeed.y !== 0 ? Math.sign(mouseSpeed.y) : 1;

          p.vx += mouseSpeed.x * power * 1.8;
          p.vy += mouseSpeed.y * power * 1.8;

          // Deformación de gelatina (squash transversal, stretch longitudinal)
          p.vsx += (speedFactor * power * 0.35 * Math.abs(dirX));
          p.vsy -= (speedFactor * power * 0.28);
          p.vrot += (e.clientX - centerX) * power * 0.15;
        }
      });
    };

    // Bucle de animación de física de resorte (Spring Physics Damping)
    const STIFFNESS = 0.12; // Tensión del resorte
    const DAMPING = 0.82;   // Fricción / amortiguación gelatinosa

    const loop = () => {
      let moving = false;

      physicsRef.current.forEach((p, i) => {
        const el = lettersRef.current[i];
        if (!el) return;

        // Fuerzas de retorno elásticas
        const fx = (0 - p.x) * STIFFNESS;
        const fy = (0 - p.y) * STIFFNESS;
        const fsx = (1 - p.sx) * (STIFFNESS * 1.2);
        const fsy = (1 - p.sy) * (STIFFNESS * 1.2);
        const frot = (0 - p.rot) * (STIFFNESS * 0.9);

        // Integración de velocidad con amortiguación
        p.vx = (p.vx + fx) * DAMPING;
        p.vy = (p.vy + fy) * DAMPING;
        p.vsx = (p.vsx + fsx) * DAMPING;
        p.vsy = (p.vsy + fsy) * DAMPING;
        p.vrot = (p.vrot + frot) * DAMPING;

        // Actualización de posición y escala
        p.x += p.vx;
        p.y += p.vy;
        p.sx += p.vsx;
        p.sy += p.vsy;
        p.rot += p.vrot;

        // Comprobar si aún hay movimiento perceptible
        if (
          Math.abs(p.vx) > 0.001 ||
          Math.abs(p.vy) > 0.001 ||
          Math.abs(p.sx - 1) > 0.001 ||
          Math.abs(p.sy - 1) > 0.001 ||
          Math.abs(p.rot) > 0.01
        ) {
          moving = true;
        }

        // Aplicar transformación 3D de gelatina
        el.style.transform = `translate3d(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px, 0) scale(${p.sx.toFixed(3)}, ${p.sy.toFixed(3)}) rotate(${p.rot.toFixed(2)}deg)`;
      });

      rafId = requestAnimationFrame(loop);
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener("pointermove", onPointerMove, { passive: true });
    }
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    loop();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (container) container.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [letters.length]);

  return (
    <div
      ref={containerRef}
      className={`${styles.jellyWrap} ${className} ${filled ? styles.filled : ""} ${outline ? styles.outline : ""}`}
      aria-label={text}
    >
      {letters.map((char, idx) => (
        <span
          key={idx}
          ref={(el) => (lettersRef.current[idx] = el)}
          className={styles.char}
          style={{ display: char === " " ? "inline" : "inline-block" }}
        >
          {char === " " ? "\u00A0" : char}
        </span>
      ))}
    </div>
  );
}
