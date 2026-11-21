import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  LoaderCircle,
  type LucideIcon,
} from 'lucide-react'
import {
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { fmt, fmtFull, statusColor, statusLabel } from './format'

export function Button({
  busy,
  leading,
  trailing,
  color,
  children,
  className = '',
  disabled,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean
  leading?: ReactNode
  trailing?: ReactNode
  color?: 'primary'
}) {
  return (
    <button
      type={type}
      className={`button ${color === 'primary' ? 'button-primary' : ''} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? <LoaderCircle className="spin" size={15} /> : leading}
      {children}
      {trailing}
    </button>
  )
}

export function Panel({
  className = '',
  ...props
}: HTMLAttributes<HTMLElement>) {
  return <section className={`panel ${className}`} {...props} />
}
export function PanelHeader({ children }: { children: ReactNode }) {
  return <header className="panel-header">{children}</header>
}
export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="panel-body">{children}</div>
}
export function Chip({
  color = 'default',
  children,
  leading,
}: {
  color?: 'success' | 'danger' | 'warning' | 'primary' | 'default'
  children: ReactNode
  leading?: ReactNode
}) {
  return (
    <span className={`chip chip-${color}`}>
      {leading}
      {children}
    </span>
  )
}

export function Input({
  label,
  leading,
  trailing,
  onValueChange,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  leading?: ReactNode
  trailing?: ReactNode
  onValueChange?: (value: string) => void
}) {
  return (
    <div className={`input-field ${className}`}>
      {label && (
        <label>
          <span>{label}</span>
          <input
            {...props}
            onChange={(event) => onValueChange?.(event.target.value)}
          />
        </label>
      )}
      {!label && (
        <div className="input-control">
          {leading}
          <input
            {...props}
            onChange={(event) => onValueChange?.(event.target.value)}
          />
        </div>
      )}
      {trailing}
    </div>
  )
}

export function SelectField({
  leading,
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { leading?: ReactNode }) {
  return (
    <div
      className={`select-field ${className} ${leading ? 'select-with-icon' : ''}`}
    >
      {leading}
      <select {...props}>{children}</select>
      <ChevronDown className="select-chevron" size={15} aria-hidden />
    </div>
  )
}

export function Toolbar({
  children,
  note,
}: {
  children: ReactNode
  note?: string
}) {
  return (
    <div className="toolbar">
      {children}
      {note && <span className="toolbar-note">{note}</span>}
    </div>
  )
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="empty" role="status">
      <Inbox size={21} />
      <span>{text}</span>
    </div>
  )
}

export function LoadingRows() {
  return (
    <div className="panel-loading" role="status">
      <LoaderCircle className="spin" size={19} />
      正在加载…
    </div>
  )
}

export function Status({ value }: { value?: string }) {
  return <Chip color={statusColor(value)}>{statusLabel(value)}</Chip>
}

export function Timestamp({ value }: { value?: string | number | null }) {
  return (
    <time
      dateTime={
        typeof value === 'string' && Number.isFinite(Date.parse(value))
          ? value
          : undefined
      }
      title={value == null ? undefined : fmtFull(value)}
    >
      {fmt(value)}
    </time>
  )
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: ReactNode
  hint?: string
  icon: LucideIcon
}) {
  return (
    <Panel className="stat-card">
      <div className="stat-label">
        <Icon size={15} aria-hidden />
        {label}
      </div>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </Panel>
  )
}

export function DataTable({
  children,
  className = '',
  'aria-label': label,
}: {
  children: ReactNode
  className?: string
  'aria-label': string
}) {
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={label}>
      <table className={`data-table ${className}`} aria-label={label}>
        {children}
      </table>
    </div>
  )
}

export function PagedRows<T>({
  items,
  size = 30,
  children,
}: {
  items: T[]
  size?: number
  children: (rows: T[]) => ReactNode
}) {
  const [page, setPage] = useState(0)
  const pages = Math.ceil(items.length / size)
  const current = Math.max(0, Math.min(page, pages - 1))
  const start = current * size
  return (
    <>
      {children(items.slice(start, start + size))}
      {pages > 1 && (
        <div className="pagination" aria-label="分页">
          <span>
            {start + 1}–{Math.min(start + size, items.length)} / {items.length}
          </span>
          <div>
            <Button
              aria-label="上一页"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              <ChevronLeft size={16} />
            </Button>
            <span aria-live="polite">
              {current + 1} / {pages}
            </span>
            <Button
              aria-label="下一页"
              disabled={current + 1 === pages}
              onClick={() => setPage(current + 1)}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
