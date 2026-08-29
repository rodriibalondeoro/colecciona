"use client";

import { useId, useState, useEffect, useRef, useCallback } from "react";
import styles from "./TextHoverEffect.module.css";

/**
 * TextHoverEffect — Texto gigante cuya iluminación se mueve.
 * - auto=true: se anima solo (path suave) sin pulsar nada.
 * - auto=false: sigue al cursor (comportamiento original).
 */
export default function TextHoverEffect({ text, className = "", auto = false }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const [cursor, setCursor] = useState({ x: -700, y: 120 });
  const rafRef = useRef(null);
  const startRef = useRef(null);

  // --- Modo automático ---
  const animate = useCallback((ts) => {
    if (!startRef.current) startRef.current = ts;
    const t = (ts - startRef.current) / 1000;

    const x = 500 + Math.sin(t * 0.45) * 350;
    const y = 120 + Math.sin(t * 0.35) * Math.cos(t * 0.2) * 70;

    setCursor({ x, y });
    rafRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    if (auto && !reduced) {
      rafRef.current = requestAnimationFrame(animate);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [auto, reduced, animate]);

  // --- Modo cursor ---
  const onMove = (e) => {
    if (auto || reduced) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 240;
    setCursor({ x, y });
  };

  const onLeave = () => {
    if (!auto && !reduced) setCursor({ x: -700, y: 120 });
  };

  return (
    <div className={styles.wrap}>
      <svg
        className={`${styles.text} ${className}`}
        viewBox="0 0 1000 240"
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={auto ? undefined : onMove}
        onMouseLeave={auto ? undefined : onLeave}
        role="img"
        aria-label={text}
      >
        <defs>
          <linearGradient id={`dim-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.30)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.10)" />
          </linearGradient>
          <linearGradient id={`bright-${id}`} x1="0" y1="0" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="50%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
          <radialGradient id={`spot-${id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="white" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <mask id={`mask-${id}`}>
            <rect width="1000" height="240" fill="black" />
            <g
              style={{
                transform: `translate(${cursor.x}px, ${cursor.y}px)`,
                transition: reduced || auto ? "none" : "transform 0.25s ease-out",
              }}
            >
              <circle r="180" fill={`url(#spot-${id})`} />
            </g>
          </mask>
        </defs>

        <text
          x="500"
          y="120"
          textAnchor="middle"
          dominantBaseline="central"
          textLength="750"
          lengthAdjust="spacingAndGlyphs"
          fill={`url(#dim-${id})`}
        >
          {text}
        </text>
        <text
          x="500"
          y="120"
          textAnchor="middle"
          dominantBaseline="central"
          textLength="750"
          lengthAdjust="spacingAndGlyphs"
          fill={`url(#bright-${id})`}
          mask={reduced ? undefined : `url(#mask-${id})`}
        >
          {text}
        </text>
      </svg>
    </div>
  );
}