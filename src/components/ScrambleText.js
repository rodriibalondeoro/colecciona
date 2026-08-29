"use client";

import { useEffect, useRef } from "react";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZÑ#$%&@0123456789";

/**
 * ScrambleText — Efecto awwwards: las letras se "revuelven" aleatoriamente
 * hasta fijarse. Se dispara al entrar en pantalla (`scroll`), al pasar el
 * ratón (`hover`) o ambos (`both`).
 */
export default function ScrambleText({
  text,
  as: Tag = "span",
  className = "",
  delay = 0,
  speed = 26,
  trigger = "both",
}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf;
    let started = false;

    const run = () => {
      const chars = [...text];
      const revealOrder = chars.map(() => Math.random());
      const duration = text.length * speed + 240;
      const start = performance.now();
      cancelAnimationFrame(raf);

      const step = (now) => {
        const p = Math.min(1, (now - start) / duration);
        let out = "";
        for (let i = 0; i < chars.length; i++) {
          const c = chars[i];
          if (c === " ") {
            out += " ";
            continue;
          }
          if (p >= revealOrder[i]) out += c;
          else out += CHARS[Math.floor(Math.random() * CHARS.length)];
        }
        el.textContent = out;
        if (p < 1) raf = requestAnimationFrame(step);
        else el.textContent = text;
      };
      raf = requestAnimationFrame(step);
    };

    let observer;
    if (trigger === "scroll" || trigger === "both") {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && !started) {
            started = true;
            setTimeout(run, delay);
            observer.disconnect();
          }
        },
        { threshold: 0.4 }
      );
      observer.observe(el);
    }

    if (trigger === "hover" || trigger === "both") {
      el.addEventListener("pointerenter", run);
    }

    return () => {
      if (observer) observer.disconnect();
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerenter", run);
    };
  }, [text, delay, speed, trigger]);

  return (
    <Tag ref={ref} className={className}>
      {text}
    </Tag>
  );
}