"use client";

import { useState, useEffect } from "react";
import { usePremium } from "@/hooks/usePremium";

export default function PriceAlertButton({ productId, currentPrice }) {
  const { isPremium } = usePremium();
  const [hasAlert, setHasAlert] = useState(false);
  const [alertPrice, setAlertPrice] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isPremium) return;
    checkExistingAlert();
  }, [productId, isPremium]);

  const checkExistingAlert = async () => {
    try {
      const session = JSON.parse(localStorage.getItem("colecciona_session") || "null");
      const token = session?.access_token || session?.accessToken;
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch("/api/alerts/price", { headers });
      const data = await res.json();
      const existing = data.alerts?.find(
        (a) => a.product?.id === productId && a.active
      );
      if (existing) {
        setHasAlert(true);
        setAlertPrice(existing.target_price);
      }
    } catch {}
  };

  const handleCreate = async () => {
    const price = parseFloat(alertPrice);
    if (!price || price <= 0 || price >= currentPrice) return;

    setLoading(true);
    try {
      const session = JSON.parse(localStorage.getItem("colecciona_session") || "null");
      const token = session?.access_token || session?.accessToken;
      if (!token) return;
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      await fetch("/api/alerts/price", {
        method: "POST",
        headers,
        body: JSON.stringify({ productId, targetPrice: price }),
      });
      setHasAlert(true);
      setShowInput(false);
    } catch {}
    setLoading(false);
  };

  const handleDelete = async () => {
    try {
      const session = JSON.parse(localStorage.getItem("colecciona_session") || "null");
      const token = session?.access_token || session?.accessToken;
      if (!token) return;
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      await fetch("/api/alerts/price", {
        method: "DELETE",
        headers,
      });
      setHasAlert(false);
      setAlertPrice("");
    } catch {}
  };

  if (!isPremium) return null;

  if (hasAlert && !showInput) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 8,
        background: "rgba(16, 185, 129, 0.1)",
        border: "1px solid rgba(16, 185, 129, 0.3)",
        fontSize: 11,
        color: "#10b981",
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        Alerta activa: ≤ {alertPrice}€
        <button
          onClick={handleDelete}
          style={{
            background: "none",
            border: "none",
            color: "#10b981",
            cursor: "pointer",
            fontSize: 14,
            padding: 0,
            marginLeft: 4,
          }}
        >
          ×
        </button>
      </div>
    );
  }

  if (showInput) {
    return (
      <div style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
      }}>
        <input
          type="number"
          step="0.50"
          placeholder={`Máx. ${currentPrice}€`}
          value={alertPrice}
          onChange={(e) => setAlertPrice(e.target.value)}
          style={{
            width: 90,
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid var(--border-medium)",
            background: "var(--bg-dark)",
            color: "var(--text-primary)",
            fontSize: 12,
            outline: "none",
          }}
        />
        <button
          onClick={handleCreate}
          disabled={loading || !alertPrice}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "none",
            background: "#10b981",
            color: "#fff",
            fontWeight: 600,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          {loading ? "..." : "OK"}
        </button>
        <button
          onClick={() => setShowInput(false)}
          style={{
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid var(--border-medium)",
            background: "transparent",
            color: "var(--text-muted)",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowInput(true)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "6px 10px",
        borderRadius: 8,
        border: "1px solid var(--border-medium)",
        background: "transparent",
        color: "var(--text-muted)",
        fontSize: 11,
        fontWeight: 500,
        cursor: "pointer",
        transition: "all 0.2s",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      Alertarme si baja
    </button>
  );
}
