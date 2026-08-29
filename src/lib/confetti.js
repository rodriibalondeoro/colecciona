let activeCanvas = null;

const PALETTE = [
  "#34d399",
  "#818cf8",
  "#a78bfa",
  "#fbbf24",
  "#f472b6",
  "#22d3ee",
  "#ffffff",
];

/**
 * Confetti burst de Canvas 2D, sin dependencias.
 * Lanza una ráfaga de partículas desde un origen (o centro de la pantalla)
 * y se autodestruye al terminar. Respeta prefers-reduced-motion.
 */
export function fireConfetti(originX, originY, amount = 120) {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  // Evita colapsos si se dispara varias veces seguidas
  if (activeCanvas) {
    const prev = activeCanvas;
    activeCanvas = null;
    prev.remove();
  }

  const canvas = document.createElement("canvas");
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "9999";
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  document.body.appendChild(canvas);
  activeCanvas = canvas;

  const originXf = originX ?? W / 2;
  const originYf = originY ?? H * 0.4;

  const particles = Array.from({ length: amount }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 5 + Math.random() * 9;
    return {
      x: originXf,
      y: originYf,
      vx: Math.cos(angle) * speed * (0.5 + Math.random() * 0.7),
      vy: Math.sin(angle) * speed * (0.5 + Math.random() * 0.7) - 6,
      size: 4 + Math.random() * 6,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      rot: Math.random() * Math.PI,
      rotSpeed: (Math.random() - 0.5) * 0.3,
      shape: Math.random() > 0.5 ? "rect" : "circle",
      ttl: 90 + Math.random() * 60,
    };
  });

  let frame = 0;
  let raf;

  const step = () => {
    frame++;
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of particles) {
      if (frame > p.ttl) continue;
      alive = true;
      p.vy += 0.22; // gravedad
      p.vx *= 0.985; // fricción
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.rotSpeed;

      const life = 1 - frame / p.ttl;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = life > 0.5 ? 1 : life * 2;
      ctx.fillStyle = p.color;
      if (p.shape === "rect") {
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (alive) {
      raf = requestAnimationFrame(step);
    } else {
      canvas.remove();
      if (activeCanvas === canvas) activeCanvas = null;
    }
  };

  raf = requestAnimationFrame(step);
}
