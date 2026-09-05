import { useEffect, useRef } from 'react';

/**
 * Realistic night-sky canvas:
 *  - Layer 1: static stars that gently twinkle (varied size / tint / phase).
 *  - Layer 2: occasional shooting stars with a fading gradient tail.
 *
 * Idle-light: DPR-capped, pauses when the tab is hidden, renders a single
 * static frame when the user prefers reduced motion. All listeners/frames
 * are cleaned up on unmount (no leaks).
 */

interface Star {
  x: number;
  y: number;
  r: number;
  baseAlpha: number;
  speed: number;
  phase: number;
  color: string;
  bright: boolean;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  width: number;
}

const STAR_TINTS = ['255,255,255', '255,255,255', '255,255,255', '207,224,255', '255,233,208'];

function makeStars(w: number, h: number): Star[] {
  const count = Math.min(220, Math.floor((w * h) / 9000));
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const bright = Math.random() < 0.06;
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: bright ? 1.2 + Math.random() * 0.8 : 0.3 + Math.random() * 1.1,
      baseAlpha: 0.25 + Math.random() * 0.65,
      speed: 0.4 + Math.random() * 2.2,
      phase: Math.random() * Math.PI * 2,
      color: STAR_TINTS[(Math.random() * STAR_TINTS.length) | 0],
      bright,
    });
  }
  return stars;
}

function makeMeteor(w: number, h: number): Meteor {
  // Start in the upper 60% of the sky, streak diagonally down.
  const x = w * (0.15 + Math.random() * 0.85);
  const y = h * Math.random() * 0.45;
  const dir = Math.random() < 0.5 ? -1 : 1;
  const speed = 7 + Math.random() * 6;
  const angle = Math.PI / 5 + (Math.random() * Math.PI) / 12; // ~30-45° below horizon
  const maxLife = 45 + Math.random() * 35; // frames @60fps
  return {
    x,
    y,
    vx: dir * speed * Math.cos(angle),
    vy: speed * Math.sin(angle),
    life: 0,
    maxLife,
    width: 1.2 + Math.random() * 1.1,
  };
}

export default function StarCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = window.innerWidth;
    let h = window.innerHeight;
    let stars = makeStars(w, h);
    let meteors: Meteor[] = [];
    let nextMeteor = performance.now() + 1500 + Math.random() * 3000;

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = makeStars(w, h);
    };
    resize();

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 150);
    };
    window.addEventListener('resize', onResize);

    const drawStatic = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const time = t / 1000;
      for (const s of stars) {
        const tw = 0.62 + 0.38 * Math.sin(time * s.speed + s.phase);
        const a = Math.max(0, Math.min(1, s.baseAlpha * tw));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${s.color},${a.toFixed(3)})`;
        ctx.fill();
        if (s.bright && a > 0.55) {
          // Subtle cross sparkle on the brightest stars.
          const len = s.r * 4 * ((a - 0.55) / 0.45);
          ctx.strokeStyle = `rgba(${s.color},${(a * 0.5).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(s.x - len, s.y);
          ctx.lineTo(s.x + len, s.y);
          ctx.moveTo(s.x, s.y - len);
          ctx.lineTo(s.x, s.y + len);
          ctx.stroke();
        }
      }
    };

    const drawMeteors = (now: number, dt: number) => {
      if (now >= nextMeteor && meteors.length < 3) {
        meteors.push(makeMeteor(w, h));
        nextMeteor = now + 2500 + Math.random() * 4500;
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.life += dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        const progress = m.life / m.maxLife;
        // Fade in fast, fade out slow.
        const fade = progress < 0.12 ? progress / 0.12 : 1 - (progress - 0.12) / 0.88;
        if (progress >= 1 || m.x < -200 || m.x > w + 200 || m.y > h + 200) {
          meteors.splice(i, 1);
          continue;
        }
        const tail = 90 + m.width * 22;
        const mag = Math.hypot(m.vx, m.vy) || 1;
        const tx = m.x - (m.vx / mag) * tail;
        const ty = m.y - (m.vy / mag) * tail;
        const grad = ctx.createLinearGradient(m.x, m.y, tx, ty);
        grad.addColorStop(0, `rgba(255,255,255,${(0.95 * fade).toFixed(3)})`);
        grad.addColorStop(0.25, `rgba(190,205,255,${(0.55 * fade).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(190,205,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = m.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        // Glowing head.
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.width * 1.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${(0.9 * fade).toFixed(3)})`;
        ctx.fill();
      }
    };

    // Reduced motion → one static frame, no loop at all.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      drawStatic(1200);
      window.removeEventListener('resize', onResize);
      return () => {
        window.removeEventListener('resize', onResize);
      };
    }

    let raf = 0;
    let last = performance.now();
    let running = !document.hidden;

    const frame = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 16.7, 3);
      last = now;
      drawStatic(now);
      drawMeteors(now, dt);
    };

    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        last = performance.now();
        nextMeteor = performance.now() + 1200;
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
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
