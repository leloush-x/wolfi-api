/* ─── Line Chart ──────────────────────────────────────── */
export function LineChart({ data, color = 'var(--accent)', height = 140 }: {
  data: number[];
  color?: string;
  height?: number;
}) {
  const w = 400;
  const h = height;
  if (data.length === 0) return <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: h }} />;
  const max = Math.max(...data) * 1.2 || 1;
  const divisor = Math.max(data.length - 1, 1);
  const pts = data.map((v, i) => `${(i / divisor) * w},${h - (v / max) * h}`).join(' ');
  const area = `0,${h} ${pts} ${w},${h}`;
  const gradId = `lg-${color.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: h }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`M0,${h} ${pts} ${w},${h}`} fill={`url(#${gradId})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((v, i) => (
        <circle key={i} cx={(i / divisor) * w} cy={h - (v / max) * h} r="2.5" fill={color} />
      ))}
    </svg>
  );
}

/* ─── Bar Chart ──────────────────────────────────────── */
export function BarChart({ data, color = 'var(--accent)', height = 140 }: {
  data: number[];
  color?: string;
  height?: number;
}) {
  const w = 400;
  const h = height;
  const max = Math.max(...data) * 1.2 || 1;
  const bw = w / data.length - 6;
  const gradId = `bg-${color.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: h }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.85} />
          <stop offset="100%" stopColor={color} stopOpacity={0.2} />
        </linearGradient>
      </defs>
      {data.map((v, i) => {
        const bh = (v / max) * h;
        const x = i * (w / data.length) + 3;
        const y = h - bh;
        return <rect key={i} x={x} y={y} width={bw} height={bh} rx="3" fill={`url(#${gradId})`} />;
      })}
    </svg>
  );
}

/* ─── Donut Chart ────────────────────────────────────── */
export function DonutChart({ values, colors, size = 110 }: {
  values: number[];
  colors: string[];
  size?: number;
}) {
  const r = 42;
  const c = size / 2;
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--border)" strokeWidth="12" />
        <circle cx={c} cy={c} r={r - 18} fill="var(--bg-card)" />
      </svg>
    );
  }
  let acc = 0;

  const arcs = values.map((v, i) => {
    const angle = (v / total) * Math.PI * 2;
    const x1 = c + r * Math.cos(acc);
    const y1 = c + r * Math.sin(acc);
    const x2 = c + r * Math.cos(acc + angle);
    const y2 = c + r * Math.sin(acc + angle);
    const large = angle > Math.PI ? 1 : 0;
    const d = `M${c},${c} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`;
    acc += angle;
    return <path key={i} d={d} fill={colors[i]} stroke="var(--bg-card)" strokeWidth="3" />;
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {arcs}
      <circle cx={c} cy={c} r={r - 18} fill="var(--bg-card)" />
    </svg>
  );
}
