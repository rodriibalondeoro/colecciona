"use client";

import { useEffect, useRef } from "react";
import { WORLD_COUNTRIES } from "@/data/world";
import styles from "./CountryGlobe.module.css";

/**
 * CountryGlobe — Globo terráqueo en Canvas 2D con las formas reales de los
 * países. Se arrastra para girar y se acerca con la rueda. El país
 * seleccionado se resalta en esmeralda cuando está de frente.
 */
export default function CountryGlobe({
  lat = 40.42,
  lon = -3.7,
  label = "España",
  code = "ES",
  size = 320,
  className = "",
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const W = size;
    const H = size;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(dpr, dpr);

    let R = W * 0.36;
    const cx = W / 2;
    const cy = H / 2;

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    // Rotación del usuario (arranca mostrando el país de frente)
    const userRY = { current: (lon * Math.PI) / 180 };
    const userRX = { current: clamp((-lat * Math.PI) / 180, -1.3, 1.3) };

    // Puntos de textura (distribución de Fibonacci)
    const N = 900;
    const PHI = Math.PI * (3 - Math.sqrt(5));
    const dots = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = PHI * i;
      dots.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
    }

    const toVec = (la, lo) => {
      const a = (la * Math.PI) / 180;
      const b = (lo * Math.PI) / 180;
      return [Math.cos(a) * Math.cos(b), Math.sin(a), Math.cos(a) * Math.sin(b)];
    };

    const rotate = (v, ry, rx) => {
      const cY = Math.cos(ry), sY = Math.sin(ry);
      const x1 = v[0] * cY - v[2] * sY;
      const z1 = v[0] * sY + v[2] * cY;
      const cX = Math.cos(rx), sX = Math.sin(rx);
      return [x1, v[1] * cX - z1 * sX, v[1] * sX + z1 * cX];
    };

    // ── Seleccionar la forma del país que contiene (lat,lon) ──
    const PIP = (rings) => {
      for (const ring of rings) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
            inside = !inside;
          }
        }
        if (inside) return true;
      }
      return false;
    };
    const selectedFeature = WORLD_COUNTRIES.findIndex((f) => f.c.some(PIP));

    const ringToPath = (ring, ry, rx) => {
      // Suther·Hodgman: clip contra z>=0 en 3D (no dibuja detrás del globo)
      const pts = [];
      for (const [lo, la] of ring) pts.push(rotate(toVec(la, lo), ry, rx));
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const cur = pts[i];
        const prev = pts[(i - 1 + pts.length) % pts.length];
        const cIn = cur[2] >= 0;
        const pIn = prev[2] >= 0;
        if (pIn !== cIn) {
          const t = prev[2] / (prev[2] - cur[2]);
          out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t, 0]);
        }
        if (cIn) out.push([cur[0], cur[1], cur[2]]);
      }
      if (out.length < 3) return null;
      const path = new Path2D();
      path.moveTo(cx + out[0][0] * R, cy - out[0][1] * R);
      for (let i = 1; i < out.length; i++) path.lineTo(cx + out[i][0] * R, cy - out[i][1] * R);
      path.closePath();
      return path;
    };

    let raf;
    let disposed = false;

    const renderer = (now) => {
      const ts = reduced ? 0 : now / 1000;
      const rotY = userRY.current + (reduced ? 0 : ts * 0.18);
      const rotX = userRX.current;

      ctx.clearRect(0, 0, W, H);

      // Wireframe de paralelos
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(99,102,241,0.08)";
      for (let la = -60; la <= 60; la += 30) {
        ctx.beginPath();
        let started = false;
        for (let lo = -180; lo <= 180; lo += 6) {
          const v = rotate(toVec(la, lo), rotY, rotX);
          if (v[2] <= 0.02) { started = false; continue; }
          const px = cx + v[0] * R, py = cy - v[1] * R;
          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      // Puntos de textura
      for (const d of dots) {
        const v = rotate(d, rotY, rotX);
        if (v[2] <= 0) continue;
        const pxa = cx + v[0] * R, pya = cy - v[1] * R;
        const shade = 0.08 + 0.28 * v[2];
        ctx.beginPath();
        ctx.arc(pxa, pya, 1, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(165,180,252,${shade.toFixed(3)})`;
        ctx.fill();
      }

      // ── Formas reales de los países ──
      for (let f = 0; f < WORLD_COUNTRIES.length; f++) {
        const feat = WORLD_COUNTRIES[f];
        const isSel = f === selectedFeature;
        for (const poly of feat.c) {
          const exterior = poly[0];
          const hasFront = exterior.some(([lo, la]) => rotate(toVec(la, lo), rotY, rotX)[2] > 0.02);
          if (!hasFront) continue;
          const paths = [];
          for (const ring of poly) {
            const p = ringToPath(ring, rotY, rotX);
            if (p) paths.push(p);
          }
          if (!paths.length) continue;
          const filled = new Path2D();
          for (const p of paths) filled.addPath(p);
          ctx.fillStyle = isSel ? "rgba(52,211,153,0.34)" : "rgba(129,140,248,0.15)";
          ctx.fill(filled, "evenodd");
          ctx.strokeStyle = isSel ? "#34d399" : "rgba(129,140,248,0.35)";
          ctx.lineWidth = isSel ? 1.7 : 0.8;
          for (const p of paths) ctx.stroke(p);
        }
      }

      // Marco del globo
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(99,102,241,0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Marcador del país seleccionado
      const mv = rotate(toVec(lat, lon), rotY, rotX);
      if (mv[2] > 0.05) {
        const mx = cx + mv[0] * R, my = cy - mv[1] * R;
        const pulse = 0.5 + 0.5 * Math.sin(ts * 2.6);
        ctx.beginPath();
        ctx.arc(mx, my, 3.5 + pulse, 0, Math.PI * 2);
        ctx.fillStyle = "#34d399";
        ctx.fill();
        drawLabel(mx, my);
      }

      if (!reduced) raf = requestAnimationFrame(renderer);
    };

    const drawLabel = (mx, my) => {
      ctx.font = "600 11px Inter, system-ui, sans-serif";
      const txt = label;
      const w = ctx.measureText(txt).width + 16;
      const bx = clamp(mx + 12, 4, W - w - 4);
      const by = clamp(my - 24, 4, H - 24);
      ctx.fillStyle = "rgba(8,10,20,0.85)";
      ctx.strokeStyle = "rgba(52,211,153,0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, w, 20, 9);
      else ctx.rect(bx, by, w, 20);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#34d399";
      ctx.textAlign = "center";
      ctx.fillText(txt, bx + w / 2, by + 14);
      ctx.textAlign = "start";
    };

    // ── Interacción: arrastrar y zoom ──
    let dragging = false, lx = 0, ly = 0;
    const onDown = (e) => { dragging = true; lx = e.clientX; ly = e.clientY; canvas.classList.add(styles.dragging); try { canvas.setPointerCapture(e.pointerId); } catch {} };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      userRY.current += dx * 0.006;
      userRX.current = clamp(userRX.current + dy * 0.006, -1.3, 1.3);
    };
    const onUp = () => { dragging = false; canvas.classList.remove(styles.dragging); };
    const onWheel = (e) => {
      e.preventDefault();
      R = clamp(R * (e.deltaY > 0 ? 0.9 : 1.1), W * 0.14, W * 0.5);
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    raf = requestAnimationFrame(renderer);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [lat, lon, label, code, size]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`${styles.canvas} ${className}`}
    />
  );
}