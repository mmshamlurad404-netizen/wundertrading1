import { useEffect, useMemo, useState } from 'react'
import {
  Search,
  Star,
  ChevronDown,
  X,
  Settings2,
  ArrowUpDown,
} from 'lucide-react'
import { api } from '../api'
import { useLive } from '../live'
import { useAsync, useToast, CoinAvatar, Loader, Pnl, Empty } from '../components/ui'
import CandlestickChart from '../components/CandlestickChart'
import { fmtCompact, fmtPrice, fmtPct, fmtUsd, pnlClass } from '../lib/format'
import type { Account, Candle, Order, Position } from '../types'

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d']

function SymbolPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (s: string) => void
}) {
  const { list } = useLive()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const filtered = list
    .filter((t) => t.symbol.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 40)

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn" onClick={() => setOpen((o) => !o)} style={{ minWidth: 168, justifyContent: 'flex-start' }}>
        <CoinAvatar symbol={value} size={20} />
        <strong>{value}</strong>
        <ChevronDown size={14} style={{ marginLeft: 'auto' }} />
      </button>
      {open && (
        <div className="card" style={{ position: 'absolute', top: 44, left: 0, width: 330, zIndex: 40, padding: 10 }}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <Search size={15} className="muted" />
            <input
              className="input"
              style={{ padding: '7px 10px' }}
              placeholder="Search market"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {filtered.map((t) => (
              <button
                key={t.symbol}
                className="list-item"
                style={{ width: '100%', background: 'none', border: 'none', color: 'inherit', textAlign: 'left' }}
                onClick={() => {
                  onChange(t.symbol)
                  setOpen(false)
                }}
              >
                <div className="row" style={{ gap: 9 }}>
                  <CoinAvatar symbol={t.symbol} size={22} />
                  <span style={{ fontWeight: 600 }}>{t.symbol}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="mono">{fmtPrice(t.price)}</div>
                  <div className={`mono ${t.change24h >= 0 ? 'up' : 'down'}`} style={{ fontSize: 11 }}>
                    {fmtPct(t.change24h)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function OrderBook({ symbol, last }: { symbol: string; last: number }) {
  const { data, reload } = useAsync(
    () => api.get<{ bids: any[]; asks: any[] }>(`/market/orderbook/${encodeURIComponent(symbol)}`),
    [symbol]
  )
  useEffect(() => {
    const id = setInterval(reload, 2000)
    return () => clearInterval(id)
  }, [reload])

  const maxSize = Math.max(
    1,
    ...(data?.bids || []).map((b) => b.size),
    ...(data?.asks || []).map((a) => a.size)
  )

  return (
    <div>
      <div className="book-row book-head">
        <span>Price</span>
        <span className="num" style={{ textAlign: 'right' }}>Size</span>
        <span style={{ textAlign: 'right' }}>Total</span>
      </div>
      <div>
        {(data?.asks || []).slice(0, 10).reverse().map((a, i) => (
          <div className="book-row mono" key={`a${i}`} style={{ position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: `${(a.size / maxSize) * 100}%`,
                background: 'rgba(234,57,67,0.1)',
              }}
            />
            <span className="down">{fmtPrice(a.price)}</span>
            <span style={{ textAlign: 'right' }}>{a.size.toFixed(4)}</span>
            <span style={{ textAlign: 'right' }}>{(a.price * a.size).toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div style={{ padding: '8px 4px', fontSize: 17, fontWeight: 800 }} className="mono">
        {fmtPrice(last)}
      </div>
      <div>
        {(data?.bids || []).slice(0, 10).map((b, i) => (
          <div className="book-row mono" key={`b${i}`} style={{ position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: `${(b.size / maxSize) * 100}%`,
                background: 'rgba(22,199,132,0.1)',
              }}
            />
            <span className="up">{fmtPrice(b.price)}</span>
            <span style={{ textAlign: 'right' }}>{b.size.toFixed(4)}</span>
            <span style={{ textAlign: 'right' }}>{(b.price * b.size).toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function OrderForm({
  symbol,
  price,
  accounts,
  onDone,
}: {
  symbol: string
  price: number
  accounts: Account[]
  onDone: () => void
}) {
  const toast = useToast()
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [accountId, setAccountId] = useState(accounts[0]?.id || '')
  const [margin, setMargin] = useState('500')
  const [leverage, setLeverage] = useState('5')
  const [tp, setTp] = useState('')
  const [sl, setSl] = useState('')
  const [trailing, setTrailing] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id)
  }, [accounts, accountId])

  const qty = useMemo(() => {
    const m = Number(margin) || 0
    const l = Number(leverage) || 1
    return (m * l) / (price || 1)
  }, [margin, leverage, price])

  async function submit() {
    const acct = accounts.find((a) => a.id === accountId)
    if (acct?.live) {
      const ok = confirm(
        `This places a REAL ${side.toUpperCase()} order on ${acct.label} (${acct.exchange}).\n\nMargin ${margin} USDT at ${leverage}x. Continue?`
      )
      if (!ok) return
    }
    setBusy(true)
    try {
      await api.post('/positions', {
        accountId,
        symbol,
        side,
        margin: Number(margin),
        leverage: Number(leverage),
        takeProfit: tp ? Number(tp) : undefined,
        stopLoss: sl ? Number(sl) : undefined,
        trailingStop: trailing ? Number(trailing) : undefined,
      })
      toast(`${side === 'long' ? 'Long' : 'Short'} ${symbol} opened`, 'success')
      onDone()
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const account = accounts.find((a) => a.id === accountId)

  return (
    <div>
      <div className="tabs" style={{ width: '100%', marginBottom: 14 }}>
        <button
          className={`tab ${side === 'long' ? 'active' : ''}`}
          style={{ flex: 1, color: side === 'long' ? 'var(--up)' : undefined }}
          onClick={() => setSide('long')}
        >
          Long
        </button>
        <button
          className={`tab ${side === 'short' ? 'active' : ''}`}
          style={{ flex: 1, color: side === 'short' ? 'var(--down)' : undefined }}
          onClick={() => setSide('short')}
        >
          Short
        </button>
      </div>

      <div className="field">
        <label>Account</label>
        <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} — {fmtUsd(a.equity)}{a.live ? ' · LIVE' : ''}
            </option>
          ))}
        </select>
        {account?.live && (
          <div className="hint" style={{ color: 'var(--up)' }}>
            Live account: orders are routed to {account.exchange}
            {account.marketType ? ` ${account.marketType}` : ''} and settle in real funds.
          </div>
        )}
      </div>

      <div className="grid g2" style={{ gap: 10 }}>
        <div className="field">
          <label>Margin (USDT)</label>
          <input className="input mono" value={margin} onChange={(e) => setMargin(e.target.value)} />
        </div>
        <div className="field">
          <label>Leverage</label>
          <select className="select" value={leverage} onChange={(e) => setLeverage(e.target.value)}>
            {[1, 2, 3, 5, 10, 20, 50].map((l) => (
              <option key={l} value={l}>
                {l}x
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card" style={{ background: 'var(--bg-soft)', padding: 12, marginBottom: 14 }}>
        <div className="spread" style={{ fontSize: 12.5 }}>
          <span className="muted">Est. size</span>
          <span className="mono">{qty.toFixed(6)}</span>
        </div>
        <div className="spread" style={{ fontSize: 12.5, marginTop: 5 }}>
          <span className="muted">Notional</span>
          <span className="mono">{fmtUsd((Number(margin) || 0) * (Number(leverage) || 1))}</span>
        </div>
        <div className="spread" style={{ fontSize: 12.5, marginTop: 5 }}>
          <span className="muted">Available</span>
          <span className="mono">{fmtUsd(account?.live ? account.equity : account?.balances?.USDT || 0)}</span>
        </div>
      </div>

      <div className="grid g3" style={{ gap: 10 }}>
        <div className="field">
          <label>Take profit</label>
          <input className="input mono" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="price" />
        </div>
        <div className="field">
          <label>Stop loss</label>
          <input className="input mono" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="price" />
        </div>
        <div className="field">
          <label>Trailing %</label>
          <input className="input mono" value={trailing} onChange={(e) => setTrailing(e.target.value)} placeholder="1.5" />
        </div>
      </div>

      <button className={`btn block lg ${side === 'long' ? 'buy' : 'sell'}`} onClick={submit} disabled={busy}>
        {busy ? 'Placing...' : `${side === 'long' ? 'Buy / Long' : 'Sell / Short'} ${symbol.split('/')[0]}`}
      </button>
    </div>
  )
}

function PositionRow({
  p,
  price,
  onChanged,
}: {
  p: Position
  price: number | null
  onChanged: () => void
}) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [tp, setTp] = useState(p.takeProfit ? String(p.takeProfit) : '')
  const [sl, setSl] = useState(p.stopLoss ? String(p.stopLoss) : '')
  const pnl = p.unrealizedPnl || 0
  const roe = p.margin ? (pnl / p.margin) * 100 : 0

  return (
    <tr>
      <td>
        <div className="row" style={{ gap: 8 }}>
          <span className={`badge ${p.side === 'long' ? 'green' : 'red'}`}>{p.side}</span>
          <div>
            <div style={{ fontWeight: 700 }}>{p.symbol}</div>
            <div className="muted" style={{ fontSize: 11 }}>
              {p.leverage}x · {p.source}
            </div>
          </div>
        </div>
      </td>
      <td className="num mono">{fmtPrice(p.entryPrice)}</td>
      <td className="num mono">{price ? fmtPrice(price) : '--'}</td>
      <td className="num mono">
        {p.size.toFixed(5)}
        <div className="muted" style={{ fontSize: 11 }}>
          {fmtUsd(p.notional)}
        </div>
      </td>
      <td className={`num mono ${pnlClass(pnl)}`}>
        {fmtUsd(pnl)}
        <div style={{ fontSize: 11 }}>{fmtPct(roe)}</div>
      </td>
      <td className="mono" style={{ fontSize: 12 }}>
        <div className="muted">TP {p.takeProfit ? fmtPrice(p.takeProfit) : '--'}</div>
        <div className="muted">SL {p.stopLoss ? fmtPrice(p.stopLoss) : '--'}</div>
      </td>
      <td>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn ghost sm" onClick={() => setEditing((e) => !e)}>
            <Settings2 size={14} />
          </button>
          <button
            className="btn danger sm"
            onClick={async () => {
              await api.post(`/positions/${p.id}/close`)
              toast(`Closed ${p.symbol}`, 'success')
              onChanged()
            }}
          >
            Close
          </button>
        </div>
        {editing && (
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            <input className="input mono" style={{ padding: '5px 8px', width: 90 }} value={tp} onChange={(e) => setTp(e.target.value)} placeholder="TP" />
            <input className="input mono" style={{ padding: '5px 8px', width: 90 }} value={sl} onChange={(e) => setSl(e.target.value)} placeholder="SL" />
            <button
              className="btn sm primary"
              onClick={async () => {
                await api.patch(`/positions/${p.id}`, {
                  takeProfit: tp ? Number(tp) : null,
                  stopLoss: sl ? Number(sl) : null,
                })
                setEditing(false)
                onChanged()
              }}
            >
              Save
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

export default function Terminal() {
  const { tickers, priceOf } = useLive()
  const [symbol, setSymbol] = useState('BTC/USDT')
  const [timeframe, setTimeframe] = useState('15m')
  const [tab, setTab] = useState<'positions' | 'orders' | 'history'>('positions')
  const [mode, setMode] = useState<'classic' | 'spread'>('classic')

  const { data: accountsData, reload: reloadAccounts } = useAsync(() => api.get<{ accounts: Account[] }>('/accounts'), [])
  const { data: cData, reload: reloadCandles } = useAsync(
    () => api.get<{ candles: Candle[] }>(`/market/candles/${encodeURIComponent(symbol)}?timeframe=${timeframe}&limit=200`),
    [symbol, timeframe]
  )
  const { data: pData, reload: reloadPositions } = useAsync(
    () => api.get<{ positions: Position[] }>('/positions?status=open'),
    []
  )
  const { data: oData, reload: reloadOrders } = useAsync(() => api.get<{ orders: Order[] }>('/orders'), [])
  const { data: hData, reload: reloadHistory } = useAsync(
    () => api.get<{ positions: Position[] }>('/positions?status=closed'),
    []
  )

  const openForSymbol = (pData?.positions || []).filter((p) => p.symbol === symbol)
  const lines = openForSymbol.flatMap((p) => [
    { price: p.entryPrice, color: 'var(--accent)', label: `Entry ${p.side}` },
    ...(p.takeProfit ? [{ price: p.takeProfit, color: 'var(--up)', label: 'TP' }] : []),
    ...(p.stopLoss ? [{ price: p.stopLoss, color: 'var(--down)', label: 'SL' }] : []),
  ])

  function refreshAll() {
    reloadPositions()
    reloadOrders()
    reloadHistory()
    reloadAccounts()
  }

  useEffect(() => {
    const id = setInterval(reloadCandles, 5000)
    return () => clearInterval(id)
  }, [reloadCandles])

  useEffect(() => {
    const id = setInterval(refreshAll, 4000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const t = tickers[symbol]
  const price = priceOf(symbol) || 0
  const decimals = price >= 1000 ? 2 : price >= 1 ? 3 : 6

  return (
    <div>
      <div className="spread" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 14 }}>
          <SymbolPicker value={symbol} onChange={setSymbol} />
          <div>
            <div className="row" style={{ gap: 12 }}>
              <span className="mono" style={{ fontSize: 24, fontWeight: 800 }}>
                {fmtPrice(price, decimals)}
              </span>
              <span className={`mono ${t?.change24h >= 0 ? 'up' : 'down'}`} style={{ fontSize: 14 }}>
                {fmtPct(t?.change24h)}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              24h High {fmtPrice(t?.high24h, decimals)} · Low {fmtPrice(t?.low24h, decimals)} · Vol{' '}
              {fmtCompact(t?.volume24h)}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div className="tabs">
            <button className={`tab ${mode === 'classic' ? 'active' : ''}`} onClick={() => setMode('classic')}>
              Classic
            </button>
            <button className={`tab ${mode === 'spread' ? 'active' : ''}`} onClick={() => setMode('spread')}>
              Spread
            </button>
          </div>
          <button className="btn ghost sm" title="Add to watchlist">
            <Star size={15} />
          </button>
        </div>
      </div>

      <div className="terminal-grid">
        <div>
          <div className="card" style={{ padding: 0, marginBottom: 16 }}>
            <div className="panel-head">
              <div className="tabs">
                {TIMEFRAMES.map((tf) => (
                  <button key={tf} className={`tab ${timeframe === tf ? 'active' : ''}`} onClick={() => setTimeframe(tf)}>
                    {tf}
                  </button>
                ))}
              </div>
              <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
                {mode === 'spread' ? 'Spread view: long leg vs short leg' : 'Candlestick chart'}
              </span>
            </div>
            <div className="panel-body">
              {!cData ? (
                <Loader />
              ) : (
                <CandlestickChart candles={cData.candles} height={400} lines={lines} />
              )}
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div className="panel-head">
              <div className="tabs">
                <button className={`tab ${tab === 'positions' ? 'active' : ''}`} onClick={() => setTab('positions')}>
                  Positions ({(pData?.positions || []).length})
                </button>
                <button className={`tab ${tab === 'orders' ? 'active' : ''}`} onClick={() => setTab('orders')}>
                  Orders
                </button>
                <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
                  History
                </button>
              </div>
              <button className="btn ghost sm" onClick={refreshAll} style={{ marginLeft: 'auto' }}>
                <ArrowUpDown size={14} /> Refresh
              </button>
            </div>
            <div className="table-wrap">
              {tab === 'positions' && (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Position</th>
                      <th className="num">Entry</th>
                      <th className="num">Mark</th>
                      <th className="num">Size</th>
                      <th className="num">PnL</th>
                      <th>TP / SL</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(pData?.positions || []).map((p) => (
                      <PositionRow key={p.id} p={p} price={priceOf(p.symbol)} onChanged={refreshAll} />
                    ))}
                    {!(pData?.positions || []).length && (
                      <tr>
                        <td colSpan={7}>
                          <Empty title="No open positions" hint="Place an order to open your first position." />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
              {tab === 'orders' && (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Type</th>
                      <th className="num">Qty</th>
                      <th className="num">Price</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(oData?.orders || []).slice(0, 40).map((o) => (
                      <tr key={o.id}>
                        <td className="muted mono" style={{ fontSize: 12 }}>
                          {new Date(o.createdAt).toLocaleTimeString()}
                        </td>
                        <td>{o.symbol}</td>
                        <td className={o.side === 'buy' ? 'up' : 'down'} style={{ fontWeight: 700 }}>
                          {o.side.toUpperCase()}
                        </td>
                        <td className="muted">{o.type}</td>
                        <td className="num mono">{o.qty.toFixed(5)}</td>
                        <td className="num mono">{fmtPrice(o.filledPrice || o.price)}</td>
                        <td>
                          <span className="badge gray">{o.source}</span>
                        </td>
                      </tr>
                    ))}
                    {!(oData?.orders || []).length && (
                      <tr>
                        <td colSpan={7}>
                          <Empty title="No orders yet" />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
              {tab === 'history' && (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th className="num">Entry</th>
                      <th className="num">Exit</th>
                      <th className="num">PnL</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(hData?.positions || []).slice(0, 40).map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 600 }}>{p.symbol}</td>
                        <td className={`badge ${p.side === 'long' ? 'green' : 'red'}`}>{p.side}</td>
                        <td className="num mono">{fmtPrice(p.entryPrice)}</td>
                        <td className="num mono">{fmtPrice(p.closePrice)}</td>
                        <td className={`num mono ${pnlClass(p.realizedPnl)}`}>{fmtUsd(p.realizedPnl)}</td>
                        <td>
                          <span className="badge gray">{p.closeReason || 'manual'}</span>
                        </td>
                      </tr>
                    ))}
                    {!(hData?.positions || []).length && (
                      <tr>
                        <td colSpan={6}>
                          <Empty title="No closed trades yet" />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="card" style={{ padding: 0, marginBottom: 16 }}>
            <div className="panel-head">
              <strong style={{ fontSize: 14 }}>Order book</strong>
            </div>
            <div className="panel-body">
              <OrderBook symbol={symbol} last={price} />
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div className="panel-head">
              <strong style={{ fontSize: 14 }}>Place order</strong>
            </div>
            <div className="panel-body">
              {accountsData ? (
                <OrderForm
                  symbol={symbol}
                  price={price || 1}
                  accounts={accountsData.accounts.filter((a) => a.mode !== 'readonly')}
                  onDone={refreshAll}
                />
              ) : (
                <Loader />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
