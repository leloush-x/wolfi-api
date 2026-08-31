import { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  trail: { x: number; y: number; alpha: number }[];
}

export default function StarCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);

    const onResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', onResize);

    const stars: Star[] = [];
    const MAX_TRAIL = 20;
    const SPAWN_INTERVAL = 2500;
    let lastSpawn = 0;

    function spawn() {
      const side = Math.random();
      let x: number, y: number, vx: number, vy: number;

      if (side < 0.5) {
        // from top
        x = Math.random() * w;
        y = -10;
        vx = (Math.random() - 0.5) * 0.4;
        vy = 0.15 + Math.random() * 0.35;
      } else {
        // from left
        x = -10;
        y = Math.random() * h * 0.6;
        vx = 0.15 + Math.random() * 0.35;
        vy = (Math.random() - 0.5) * 0.4;
      }

      stars.push({
        x, y, vx, vy,
        size: 1 + Math.random() * 1.5,
        alpha: 0.4 + Math.random() * 0.5,
        trail: [],
      });
    }

    let raf: number;
    let last = performance.now();

    function frame(now: number) {
      const dt = Math.min((now - last) / 16, 3);
      last = now;

      ctx.clearRect(0, 0, w, h);

      // Spawn
      if (now - lastSpawn > SPAWN_INTERVAL) {
        spawn();
        lastSpawn = now;
      }

      // Update + draw
      for (let i = stars.length - 1; i >= 0; i--) {
        const s = stars[i];

        // Store trail
        s.trail.push({ x: s.x, y: s.y, alpha: s.alpha });
        if (s.trail.length > MAX_TRAIL) s.trail.shift();

        // Move
        s.x += s.vx * dt;
        s.y += s.vy * dt;

        // Fade
        s.alpha -= 0.0008 * dt;

        // Remove dead
        if (s.alpha <= 0 || s.x > w + 20 || s.y > h + 20) {
          stars.splice(i, 1);
          continue;
        }

        // Draw trail
        for (let t = 0; t < s.trail.length; t++) {
          const tr = s.trail[t];
          const pct = t / s.trail.length;
          const a = pct * s.alpha * 0.4;
          const sz = s.size * pct * 0.6;

          ctx.beginPath();
          ctx.arc(tr.x, tr.y, sz, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(251, 146, 60, ${a})`;
          ctx.fill();
        }

        // Draw head
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha})`;
        ctx.fill();

        // Glow
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(251, 146, 60, ${s.alpha * 0.12})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
