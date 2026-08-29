"use client";

import { useEffect, useRef } from "react";
import styles from "./TextReveal.module.css";

export default function TextReveal({ text, as: Tag = "span", className = "", delay = 0, accentWords = [] }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add(styles.visible);
          observer.unobserve(el);
        }
      },
      { threshold: 0.2 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const words = text.split(" ");

  return (
    <Tag
      ref={ref}
      className={`${styles.reveal} ${className}`}
      style={{ "--reveal-delay": `${delay}ms` }}
    >
      <span className={styles.mask}>
        {words.map((word, i) => (
          <span
            className={`${styles.word} ${
              accentWords.some((a) => a.toLowerCase() === word.toLowerCase()) ? styles.accent : ""
            }`}
            key={i}
          >
            {word}
            {i < words.length - 1 ? "\u00A0" : ""}
          </span>
        ))}
      </span>
    </Tag>
  );
}