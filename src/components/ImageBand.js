"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import styles from "./ImageBand.module.css";

/**
 * ImageBand — Banda cinematográfica: cada imagen se "destapa" con un
 * clip-path al entrar en pantalla (con escalonado). Al pasar el ratón,
 * se colorea y escala la imagen.
 */
export default function ImageBand({ images = [], className = "" }) {
  const refs = useRef([]);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      refs.current.forEach((r) => r && r.classList.add(styles.visible));
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.visible);
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.3 }
    );
    refs.current.forEach((r) => r && obs.observe(r));
    return () => obs.disconnect();
  }, []);

  if (images.length === 0) return null;

  return (
    <div className={`${styles.band} ${className}`}>
      {images.map((img, i) => (
        <div
          key={i}
          ref={(el) => (refs.current[i] = el)}
          className={styles.frame}
          style={{ "--i": i }}
        >
          <Link href={img.href || "#"} className={styles.link} data-cursor>
            <Image
              src={img.src}
              alt={img.alt || ""}
              fill
              sizes="40vw"
              style={{ objectFit: "cover" }}
              draggable={false}
            />
            <span className={styles.shade} aria-hidden="true" />
            <span className={styles.caption}>
              <span className={styles.captionIndex}>{String(i + 1).padStart(2, "0")}</span>
              <span className={styles.captionText}>{img.caption}</span>
            </span>
          </Link>
        </div>
      ))}
    </div>
  );
}