'use client'

import type { ReactNode } from 'react'

export function Panel({
  children,
  className = '',
  flush = false,
}: {
  children: ReactNode
  className?: string
  flush?: boolean
}) {
  return (
    <section
      className={`rounded-xl border border-line bg-surface ${flush ? '' : 'p-5'} ${className}`}
    >
      {children}
    </section>
  )
}

export function PanelTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-faint">{children}</h2>
      {aside}
    </div>
  )
}

const DIFFICULTY: Record<string, string> = {
  easy: 'text-good border-good/30 bg-good/10',
  medium: 'text-warn border-warn/30 bg-warn/10',
  hard: 'text-danger border-danger/30 bg-danger/10',
}

export function Chip({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode
  tone?: 'neutral' | 'easy' | 'medium' | 'hard' | 'accent'
  className?: string
}) {
  const style =
    tone === 'accent'
      ? 'text-accent border-accent/30 bg-accent/10'
      : (DIFFICULTY[tone] ?? 'text-muted border-line bg-raised')
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${style} ${className}`}
    >
      {children}
    </span>
  )
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  className = '',
  title,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  className?: string
  title?: string
}) {
  const styles = {
    primary:
      'bg-accent text-canvas hover:bg-accent/85 border-transparent font-semibold disabled:bg-accent/30',
    ghost: 'bg-raised text-ink hover:bg-line border-line',
    danger: 'bg-danger/10 text-danger hover:bg-danger/20 border-danger/30',
  }[variant]

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3.5 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${styles} ${className}`}
    >
      {children}
    </button>
  )
}

/** A single number with a label — the report leans on these heavily. */
export function Stat({
  label,
  value,
  unit,
  hint,
  tone,
}: {
  label: string
  value: string | number
  unit?: string
  hint?: string
  tone?: 'good' | 'warn' | 'danger' | 'speech' | 'code'
}) {
  const color = tone ? `var(--color-${tone})` : 'var(--color-ink)'
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-faint">{label}</div>
      <div className="tabular mt-1 font-mono text-2xl leading-none" style={{ color }}>
        {value}
        {unit ? <span className="ml-0.5 text-sm text-muted">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-1.5 text-[11px] leading-snug text-faint">{hint}</div> : null}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-faint">
      {children}
    </div>
  )
}
