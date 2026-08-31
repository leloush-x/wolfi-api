import { type ReactNode, type ButtonHTMLAttributes } from 'react';

/* ─── Card ──────────────────────────────────────────── */
export function Card({ children, className = '', ...props }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`ui-card ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="ui-card-title">
      {icon && <span className="ui-card-title-icon">{icon}</span>}
      {children}
    </div>
  );
}

/* ─── Badge ─────────────────────────────────────────── */
type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'accent' | 'purple';

const BADGE_CLASSES: Record<BadgeVariant, string> = {
  success: 'ui-badge-success',
  warning: 'ui-badge-warning',
  danger: 'ui-badge-danger',
  neutral: 'ui-badge-neutral',
  accent: 'ui-badge-accent',
  purple: 'ui-badge-purple',
};

export function Badge({ children, variant = 'neutral', dot, className = '' }: {
  children: ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={`ui-badge ${BADGE_CLASSES[variant]} ${className}`}>
      {dot && <span className="ui-badge-dot" />}
      {children}
    </span>
  );
}

/* ─── Button ────────────────────────────────────────── */
type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';

const BTN_CLASSES: Record<ButtonVariant, string> = {
  default: 'ui-btn',
  primary: 'ui-btn ui-btn-primary',
  danger: 'ui-btn ui-btn-danger',
  ghost: 'ui-btn ui-btn-ghost',
};

export function Button({ children, variant = 'default', icon, ...props }: {
  children?: ReactNode;
  variant?: ButtonVariant;
  icon?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`${BTN_CLASSES[variant]} ${props.className ?? ''}`} {...props}>
      {icon && <span className="ui-btn-icon">{icon}</span>}
      {children}
    </button>
  );
}

/* ─── Stat Card ─────────────────────────────────────── */
export function StatCard({ label, value, sub, badge }: {
  label: string;
  value: string | number;
  sub?: string;
  badge?: ReactNode;
}) {
  return (
    <Card className="ui-stat-card">
      <div className="ui-stat-label">{label}</div>
      <div className="ui-stat-row">
        <span className="ui-stat-value">{value}</span>
        {badge}
      </div>
      {sub && <div className="ui-stat-sub">{sub}</div>}
    </Card>
  );
}

/* ─── List Item ─────────────────────────────────────── */
export function ListItem({ left, right, icon }: {
  left: ReactNode;
  right: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="ui-list-item">
      <div className="ui-list-left">
        {icon && <span className="ui-list-icon">{icon}</span>}
        {left}
      </div>
      <div className="ui-list-right">{right}</div>
    </div>
  );
}

/* ─── Toggle ────────────────────────────────────────── */
export function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button className={`ui-toggle ${on ? 'ui-toggle-on' : ''}`} onClick={onToggle} aria-label="Toggle">
      <span className="ui-toggle-thumb" />
    </button>
  );
}

/* ─── Input ─────────────────────────────────────────── */
export function Input({ icon, ...props }: { icon?: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="ui-input-wrap">
      {icon && <span className="ui-input-icon">{icon}</span>}
      <input className="ui-input" {...props} />
    </div>
  );
}

/* ─── Skeleton ──────────────────────────────────────── */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`ui-skeleton ${className}`} />;
}
