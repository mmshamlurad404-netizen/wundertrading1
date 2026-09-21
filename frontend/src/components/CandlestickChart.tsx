import { useMemo, useRef, useState, useEffect } from 'react'
import type { Candle } from '../types'
import { fmtCompact, fmtPrice } from '../lib/format'

interface Props {
  candles: Candle[]
  height?: number
  showVolume?: boolean
  lines?: { price: number; color: string; label: string }[]
  markers?: { price: number; color: string; label: string }[]
}

export default function CandlestickChart({
  candles,
  height = 380,
  showVolume = true,
  lines = [],
  markers = [],
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(760)
  const [hover, setHover] = useState<{ x: number; candle: Candle } | null>(null)

  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(320, e.contentRect.width))
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const padL = 10
  const padR = 62
  const padT = 12
  const volH = showVolume ? 64 : 0
  const chartH = height - padT - volH - 20
  const innerW = width - padL - padR

  const { min, max, maxVol, bw } = useMemo(() => {
    if (!candles.length) return { min: 0, max: 1, maxVol: 1, bw: 6 }
    let lo = Infinity
    let hi = -Infinity
    let mv = 0
    for (const c of candles) {
      lo = Math.min(lo, c.l)
      hi = Math.max(hi, c.h)
      mv = Math.max(mv, c.v)
    }
    for (const l of lines) {
      lo = Math.min(lo, l.price)
      hi = Math.max(hi, l.price)
    }
    for (const m of markers) {
      lo = Math.min(lo, m.price)
      hi = Math.max(hi, m.price)
    }
    const range = hi - lo || hi * 0.02 || 1
    lo -= range * 0.06
    hi += range * 0.06
    return { min: lo, max: hi, maxVol: mv || 1, bw: innerW / candles.length }
  }, [candles, innerW, lines, markers])

  const y = (p: number) => padT + chartH - ((p - min) / (max - min || 1)) * chartH
  const x = (i: number) => padL + (i + 0.5) * bw
  const vy = (v: number) => padT + chartH + 10 + (volH - 8) - (v / maxVol) * (volH - 8)

  const gridLines = 5
  const decimals = candles.length ? (candles[candles.length - 1].c >= 1000 ? 2 : candles[candles.length - 1].c >= 1 ? 3 : 6) : 2

  return (
    <div ref={wrapRef} style={{ width: '100%', position: 'relative' }}>
      <svg
        width={width}
        height={height}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.target as SVGElement).closest('svg')!.getBoundingClientRect()
          const mx = e.clientX - rect.left
          const idx = Math.min(candles.length - 1, Math.max(0, Math.floor((mx - padL) / bw)))
          if (candles[idx]) setHover({ x: mx, candle: candles[idx] })
        }}
      >
        {Array.from({ length: gridLines + 1 }).map((_, i) => {
          const gy = padT + (chartH / gridLines) * i
          const p = max - ((max - min) / gridLines) * i
          return (
            <g key={i}>
              <line x1={padL} x2={padL + innerW} y1={gy} y2={gy} stroke="#161f31" strokeWidth={1} />
              <text x={padL + innerW + 6} y={gy + 4} fill="#5d6b86" fontSize={10} className="mono">
                {fmtPrice(p, decimals)}
              </text>
            </g>
          )
        })}

        {/* candles */}
        {candles.map((c, i) => {
          const up = c.c >= c.o
          const color = up ? '#16c784' : '#ea3943'
          const cx = x(i)
          const bodyTop = y(Math.max(c.o, c.c))
          const bodyH = Math.max(1, Math.abs(y(c.o) - y(c.c)))
          const cw = Math.max(1, Math.min(bw * 0.68, 12))
          return (
            <g key={c.t}>
              <line x1={cx} x2={cx} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={1} />
              <rect
                x={cx - cw / 2}
                y={bodyTop}
                width={cw}
                height={bodyH}
                fill={color}
                rx={1}
                opacity={hover?.candle.t === c.t ? 1 : 0.92}
              />
              {showVolume && (
                <rect
                  x={cx - cw / 2}
                  y={vy(c.v)}
                  width={cw}
                  height={padT + chartH + 10 + volH - 8 - vy(c.v)}
                  fill={color}
                  opacity={0.28}
                  rx={1}
                />
              )}
            </g>
          )
        })}

        {/* horizontal price lines (TP/SL/entry) */}
        {lines.map((l, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={padL + innerW}
              y1={y(l.price)}
              y2={y(l.price)}
              stroke={l.color}
              strokeWidth={1}
              strokeDasharray="5 4"
              opacity={0.85}
            />
            <text x={padL + 4} y={y(l.price) - 4} fill={l.color} fontSize={10} fontWeight={700}>
              {l.label}
            </text>
          </g>
        ))}

        {/* markers */}
        {markers.map((m, i) => (
          <circle key={i} cx={x(candles.length - 1)} cy={y(m.price)} r={4} fill={m.color} opacity={0.9} />
        ))}

        {hover && (
          <g>
            <line
              x1={hover.x}
              x2={hover.x}
              y1={padT}
              y2={padT + chartH + volH + 10}
              stroke="#2c3c5c"
              strokeDasharray="3 3"
            />
          </g>
        )}
      </svg>

      {hover && (
        <div
          className="mono"
          style={{
            position: 'absolute',
            top: 6,
            left: Math.min(Math.max(hover.x - 90, 4), Math.max(4, width - 200)),
            background: 'rgba(12,17,29,0.95)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '7px 10px',
            fontSize: 11,
            display: 'flex',
            gap: 12,
            pointerEvents: 'none',
          }}
        >
          <span>
            O <b>{fmtPrice(hover.candle.o, decimals)}</b>
          </span>
          <span>
            H <b className="up">{fmtPrice(hover.candle.h, decimals)}</b>
          </span>
          <span>
            L <b className="down">{fmtPrice(hover.candle.l, decimals)}</b>
          </span>
          <span>
            C{' '}
            <b className={hover.candle.c >= hover.candle.o ? 'up' : 'down'}>
              {fmtPrice(hover.candle.c, decimals)}
            </b>
          </span>
          <span>
            V <b>{fmtCompact(hover.candle.v)}</b>
          </span>
        </div>
      )}
    </div>
  )
}
