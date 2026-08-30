"use client";

import { useState, useEffect } from "react";
import { usePremium } from "@/hooks/usePremium";

export default function PriceSuggest({ category, condition, title, onSuggest }) {
  const { isPremium } = usePremium();
  const [suggestion, setSuggestion] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!category) return;
    const timer = setTimeout(() => fetchSuggestion(), 1000);
    return () => clearTimeout(timer);
  }, [category, condition]);

  const fetchSuggestion = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pricing/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, condition, title }),
      });
      const data = await res.json();
      setSuggestion(data);
    } catch {
      setSuggestion(null);
    }
    setLoading(false);
  };

  if (!suggestion || suggestion.confidence === 0) return null;

  return (
    <div style={{
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-md)",
      background: "var(--bg-surface)",
      padding: 14,
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "#10b981",
            background: "rgba(16, 185, 129, 0.1)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            padding: "2px 8px",
            borderRadius: 4,
          }}>
            PRECIO INTELIGENTE
          </span>
          {!isPremium && (
            <span style={{
              fontSize: 9,
              color: "var(--text-dim)",
              background: "var(--accent-muted)",
              padding: "1px 5px",
              borderRadius: 3,
            }}>
              ⭐ PREMIUM
            </span>
          )}
        </div>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-muted)",
        }}>
          {suggestion.confidence}% confianza
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: "#10b981" }}>
          {suggestion.suggestedPrice?.toFixed(2)}€
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          precio sugerido
        </span>
      </div>

      {isPremium && suggestion.stats && (
        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-muted)" }}>
          <span>Min: {suggestion.stats.min}€</span>
          <span>Mediana: {suggestion.stats.median}€</span>
          <span>Max: {suggestion.stats.max}€</span>
          <span>({suggestion.stats.sampleSize} ventas)</span>
        </div>
      )}

      {!isPremium && (
        <p style={{ fontSize: 11, color: "var(--text-dim)", margin: 0 }}>
          Suscríbete a Premium para ver estadísticas detalladas del mercado
        </p>
      )}

      {onSuggest && suggestion.suggestedPrice && (
        <button
          onClick={() => onSuggest(suggestion.suggestedPrice)}
          style={{
            padding: "7px 12px",
            borderRadius: 6,
            border: "1px solid #10b981",
            background: "transparent",
            color: "#10b981",
            fontWeight: 600,
            fontSize: 11,
            cursor: "pointer",
            alignSelf: "flex-start",
          }}
        >
          Usar este precio
        </button>
      )}
    </div>
  );
}
