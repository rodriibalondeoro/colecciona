"use client";

import styles from "./SpinStamp.module.css";

const DEFAULT_TEXT = "COLECCIONA · COLECCIONA · COLECCIONA · ";

/**
 * SpinStamp — Sello circular de texto que rota continuamente con degradado de colorines.
 */
export default function SpinStamp({ text = DEFAULT_TEXT, className = "", colorines = true }) {
  return (
    <div className={`${styles.stamp} ${className}`} aria-hidden="true">
      <svg viewBox="0 0 200 200" className={styles.svg}>
        <defs>
          <path id="stampCircle" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0" />
          <linearGradient id="stampColorines" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="35%" stopColor="#34d399" />
            <stop offset="70%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
        <text className={`${styles.text} ${colorines ? styles.colorinesText : ""}`}>
          <textPath href="#stampCircle">{text}</textPath>
        </text>
      </svg>
      <span className={`${styles.core} ${colorines ? styles.colorinesCore : ""}`}>✦</span>
    </div>
  );
}