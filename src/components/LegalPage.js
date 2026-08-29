import Link from "next/link";
import styles from "./LegalPage.module.css";

export default function LegalPage({ title, updated, children }) {
  return (
    <div className={styles.page}>
      <Link href="/auth" className={styles.back}>
        ← Volver
      </Link>

      <div className={styles.header}>
        <Link href="/auth" className={styles.brand}>
          <div className={styles.brandBadge}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <span>COLECC<span>IONA</span></span>
        </Link>
        <h1>{title}</h1>
        <p className={styles.updated}>Última actualización: {updated}</p>
      </div>

      <div className={styles.body}>{children}</div>
    </div>
  );
}