import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react'
import { X } from 'lucide-react'
import { fmtPct, fmtUsd, pnlClass } from '../lib/format'

/* ------------------------------- Toasts ------------------------------- */
interface Toast {
  id: number
  message: string
  type: 'info' | 'success' | 'error'
}
const ToastContext = createContext<(message: string, type?: Toast['type']) => void>(() => {})
let toastId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastId
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

/* ------------------------------- Modal ------------------------------- */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 560,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }}>
        <div className="modal-head">
          <strong>{title}</strong>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/* ------------------------------- Loader ------------------------------- */
export function Loader({ label }: { label?: string }) {
  return (
    <div className="center">
      <div className="spinner" />
      {label && <div className="muted" style={{ marginTop: 12 }}>{label}</div>}
    </div>
  )
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{title}</div>
      {hint && <div style={{ fontSize: 13 }}>{hint}</div>}
    </div>
  )
}

/* ------------------------------- PnL ------------------------------- */
export function Pnl({ value, prefix = '', suffix = '', percent }: { value: number | null | undefined; prefix?: string; suffix?: string; percent?: boolean }) {
  const cls = pnlClass(value)
  const text = percent ? fmtPct(value) : `${prefix}${fmtUsd(value)}${suffix}`
  return <span className={`mono ${cls}`}>{text}</span>
}

/* ------------------------------- Stat ------------------------------- */
export function Stat({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  valueClass?: string
}) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${valueClass || ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

/* ------------------------------- Coin avatar ------------------------------- */
const AVATAR_COLORS = [
  ['#f7931a', '#7a4b06'],
  ['#627eea', '#2b3a80'],
  ['#14f195', '#0a7448'],
  ['#f0b90b', '#7a5c02'],
  ['#23292f', '#4b5563'],
  ['#e84142', '#7a1f20'],
  ['#f4b731', '#7a5a10'],
  ['#8247e5', '#432277'],
  ['#00d395', '#046a4b'],
  ['#e6007a', '#74003d'],
]
export function CoinAvatar({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const base = symbol.split('/')[0]
  const idx = base.charCodeAt(0) % AVATAR_COLORS.length
  const [c1, c2] = AVATAR_COLORS[idx]
  return (
    <div
      className="coin-avatar"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${c1}, ${c2})`,
        color: '#fff',
      }}
    >
      {base.slice(0, 3)}
    </div>
  )
}

/* ------------------------------- useApi hook ------------------------------- */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    fn()
      .then((res) => {
        if (active) {
          setData(res)
          setError(null)
        }
      })
      .catch((err) => {
        if (active) setError(err.message || 'Request failed')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { data, loading, error, reload, setData }
}

export function useInterval(callback: () => void, delay: number | null) {
  const cb = useMemo(() => callback, [callback])
  useEffect(() => {
    if (delay === null) return
    const id = setInterval(cb, delay)
    return () => clearInterval(id)
  }, [cb, delay])
}
