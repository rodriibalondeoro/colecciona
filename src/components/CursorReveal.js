"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import SpinStamp from "./SpinStamp";
import styles from "./CursorReveal.module.css";

/**
 * CursorReveal — Efecto awwwards de "reveal": al pasar el ratón por cada
 * ítem de la lista, aparece una imagen en un recorte circular que sigue
 * al cursor. Cae a una lista simple en táctil.
 */
export default function CursorReveal({ items, eyebrow = "EXPLORA", title = "Pasa el ratón por la lista" }) {
  const boxRef = useRef(null);
  const imgRef = useRef(null);
  const [active, setActive] = useState(items[0] || null);

  const onMove = (e) => {
    const box = boxRef.current;
    const img = imgRef.current;
    if (!box || !img) return;
    const r = box.getBoundingClientRect();
    img.style.setProperty("--cx", `${e.clientX - r.left}px`);
    img.style.setProperty("--cy", `${e.clientY - r.top}px`);
  };

  const show = () => imgRef.current?.style.setProperty("--r", "150px");
  const hide = () => imgRef.current?.style.setProperty("--r", "0px");

  return (
    <section className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h2 className={styles.title}>{title}</h2>
        </div>
        <SpinStamp className={styles.stamp} />
      </div>

      <div
        ref={boxRef}
        className={styles.box}
        onMouseMove={onMove}
        onMouseLeave={hide}
      >
        <ul className={styles.list}>
          {items.map((item, i) => (
            <li key={item.id} className={styles.row}>
              <Link
                href={`/product/${item.id}`}
                className={styles.rowLink}
                onMouseEnter={() => {
                  setActive(item);
                  show();
                }}
                data-cursor
              >
                <span className={styles.rowIndex}>{String(i + 1).padStart(2, "0")}</span>
                <span className={styles.rowTitle}>{item.title}</span>
                <span className={styles.rowMeta}>
                  {item.set}
                  <span className={styles.rowPrice}>{Number(item.price).toFixed(2)} €</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className={styles.follow} ref={imgRef} aria-hidden="true">
          {active && (
            <Image
              src={active.image}
              alt=""
              fill
              sizes="300px"
              style={{ objectFit: "cover" }}
              draggable={false}
            />
          )}
        </div>
      </div>
    </section>
  );
}