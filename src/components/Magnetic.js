"use client";

import { useRef } from "react";
import styles from "./Magnetic.module.css";

export default function Magnetic({ children, strength = 0.3, className = "", ...props }) {
  const ref = useRef(null);

  const onMouseMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const relX = e.clientX - rect.left - rect.width / 2;
    const relY = e.clientY - rect.top - rect.height / 2;
    el.style.transform = `translate(${relX * strength}px, ${relY * strength}px)`;
  };

  const onMouseLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "translate(0px, 0px)";
  };

  return (
    <div ref={ref} className={`${styles.magnetic} ${className}`} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} {...props}>
      {children}
    </div>
  );
}