import styles from "./Badge.module.css";
import { cardConditions } from "@/data/mockData";

export function ConditionBadge({ condition, size = "md" }) {
  const config = cardConditions[condition] || cardConditions.NM;
  return (
    <span
      className={`${styles.conditionBadge} ${styles[size]}`}
      style={{
        color: config.color,
        backgroundColor: config.bg,
        borderColor: `${config.color}35`,
      }}
    >
      <span
        className={styles.dot}
        style={{ backgroundColor: config.color }}
      />
      {config.short || condition}
    </span>
  );
}

export function VerifiedBadge() {
  return (
    <span className={styles.verifiedBadge} title="Vendedor Verificado por Colecciona">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L15.09 4.26L18.84 4.54L19.94 8.16L23 10.5L21.75 14.07L22.85 17.69L19.26 18.96L17.01 22L13.44 20.75L9.87 22L7.62 18.96L4.03 17.69L5.13 14.07L3.88 10.5L6.94 8.16L8.04 4.54L11.79 4.26L12 2Z" fill="#6366f1"/>
        <path d="M9 12L11 14L15 10" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <span>Verificado</span>
    </span>
  );
}

export function LevelBadge({ level }) {
  const levelLabels = {
    1: "Nuevo",
    2: "Activo",
    3: "Pro",
    4: "Élite",
  };
  return (
    <span className={`${styles.levelChip} ${styles[`level${level}`]}`}>
      {levelLabels[level] || "Usuario"}
    </span>
  );
}

export function StatusBadge({ status }) {
  const configMap = {
    completed: { label: "Completado", class: styles.statusCompleted },
    shipped: { label: "En Tránsito", class: styles.statusShipped },
    pending: { label: "En Custodia Escrow", class: styles.statusPending },
    cancelled: { label: "Cancelado", class: styles.statusCancelled },
  };
  const config = configMap[status] || configMap.pending;
  return (
    <span className={`${styles.statusChip} ${config.class}`}>
      {config.label}
    </span>
  );
}
