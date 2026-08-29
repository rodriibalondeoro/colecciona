"use client";

import { usePathname } from "next/navigation";
import styles from "./HoverFooter.module.css";

/**
 * HoverFooter — Pie de página con el nombre de la marca en grande.
 * Se oculta en /messages (chat fullscreen).
 */
export default function HoverFooter() {
  const pathname = usePathname();
  if (pathname === "/messages" || pathname === "/sell" || pathname === "/orders") return null;

  return (
    <footer className={styles.footer}>
      <span className={styles.bigText}>colecciona</span>
      <p className={styles.copyright}>
        © {new Date().getFullYear()} Colecciona · Hecho para coleccionistas
      </p>
    </footer>
  );
}