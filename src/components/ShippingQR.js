'use client';

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

export default function ShippingQR({ value, size = 160, label }) {
  const canvasRef = useRef(null);
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (!value) return;
    let active = true;
    QRCode.toDataURL(value, { width: size * 2, margin: 1, color: { dark: "#0f1115", light: "#ffffff" } })
      .then((url) => { if (active) setSrc(url); })
      .catch(() => {});
    return () => { active = false; };
  }, [value, size]);

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
      {/* canvas oculto para acceso programático */}
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {src ? (
        <img
          src={src}
          alt={label || "Código QR de envío"}
          width={size}
          height={size}
          style={{ borderRadius: "10px", border: "1px solid var(--border, #2a2a3e)", background: "#fff", padding: "6px" }}
        />
      ) : (
        <div style={{ width: size, height: size, borderRadius: 10, background: "var(--bg-elevated, #1a1a2e)", display: "grid", placeItems: "center", color: "var(--text-muted, #94a3b8)", fontSize: 12, border: "1px dashed var(--border, #2a2a3e)" }}>
          Generando QR…
        </div>
      )}
      {label && <span style={{ fontSize: "0.75rem", color: "var(--text-muted, #94a3b8)" }}>{label}</span>}
    </div>
  );
}