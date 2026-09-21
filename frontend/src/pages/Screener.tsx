import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Flame, Search, TrendingUp } from 'lucide-react'
import { api } from '../api'
import { useAsync, Loader, CoinAvatar, Empty } from '../components/ui'
import { useLive } from '../live'
import { fmtCompact, fmtPct, fmtPrice } from '../lib/format'

interface ScreenerRow {
  symbol: string
  price: number
  change5m: number
  change1h: number
  change24h: number
  volume24h: number
  volumeRatio: number
  score: number
  signal: 'STRONG' | 'WATCH' | 'MILD' | 'NEUTRAL'
}

const SIGNAL_BADGE: Record<string, string> = {
  STRONG: 'green',
  WATCH: 'yellow',
  MILD: 'blue',
  NEUTRAL: 'gray',
}

export default function Screener() {
  const { data, loading, reload } = useAsync(() => api.get<{ results: ScreenerRow[] }>('/market/screener'), [])
  const { list } = useLive()
  const [q, setQ] = useState('')
  const [signal, setSignal] = useState('all')
  const [sortKey, setSortKey] = useState<keyof ScreenerRow>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [auto, setAuto] = useState(true)

  useEffect(() => {
    if (!auto) return
    const id = setInterval(reload, 3000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, reload])

  if (loading || !data) return <Loader label="Scanning markets" />

  const rows = data.results
    .filter((r) => (signal === 'all' ? true : r.signal === signal))
    .filter((r) => r.symbol.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })

  const strong = rows.filter((r) => r.signal === 'STRONG').length
  const pumping = rows.filter((r) => r.change5m > 1).length
  const totalVol = list.reduce((s, t) => s + (t.volume24h || 0), 0)

  function toggleSort(key: keyof ScreenerRow) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const Th = ({ k, children, num }: { k: keyof ScreenerRow; children: React.ReactNode; num?: boolean }) => (
    <th
      className={num ? 'num' : ''}
      style={{ cursor: 'pointer' }}
      onClick={() => toggleSort(k)}
    >
      {children} {sortKey === k ? (sortDir === 'asc' ? '^' : 'v') : ''}
    </th>
  )

  return (
    <div>
      <div className="spread" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">
            <Flame size={22} style={{ verticalAlign: -3, color: '#ff9f43' }} /> Pump Screener
          </h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Rank markets by short-term momentum and volume expansion.
          </p>
        </div>
        <label className="row" style={{ gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto refresh
          <button className="btn sm" onClick={reload}>
            Scan now
          </button>
        </label>
      </div>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="stat-label">Strong signals</div>
          <div className="stat-value mono up">{strong}</div>
        </div>
        <div className="card">
          <div className="stat-label">Pumping (5m &gt; 1%)</div>
          <div className="stat-value mono">{pumping}</div>
        </div>
        <div className="card">
          <div className="stat-label">Markets scanned</div>
          <div className="stat-value mono">{data.results.length}</div>
        </div>
        <div className="card">
          <div className="stat-label">24h volume</div>
          <div className="stat-value mono">{fmtCompact(totalVol)}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="panel-head" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 8 }}>
            <Search size={15} className="muted" />
            <input
              className="input"
              style={{ width: 220, padding: '7px 10px' }}
              placeholder="Filter market"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="tabs">
            {['all', 'STRONG', 'WATCH', 'MILD', 'NEUTRAL'].map((s) => (
              <button key={s} className={`tab ${signal === s ? 'active' : ''}`} onClick={() => setSignal(s)}>
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
            <TrendingUp size={13} style={{ verticalAlign: -2 }} /> {rows.length} results
          </span>
        </div>

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Market</th>
                <Th k="price" num>
                  Price
                </Th>
                <Th k="change5m" num>
                  5m
                </Th>
                <Th k="change1h" num>
                  1h
                </Th>
                <Th k="change24h" num>
                  24h
                </Th>
                <Th k="volumeRatio" num>
                  Vol ratio
                </Th>
                <Th k="volume24h" num>
                  24h vol
                </Th>
                <Th k="score" num>
                  Score
                </Th>
                <th>Signal</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.symbol}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <Link to="/app/terminal" className="row" style={{ gap: 9, fontWeight: 600 }}>
                      <CoinAvatar symbol={r.symbol} size={24} />
                      {r.symbol}
                    </Link>
                  </td>
                  <td className="num mono">{fmtPrice(r.price)}</td>
                  <td className={`num mono ${r.change5m >= 0 ? 'up' : 'down'}`}>{fmtPct(r.change5m)}</td>
                  <td className={`num mono ${r.change1h >= 0 ? 'up' : 'down'}`}>{fmtPct(r.change1h)}</td>
                  <td className={`num mono ${r.change24h >= 0 ? 'up' : 'down'}`}>{fmtPct(r.change24h)}</td>
                  <td className="num mono">{r.volumeRatio.toFixed(2)}x</td>
                  <td className="num mono">{fmtCompact(r.volume24h)}</td>
                  <td className="num mono">{r.score.toFixed(1)}</td>
                  <td>
                    <span className={`badge ${SIGNAL_BADGE[r.signal]}`}>{r.signal}</span>
                  </td>
                  <td>
                    <Link to="/app/terminal" className="btn ghost sm">
                      Trade
                    </Link>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={11}>
                    <Empty title="No markets match your filter" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
