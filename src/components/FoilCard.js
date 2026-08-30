"use client";

/**
 * FoilCard — Contenedor estático para cartas.
 * Sin efectos de movimiento, tilt ni brillo.
 */
export default function FoilCard({ children, className = "", intensity = 14 }) {
  return (
    <div className={className} style={{ width: "100%", height: "100%", position: "relative" }}>
      {children}
    </div>
  );
}
