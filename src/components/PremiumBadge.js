"use client";

import { usePremium } from "@/hooks/usePremium";

export default function PremiumBadge({ size = "sm", showText = true }) {
  const { isPremium } = usePremium();

  if (!isPremium) return null;

  const sizes = {
    xs: { fontSize: 9, padding: "1px 5px", gap: 3 },
    sm: { fontSize: 10, padding: "2px 7px", gap: 4 },
    md: { fontSize: 12, padding: "3px 10px", gap: 5 },
  };

  const s = sizes[size] || sizes.sm;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: s.gap,
        padding: s.padding,
        borderRadius: 4,
        background: "linear-gradient(135deg, #f59e0b, #d97706)",
        color: "#fff",
        fontWeight: 700,
        fontSize: s.fontSize,
        letterSpacing: "0.03em",
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <svg width={s.fontSize + 2} height={s.fontSize + 2} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
      {showText && "PREMIUM"}
    </span>
  );
}
