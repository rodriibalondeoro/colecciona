"use client";

import { useEffect, useRef } from "react";
import styles from "./Cursor.module.css";

export default function Cursor() {
  const ringRef = useRef(null);
  const dotRef = useRef(null);

  useEffect(() => {
    const fine = window.matchMedia?.("(pointer: fine)").matches;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!fine || coarse || reduced) return;

    document.documentElement.classList.add("has-cursor");

    const ring = ringRef.current;
    const dot = dotRef.current;
    if (!ring || !dot) return;

    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let rx = mx;
    let ry = my;
    let dx = mx;
    let dy = my;
    let raf;

    const onMove = (e) => {
      mx = e.clientX;
      my = e.clientY;
    };

    const loop = () => {
      rx += (mx - rx) * 0.14;
      ry += (my - ry) * 0.14;
      dx += (mx - dx) * 0.42;
      dy += (my - dy) * 0.42;
      ring.style.transform = `translate3d(${rx - ring.offsetWidth / 2}px, ${ry - ring.offsetHeight / 2}px, 0)`;
      dot.style.transform = `translate3d(${dx - 2}px, ${dy - 2}px, 0)`;
      raf = requestAnimationFrame(loop);
    };

    const interactiveSel = "a, button, [data-cursor]";
    const onOver = (e) => {
      if (e.target.closest(interactiveSel)) {
        document.documentElement.classList.add("cursor-hover");
      } else {
        document.documentElement.classList.remove("cursor-hover");
      }
    };

    const onDown = () => document.documentElement.classList.add("cursor-down");
    const onUp = () => document.documentElement.classList.remove("cursor-down");

    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseover", onOver);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);

    rx = mx; ry = my; dx = mx; dy = my;
    raf = requestAnimationFrame(loop);

    // ── Efecto magnético ──
    const magnetics = document.querySelectorAll("[data-magnetic]");
    const magMove = (e) => {
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const relX = e.clientX - rect.left - rect.width / 2;
      const relY = e.clientY - rect.top - rect.height / 2;
      const strength = parseFloat(el.dataset.magneticStrength || 0.3);
      el.style.transform = `translate(${relX * strength}px, ${relY * strength}px)`;
    };
    const magLeave = (e) => {
      const el = e.currentTarget;
      el.style.transform = "";
    };
    magnetics.forEach((el) => {
      el.addEventListener("mousemove", magMove);
      el.addEventListener("mouseleave", magLeave);
    });

    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseover", onOver);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      cancelAnimationFrame(raf);
      magnetics.forEach((el) => {
        el.removeEventListener("mousemove", magMove);
        el.removeEventListener("mouseleave", magLeave);
      });
      document.documentElement.classList.remove("has-cursor", "cursor-hover", "cursor-down");
    };
  }, []);

  return (
    <>
      <div ref={ringRef} className={styles.ring} aria-hidden="true" />
      <div ref={dotRef} className={styles.dot} aria-hidden="true" />
    </>
  );
}