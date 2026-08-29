"use client";

import styles from "./Skeleton.module.css";

/**
 * Skeleton — Loading skeletons with shimmer animation.
 * Types: "card" | "profile" | "message" | "detail" | "text" | "line" (default)
 */
export default function Skeleton({ type = "line", count = 1 }) {
  if (type === "card") {
    return (
      <div className={styles.grid}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={styles.card}>
            <div className={`${styles.block} ${styles.img}`} />
            <div className={styles.cardBody}>
              <div className={styles.codeRow}>
                <div className={`${styles.line} ${styles.w20}`} />
                <div className={`${styles.line} ${styles.w40}`} />
              </div>
              <div className={`${styles.line} ${styles.w80}`} />
              <div className={styles.priceRow}>
                <div className={`${styles.line} ${styles.w30}`} />
                <div className={`${styles.line} ${styles.w15}`} />
              </div>
              <div className={styles.sellerRow}>
                <div className={`${styles.circle} ${styles.xs}`} />
                <div className={`${styles.line} ${styles.w25}`} />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (type === "profile") {
    return (
      <div className={styles.profileCard}>
        <div className={styles.profileTop}>
          <div className={`${styles.circle} ${styles.avatar}`} />
          <div className={styles.profileLines}>
            <div className={`${styles.line} ${styles.w60}`} />
            <div className={`${styles.line} ${styles.w40}`} />
          </div>
        </div>
        <div className={styles.statsRow}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={styles.statBox}>
              <div className={`${styles.line} ${styles.w50}`} />
              <div className={`${styles.line} ${styles.w70}`} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === "message") {
    return (
      <div className={styles.col}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={styles.msgRow}>
            <div className={`${styles.circle} ${styles.sm}`} />
            <div className={styles.msgLines}>
              <div className={`${styles.line} ${styles.w70}`} />
              <div className={`${styles.line} ${styles.w50}`} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (type === "detail") {
    return (
      <div className={styles.detailCard}>
        <div className={`${styles.block} ${styles.detailImg}`} />
        <div className={styles.detailBody}>
          <div className={styles.codeRow}>
            <div className={`${styles.line} ${styles.w20}`} />
            <div className={`${styles.line} ${styles.w30}`} />
          </div>
          <div className={`${styles.line} ${styles.w90}`} />
          <div className={`${styles.line} ${styles.w60}`} />
          <div className={`${styles.line} ${styles.w40}`} />
          <div className={styles.detailPrice}>
            <div className={`${styles.line} ${styles.w25}`} />
          </div>
          <div className={styles.sellerRow}>
            <div className={`${styles.circle} ${styles.sm}`} />
            <div className={styles.msgLines}>
              <div className={`${styles.line} ${styles.w40}`} />
              <div className={`${styles.line} ${styles.w25}`} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (type === "text") {
    return (
      <div className={styles.col}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={`${styles.line} ${styles.full}`} />
        ))}
      </div>
    );
  }

  // Default: "line" type (single row with avatar + text)
  return (
    <div className={styles.col}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.row}>
          <div className={`${styles.circle} ${styles.sm}`} />
          <div className={`${styles.line} ${styles.w80}`} />
          <div className={`${styles.line} ${styles.w30}`} />
        </div>
      ))}
    </div>
  );
}
