"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import styles from "./ImageCropper.module.css";

/**
 * ImageCropper — Recorte visual con paneo y zoom para centrar la carta en 3:4.
 * Al pulsar "Aplicar recorte" devuelve un dataURL ya recortado (canvas) al ratio
 * deseado, listo para publicar.
 */
export default function ImageCropper({ src, onApply, onCancel }) {
  const frameRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [applying, setApplying] = useState(false);

  const base = ready
    ? Math.max(frame.w / natural.w, frame.h / natural.h)
    : 1;

  useEffect(() => {
    const el = frameRef.current;
    if (el) setFrame({ w: el.clientWidth, h: el.clientHeight });
  }, [ready]);

  const handleLoad = () => {
    const img = imgRef.current;
    if (!img || !frameRef.current) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const f = { w: frameRef.current.clientWidth, h: frameRef.current.clientHeight };
    setFrame(f);
    setNatural({ w: nw, h: nh });
    const b = Math.max(f.w / nw, f.h / nh);
    const displayW = nw * b;
    const displayH = nh * b;
    setOffset({ x: (f.w - displayW) / 2, y: (f.h - displayH) / 2 });
    setZoom(1);
    setLoaded(true);
    setReady(true);
  };

  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

  const clampOffset = (o, z) => {
    if (!natural.w || !natural.h) return o;
    const b = Math.max(frame.w / natural.w, frame.h / natural.h);
    const displayW = natural.w * b * z;
    const displayH = natural.h * b * z;
    return {
      x: clamp(o.x, frame.w - displayW, 0),
      y: clamp(o.y, frame.h - displayH, 0),
    };
  };

  const changeZoom = (next, anchor) => {
    const target = clamp(next, 0.5, 6);
    let off = { ...offset };
    if (anchor && frame.w) {
      const b = Math.max(frame.w / natural.w, frame.h / natural.h);
      const ratio = target / (zoom || 1);
      off = {
        x: anchor.x - (anchor.x - off.x) * ratio,
        y: anchor.y - (anchor.y - off.y) * ratio,
      };
    }
    setOffset(clampOffset(off, target));
    setZoom(target);
  };

  // ── Pointer: panning ──
  const onPointerDown = (e) => {
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;
    setOffset(clampOffset({ x: dragRef.current.ox + dx, y: dragRef.current.oy + dy }, zoom));
  };
  const onPointerUp = () => (dragRef.current = null);

  const onWheel = (e) => {
    e.preventDefault();
    const rect = frameRef.current.getBoundingClientRect();
    const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    changeZoom(zoom + delta, anchor);
  };

  // ── Exportar recorte ──
  const apply = () => {
    const img = imgRef.current;
    if (!img) return;
    const f = frameRef.current.getBoundingClientRect();
    const b = Math.max(f.width / natural.w, f.height / natural.h);
    const displayW = natural.w * b * zoom;
    const displayH = natural.h * b * zoom;
    const kx = natural.w / displayW;
    const ky = natural.h / displayH;
    // Área visible actual → coords de la imagen original.
    let sx = (-offset.x) * kx;
    let sy = (-offset.y) * ky;
    let sw = f.width * kx;
    let sh = f.height * ky;
    sx = clamp(sx, 0, natural.w - sw);
    sy = clamp(sy, 0, natural.h - sh);
    sw = clamp(sw, 1, natural.w - sx);
    sh = clamp(sh, 1, natural.h - sy);

    // Mismo ratio 3:4 que muestra el marco.
    const cx = (f.width * kx - sw) / 2;
    const cy = (f.height * ky - sh) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 1600;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, sx + cx, sy + cy, sw, sh, 0, 0, 1200, 1600);

    setApplying(true);
    const finish = (blob) => {
      const url = URL.createObjectURL(blob);
      setApplying(false);
      onApply && onApply(url, blob, cx && cy ? { sx, sy, sw, sh } : null);
    };
    // toBlob puede devolver null en algunos navegadores/iOS con canvas grandes.
    canvas.toBlob(
      (blob) => {
        if (blob) {
          finish(blob);
          return;
        }
        try {
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          const base64 = dataUrl.split(",")[1];
          const byteChars = atob(base64);
          const buf = new Uint8Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) buf[i] = byteChars.charCodeAt(i);
          finish(new Blob([buf], { type: "image/jpeg" }));
        } catch {
          setApplying(false);
          onApply && onApply(canvas.toDataURL("image/jpeg", 0.85), null, null);
        }
      },
      "image/jpeg",
      0.92
    );
  };

  const displayW = ready ? natural.w * base * zoom : 0;
  const displayH = ready ? natural.h * base * zoom : 0;

  return (
    <div className={styles.container}>
      <div
        ref={frameRef}
        className={styles.frame}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        style={{ touchAction: "none" }}
      >
        <img
          ref={imgRef}
          src={src}
          alt="Crop"
          draggable={false}
          onLoad={handleLoad}
          className={styles.image}
          style={{
            width: displayW,
            height: displayH,
            transform: `translate(${offset.x}px, ${offset.y}px)`,
            opacity: loaded ? 1 : 0,
          }}
        />
        {!loaded && <div className={styles.spinner} />}
        <div className={styles.rules}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={styles[`rule${i}`]} />
          ))}
        </div>
        <div className={styles.cornerLbl}>3 : 4</div>
      </div>

      <div className={styles.controls}>
        <button type="button" className={styles.zoomBtn} onClick={() => changeZoom(zoom - 0.25)}>
          −
        </button>
        <input
          type="range"
          min="0.5"
          max="6"
          step="0.05"
          value={zoom}
          onChange={(e) => changeZoom(parseFloat(e.target.value))}
          className={styles.slider}
        />
        <button type="button" className={styles.zoomBtn} onClick={() => changeZoom(zoom + 0.25)}>
          +
        </button>
      </div>

      <div className={styles.actions}>
        {onCancel && (
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>
            Descartar
          </button>
        )}
        <button type="button" className={styles.applyBtn} onClick={apply} disabled={applying || !ready}>
          {applying ? "Recortando..." : "Aplicar recorte 3:4"}
        </button>
      </div>
    </div>
  );
}