import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Play, Pause, XCircle, Send, Save } from 'lucide-react'
import { api } from '../api'
import { useAsync, useToast, Loader, Empty, Pnl } from '../components/ui'
import { useLive } from '../live'
import { fmtPrice, fmtUsd, pnlClass, timeAgo } from '../lib/format'
import type { Bot, LogEntry, Position } from '../types'

export default function BotDetail() {
  const { id } = useParams()
  const toast = useToast()
  const { priceOf } = useLive()
  const { data, loading, reload } = useAsync(
    () => api.get<{ bot: Bot; positions: Position[]; logs: LogEntry[] }>(`/bots/${id}`),
    [id]
  )
  const [config, setConfig] = useState<Record<string, any>>({})
  const [signalAction, setSignalAction] = useState('buy')
  const [signalSize, setSignalSize] = useState('1')

  if (loading || !data) return <Loader />
  const bot = data.bot
  const open = data.positions.filter((p) => p.status === 'open')
  const closed = data.positions.filter((p) => p.status === 'closed')
  const currentConfig = { ...bot.config, ...config }

  return (
    <div>
      <Link to="/app/bots" className="btn ghost sm" style={{ marginBottom: 16 }}>
        <ArrowLeft size={15} /> All bots
      </Link>

      <div className="spread" style={{ marginBottom: 18 }}>
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h1 className="page-title" style={{ margin: 0 }}>
              {bot.name}
            </h1>
            <span className={`badge ${bot.status === 'running' ? 'green' : 'gray'}`}>{bot.status}</span>
          </div>
          <p className="page-sub" style={{ margin: '4px 0 0' }}>
            {bot.type.replace('_', ' ')} · {bot.symbol} · created {timeAgo(bot.createdAt)}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            className={`btn ${bot.status === 'running' ? '' : 'primary'}`}
            onClick={async () => {
              await api.post(`/bots/${bot.id}/${bot.status === 'running' ? 'stop' : 'start'}`)
              toast('Bot updated', 'success')
              reload()
            }}
          >
            {bot.status === 'running' ? (
              <>
                <Pause size={15} /> Stop bot
              </>
            ) : (
              <>
                <Play size={15} /> Start bot
              </>
            )}
          </button>
          <button
            className="btn danger"
            onClick={async () => {
              await api.post(`/bots/${bot.id}/close-all`)
              toast('Closing all bot positions', 'success')
              setTimeout(reload, 800)
            }}
          >
            <XCircle size={15} /> Close all
          </button>
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="stat-label">Total PnL</div>
          <div className={`stat-value mono ${(bot.stats?.pnl || 0) >= 0 ? 'up' : 'down'}`}>
            {fmtUsd(bot.stats?.pnl)}
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Realized / Unrealized</div>
          <div className="mono" style={{ fontWeight: 700, fontSize: 15 }}>
            <span className={pnlClass(bot.stats?.realizedPnl)}>{fmtUsd(bot.stats?.realizedPnl)}</span>
            {' / '}
            <span className={pnlClass(bot.stats?.unrealizedPnl)}>{fmtUsd(bot.stats?.unrealizedPnl)}</span>
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Win rate</div>
          <div className="stat-value mono">{bot.stats?.winRate || 0}%</div>
          <div className="stat-sub">{bot.stats?.closedTrades || 0} closed trades</div>
        </div>
        <div className="card">
          <div className="stat-label">Open positions</div>
          <div className="stat-value mono">{open.length}</div>
          <div className="stat-sub">{closed.length} historical</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card" style={{ padding: 0 }}>
            <div className="panel-head">
              <strong>Open positions</strong>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Side</th>
                    <th className="num">Entry</th>
                    <th className="num">Mark</th>
                    <th className="num">Size</th>
                    <th className="num">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((p) => (
                    <tr key={p.id}>
                      <td className={`badge ${p.side === 'long' ? 'green' : 'red'}`}>{p.side}</td>
                      <td className="num mono">{fmtPrice(p.entryPrice)}</td>
                      <td className="num mono">{fmtPrice(priceOf(p.symbol))}</td>
                      <td className="num mono">{p.size.toFixed(5)}</td>
                      <td className={`num mono ${pnlClass(p.unrealizedPnl)}`}>{fmtUsd(p.unrealizedPnl)}</td>
                    </tr>
                  ))}
                  {!open.length && (
                    <tr>
                      <td colSpan={5}>
                        <Empty title="No open positions" hint="The bot will open positions when its conditions trigger." />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div className="panel-head">
              <strong>Activity log</strong>
            </div>
            <div className="panel-body" style={{ maxHeight: 340, overflowY: 'auto' }}>
              {data.logs.map((l) => (
                <div key={l.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span
                      className={`badge ${
                        l.level === 'success' ? 'green' : l.level === 'error' ? 'red' : l.level === 'warning' ? 'yellow' : 'gray'
                      }`}
                      style={{ fontSize: 9.5, padding: '2px 7px' }}
                    >
                      {l.level}
                    </span>
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      {timeAgo(l.createdAt)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 4 }}>{l.message}</div>
                </div>
              ))}
              {data.logs.length === 0 && <Empty title="No log entries yet" />}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <div className="card">
            <h3 className="card-title">Configuration</h3>
            {Object.entries(currentConfig).map(([key, value]) =>
              typeof value === 'object' ? null : (
                <div className="field" key={key} style={{ marginBottom: 10 }}>
                  <label>{key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</label>
                  <input
                    className="input mono"
                    type={typeof value === 'number' ? 'number' : 'text'}
                    value={value as any}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        [key]: typeof value === 'number' ? Number(e.target.value) : e.target.value,
                      }))
                    }
                  />
                </div>
              )
            )}
            <button
              className="btn primary block"
              onClick={async () => {
                await api.patch(`/bots/${bot.id}`, { config: currentConfig })
                toast('Configuration saved', 'success')
                setConfig({})
                reload()
              }}
            >
              <Save size={15} /> Save configuration
            </button>
          </div>

          {bot.type === 'signal' && (
            <div className="card">
              <h3 className="card-title">Send a signal</h3>
              <p className="hint" style={{ marginBottom: 12 }}>
                Simulate an inbound TradingView-style webhook for this bot.
              </p>
              <div className="field">
                <label>Action</label>
                <select className="select" value={signalAction} onChange={(e) => setSignalAction(e.target.value)}>
                  <option value="buy">Buy / Long</option>
                  <option value="sell">Sell / Short</option>
                  <option value="close">Close</option>
                </select>
              </div>
              <div className="field">
                <label>Size multiplier</label>
                <input className="input mono" value={signalSize} onChange={(e) => setSignalSize(e.target.value)} />
              </div>
              <button
                className="btn primary block"
                onClick={async () => {
                  await api.post(`/bots/${bot.id}/signal`, {
                    action: signalAction,
                    sizeMultiplier: Number(signalSize),
                  })
                  toast('Signal dispatched', 'success')
                  setTimeout(reload, 600)
                }}
              >
                <Send size={15} /> Dispatch signal
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
