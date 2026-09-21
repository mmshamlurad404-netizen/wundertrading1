export function fmtPrice(v: number | null | undefined, decimals?: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '--'
  const d =
    decimals !== undefined
      ? decimals
      : v >= 1000
        ? 2
        : v >= 1
          ? 3
          : v >= 0.01
            ? 5
            : 8
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export function fmtUsd(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '--'
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

export function fmtCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '--'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`
  return v.toFixed(2)
}

export function fmtPct(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '--'
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`
}

export function fmtNum(v: number | null | undefined, decimals = 4): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '--'
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals })
}

export function timeAgo(ts?: number): string {
  if (!ts) return '--'
  const diff = Date.now() - ts
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function fmtTime(ts?: number): string {
  if (!ts) return '--'
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function pnlClass(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return 'neutral'
  return v > 0 ? 'up' : 'down'
}

export function baseOf(symbol: string): string {
  return symbol.split('/')[0]
}
