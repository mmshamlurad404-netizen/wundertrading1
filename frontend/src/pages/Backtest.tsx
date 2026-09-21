import { useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from 'recharts'
import { FlaskConical, Play, LineChart } from 'lucide-react'
import { api } from '../api'
import { useAsync, useToast, Loader, Empty } from '../components/ui'
import { fmtPrice, fmtUsd, fmtCompact } from '../lib/format'

interface BacktestResult {
  symbol: string
  timeframe: string
  strategy: string
  strategyLabel: string
  initialBalance: number
  finalEquity: number
  netProfit: number
  returnPct: number
  maxDrawdownPct: number
  winRate: number
  totalTrades: number
  profitFactor: number
  sharpe: number
  avgTrade: number
  equityCurve: { t: number; equity: number }[]
  trades: { side: string; entry: number; exit: number; pnl: number; reason: string; exitTime: number }[]
}

const STRATEGIES = [
  { id: 'ema_cross', label: 'EMA Crossover' },
  { id: 'rsi_reversion', label: 'RSI Mean Reversion' },
  { id: 'breakout', label: 'Range Breakout' },
  { id: 'grid', label: 'Grid Simulation' },
  { id: 'dca', label: 'DCA Simulation' },
]

export default function Backtest() {
  const toast = useToast()
  const { data: pairData } = useAsync(() => api.get<{ pairs: any[] }>('/market/pairs'), [])
  const [symbol, setSymbol] = useState('BTC/USDT')
  const [timeframe, setTimeframe] = useState('1h')
  const [strategy, setStrategy] = useState('ema_cross')
  const [initialBalance, setInitialBalance] = useState('10000')
  const [candles, setCandles] = useState('500')
  const [params, setParams] = useState<Record<string, string>>({
    fastPeriod: '9',
    slowPeriod: '21',
    takeProfitPct: '2',
    stopLossPct: '1.5',
    rsiPeriod: '14',
    window: '20',
    grids: '12',
    intervalBars: '24',
  })
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    try {
      const numericParams: Record<string, number> = {}
      for (const [k, v] of Object.entries(params)) numericParams[k] = Number(v)
      const res = await api.post<{ result: BacktestResult }>('/market/backtest', {
        symbol,
        timeframe,
        strategy,
        params: numericParams,
        initialBalance: Number(initialBalance),
        candleCount: Number(candles),
      })
      setResult(res.result)
      toast('Backtest complete', 'success')
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const paramFields = (() => {
    if (strategy === 'ema_cross') return ['fastPeriod', 'slowPeriod', 'takeProfitPct', 'stopLossPct']
    if (strategy === 'rsi_reversion') return ['rsiPeriod', 'takeProfitPct', 'stopLossPct']
    if (strategy === 'breakout') return ['window', 'stopLossPct']
    if (strategy === 'grid') return ['grids']
    return ['intervalBars', 'takeProfitPct', 'stopLossPct']
  })()

  const curve = (result?.equityCurve || []).map((c) => ({
    ...c,
    label: new Date(c.t).toLocaleDateString(),
  }))

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">
          <FlaskConical size={22} style={{ verticalAlign: -3 }} /> Backtesting
        </h1>
        <p className="page-sub" style={{ margin: 0 }}>
          Replay strategies on historical candles and compare performance before going live.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,320px) minmax(0,1fr)', alignItems: 'start' }}>
        <div className="card">
          <h3 className="card-title">Configuration</h3>
          <div className="field">
            <label>Market</label>
            <select className="select" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {(pairData?.pairs || []).map((p) => (
                <option key={p.symbol} value={p.symbol}>
                  {p.symbol}
                </option>
              ))}
            </select>
          </div>
          <div className="grid g2" style={{ gap: 10 }}>
            <div className="field">
              <label>Timeframe</label>
              <select className="select" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                {['15m', '1h', '4h', '1d'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Candles</label>
              <select className="select" value={candles} onChange={(e) => setCandles(e.target.value)}>
                {['200', '300', '500', '800', '1000'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Strategy</label>
            <select className="select" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              {STRATEGIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Initial balance (USDT)</label>
            <input className="input mono" value={initialBalance} onChange={(e) => setInitialBalance(e.target.value)} />
          </div>
          <div className="grid g2" style={{ gap: 10 }}>
            {paramFields.map((p) => (
              <div className="field" key={p}>
                <label>{p.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</label>
                <input
                  className="input mono"
                  value={params[p]}
                  onChange={(e) => setParams((s) => ({ ...s, [p]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <button className="btn primary block lg" onClick={run} disabled={busy}>
            {busy ? 'Running...' : (
              <>
                <Play size={16} /> Run backtest
              </>
            )}
          </button>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          {!result ? (
            <div className="card">
              <Empty title="No results yet" hint="Configure a strategy and run the backtest to see performance." />
            </div>
          ) : (
            <>
              <div className="grid g4">
                <div className="card">
                  <div className="stat-label">Net profit</div>
                  <div className={`stat-value mono ${result.netProfit >= 0 ? 'up' : 'down'}`}>
                    {fmtUsd(result.netProfit)}
                  </div>
                  <div className={`stat-sub ${result.returnPct >= 0 ? 'up' : 'down'}`}>
                    {result.returnPct >= 0 ? '+' : ''}
                    {result.returnPct}%
                  </div>
                </div>
                <div className="card">
                  <div className="stat-label">Max drawdown</div>
                  <div className="stat-value mono down">{result.maxDrawdownPct}%</div>
                </div>
                <div className="card">
                  <div className="stat-label">Win rate</div>
                  <div className="stat-value mono">{result.winRate}%</div>
                  <div className="stat-sub">{result.totalTrades} trades</div>
                </div>
                <div className="card">
                  <div className="stat-label">Sharpe / PF</div>
                  <div className="stat-value mono">{result.sharpe}</div>
                  <div className="stat-sub">Profit factor {result.profitFactor}</div>
                </div>
              </div>

              <div className="card">
                <div className="spread" style={{ marginBottom: 8 }}>
                  <h3 className="card-title" style={{ margin: 0 }}>
                    Equity curve
                  </h3>
                  <span className="badge blue">
                    {result.strategyLabel} · {result.symbol} · {result.timeframe}
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={curve}>
                    <defs>
                      <linearGradient id="beq" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#16c784" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#16c784" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="label" hide />
                    <YAxis domain={['auto', 'auto']} hide />
                    <Tooltip
                      contentStyle={{ background: '#101725', border: '1px solid #1f2a41', borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => [fmtUsd(v), 'Equity']}
                    />
                    <Area type="monotone" dataKey="equity" stroke="#16c784" strokeWidth={2} fill="url(#beq)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="grid g2">
                <div className="card">
                  <h3 className="card-title">Trade PnL distribution</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={result.trades.slice(-40)}>
                      <XAxis dataKey="exitTime" hide />
                      <YAxis hide />
                      <Tooltip
                        contentStyle={{ background: '#101725', border: '1px solid #1f2a41', borderRadius: 8, fontSize: 12 }}
                        formatter={(v: number) => [fmtUsd(v), 'PnL']}
                      />
                      <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                        {result.trades.slice(-40).map((t, i) => (
                          <Cell key={i} fill={t.pnl >= 0 ? '#16c784' : '#ea3943'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="card" style={{ padding: 0 }}>
                  <div className="panel-head">
                    <strong>Last trades</strong>
                  </div>
                  <div className="table-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Side</th>
                          <th className="num">Entry</th>
                          <th className="num">Exit</th>
                          <th className="num">PnL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.trades
                          .slice()
                          .reverse()
                          .slice(0, 30)
                          .map((t, i) => (
                            <tr key={i}>
                              <td className={t.side.includes('long') || t.side.includes('buy') ? 'up' : 'down'}>
                                {t.side}
                              </td>
                              <td className="num mono">{fmtPrice(t.entry)}</td>
                              <td className="num mono">{fmtPrice(t.exit)}</td>
                              <td className={`num mono ${t.pnl >= 0 ? 'up' : 'down'}`}>{fmtUsd(t.pnl)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
