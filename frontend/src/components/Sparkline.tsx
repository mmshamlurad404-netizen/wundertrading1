interface Props {
  values: number[]
  width?: number
  height?: number
  color?: string
  fill?: boolean
}

export default function Sparkline({ values, width = 120, height = 34, color, fill = true }: Props) {
  if (!values || values.length < 2) return <div style={{ width, height }} />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const up = values[values.length - 1] >= values[0]
  const stroke = color || (up ? 'var(--up)' : 'var(--down)')
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 4) - 2
    return [x, y]
  })
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`
  const gid = `spark-${Math.round(values[0] * 100)}-${values.length}-${up ? 'u' : 'd'}`
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {fill && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={stroke} stopOpacity="0.28" />
              <stop offset="1" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gid})`} />
        </>
      )}
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.6} />
    </svg>
  )
}
