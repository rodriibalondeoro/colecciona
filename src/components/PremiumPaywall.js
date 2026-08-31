"use client";

import { useState } from "react";
import { usePremium } from "@/hooks/usePremium";

export default function PremiumPaywall({ feature, onClose }) {
  const { isPremium } = usePremium();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (isPremium) return null;

  const features = [
    { icon: "🎯", text: "Precio inteligente — Sugerencia automática de precio justo" },
    { icon: "📉", text: "Alertas de precio — Notificación cuando baja una carta" },
    { icon: "📊", text: "Historial de precios — Gráficas con datos reales" },
    { icon: "💰", text: "Comisión reducida — Solo 5% en vez de 8%" },
    { icon: "⭐", text: "Badge Premium — Visible en tu perfil y anuncios" },
  ];

  const handleSubscribe = async () => {
    setLoading(true);
    setError(null);
    try {
      const session = JSON.parse(localStorage.getItem("colecciona_session") || "null");
      const token = session?.access_token || session?.accessToken;
      if (!token) {
        setError("Inicia sesion para activar Premium");
        setLoading(false);
        return;
      }
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch("/api/stripe/subscribe", {
        method: "POST",
        headers,
      });
      const data = await res.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Error al crear suscripción");
        setLoading(false);
      }
    } catch (err) {
      setError("Error de conexión");
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 9999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.7)",
      backdropFilter: "blur(8px)",
      padding: 16,
    }}>
      <div style={{
        background: "var(--bg-surface, #1a1a2e)",
        border: "1px solid var(--border-subtle, #2a2a3e)",
        borderRadius: 16,
        padding: "32px 28px",
        maxWidth: 420,
        width: "100%",
        position: "relative",
      }}>
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            background: "none",
            border: "none",
            color: "var(--text-muted, #9aa0b4)",
            fontSize: 20,
            cursor: "pointer",
            padding: 4,
          }}
        >
          ×
        </button>

        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 12px",
            borderRadius: 20,
            background: "linear-gradient(135deg, #f59e0b, #d97706)",
            color: "#fff",
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: "0.05em",
            marginBottom: 12,
          }}>
            ⭐ COLECCIONA PREMIUM
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: "8px 0 4px" }}>
            Desbloquea todo el potencial
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-muted, #9aa0b4)" }}>
            4.99€/mes — Cancela cuando quieras
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {features.map((f, i) => (
            <div key={i} style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 13,
              color: "var(--text-primary, #e4e6f0)",
            }}>
              <span style={{ fontSize: 16 }}>{f.icon}</span>
              {f.text}
            </div>
          ))}
        </div>

        {error && (
          <div style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#ef4444",
            fontSize: 12,
            marginBottom: 12,
          }}>
            {error}
          </div>
        )}

        <button
          onClick={handleSubscribe}
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px 0",
            border: "none",
            borderRadius: 10,
            background: "linear-gradient(135deg, #f59e0b, #d97706)",
            color: "#fff",
            fontWeight: 700,
            fontSize: 15,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
            transition: "all 0.2s",
          }}
        >
          {loading ? "Redirigiendo a Stripe..." : "Activar Premium — 4.99€/mes"}
        </button>

        <p style={{
          textAlign: "center",
          fontSize: 11,
          color: "var(--text-dim, #6b7280)",
          marginTop: 12,
        }}>
          Pago seguro con Stripe · Cancela cuando quieras
        </p>
      </div>
    </div>
  );
}
