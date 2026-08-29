"use client";

import { useRef } from "react";
import styles from "./SpotlightBorder.module.css";

/**
 * SpotlightBorder — Borde luminoso y resplandor radial que siguen al cursor
 * (efecto 21st.dev). Envuelve cualquier elemento; al pasar el ratón se
 * ilumina desde la posición del cursor.
 */
export default function SpotlightBorder({
  children,
  strength = 0.18,
  className = "",
  ...props
}) {
  const ref = useRef(null);

  const onMouseMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
    el.style.setProperty("--mstrength", String(strength));
  };

  const onMouseEnter = () => {
    const el = ref.current;
    if (el) el.classList.add(styles.on);
  };

  const onMouseLeave = () => {
    const el = ref.current;
    if (el) el.classList.remove(styles.on);
  };

  return (
    <div
      ref={ref}
      className={`${styles.spotlight} ${className}`}
      onMouseMove={onMouseMove}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      {...props}
    >
      {children}
    </div>
  );
}