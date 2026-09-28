import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bot as BotIcon,
  Plus,
  Play,
  Pause,
  Trash2,
  Grid3x3,
  TrendingDown,
  Radio,
  GitCompareArrows,
  BrainCircuit,
} from 'lucide-react'
import { api } from '../api'
import { useAsync, useToast, Modal, Loader, Empty, Pnl } from '../components/ui'
import { useLive } from '../live'
import { timeAgo } from '../lib/format'
import type { Account, Bot } from '../types'

const TYPE_ICON: Record<string, any> = {
  grid: Grid3x3,
  dca: TrendingDown,
  signal: Radio,
  market_neutral: GitCompareArrows,
  ai: BrainCircuit,
}

const TYPE_FIELDS: Record<string, { key: string; label: string; step?: string; def: number }[]> = {
  grid: [
    { key: 'lowerPrice', label: 'Lower price', def: 0 },
    { key: 'upperPrice', label: 'Upper price', def: 0 },
    { key: 'grids', label: 'Number of grids', def: 10 },
    { key: 'investmentPerGrid', label: 'Margin per grid (USDT)', def: 150 },
  ],
  dca: [
    { key: 'baseOrderSize', label: 'Base order (USDT)', def: 300 },
    { key: 'safetyOrderSize', label: 'Safety order (USDT)', def: 200 },
    { key: 'maxSafetyOrders', label: 'Max safety orders', def: 5 },
    { key: 'priceDeviation', label: 'Deviation %', step: '0.1', def: 2 },
    { key: 'safetyOrderVolumeScale', label: 'Volume scale', step: '0.1', def: 1.4 },
    { key: 'takeProfitPct', label: 'Take profit %', step: '0.1', def: 1.5 },
    { key: 'stopLossPct', label: 'Stop loss %', step: '0.1', def: 12 },
  ],
  signal: [
    { key: 'orderSize', label: 'Order size (USDT)', def: 200 },
    { key: 'takeProfitPct', label: 'Take profit %', step: '0.1', def: 2 },
    { key: 'stopLossPct', label: 'Stop loss %', step: '0.1', def: 1.5 },
  ],
  market_neutral: [
    { key: 'legSize', label: 'Leg margin (USDT)', def: 500 },
    { key: 'leverage', label: 'Leverage', def: 2 },
    { key: 'targetFunding', label: 'Funding target (USDT)', def: 25 },
  ],
  ai: [
    { key: 'orderSize', label: 'Order size (USDT)', def: 500 },
    { key: 'leverage', label: 'Leverage', def: 2 },
    { key: 'fastPeriod', label: 'Fast EMA', def: 9 },
    { key: 'slowPeriod', label: 'Slow EMA', def: 21 },
    { key: 'takeProfitPct', label: 'Take profit %', step: '0.1', def: 2 },
    { key: 'stopLossPct', label: 'Stop loss %', step: '0.1', def: 1.5 },
    { key: 'maxHoldMinutes', label: 'Max hold (min)', def: 240 },
  ],
}

function CreateBotModal({
  types,
  accounts,
  onClose,
  onCreated,
}: {
  types: { id: string; label: string; description: string }[]
  accounts: Account[]
  onClose: () => void
  onCreated: () => void
}) {
  const toast = useToast()
  const { list } = useLive()
  const [type, setType] = useState(types[0]?.id || 'grid')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('BTC/USDT')
  const [accountId, setAccountId] = useState(accounts[0]?.id || '')
  const [config, setConfig] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)

  const fields = TYPE_FIELDS[type] || []
  const price = list.find((t) => t.symbol === symbol)?.price || 0

  async function submit() {
    const liveAccount = accounts.find((a) => a.id === accountId)?.live
    if (liveAccount && !confirm(`Create a bot that trades REAL funds on your live account?\n\nStrategy: ${type} on ${symbol}. Continue?`)) return
    setBusy(true)
    try {
      const finalConfig: Record<string, number> = {}
      for (const f of fields) {
        let v = config[f.key] !== undefined ? config[f.key] : f.def
        if (type === 'grid' && v === 0 && f.key === 'lowerPrice') v = +(price * 0.92).toFixed(4)
        if (type === 'grid' && v === 0 && f.key === 'upperPrice') v = +(price * 1.08).toFixed(4)
        finalConfig[f.key] = v
      }
      await api.post('/bots', {
        name: name || undefined,
        type,
        symbol,
        accountId,
        config: finalConfig,
      })
      toast('Bot created', 'success')
      onCreated()
      onClose()
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Create a trading bot"
      onClose={onClose}
      width={620}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? 'Creating...' : 'Create bot'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Strategy</label>
        <div className="grid g3" style={{ gap: 8 }}>
          {types.map((t) => {
            const Icon = TYPE_ICON[t.id] || BotIcon
            return (
              <button
                key={t.id}
                className="card"
                style={{
                  padding: 12,
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderColor: type === t.id ? 'var(--accent)' : undefined,
                  background: type === t.id ? 'rgba(91,140,255,0.1)' : undefined,
                  color: 'inherit',
                }}
                onClick={() => setType(t.id)}
              >
                <Icon size={17} style={{ marginBottom: 8, color: '#a9c1ff' }} />
                <div style={{ fontWeight: 700, fontSize: 13 }}>{t.label}</div>
              </button>
            )
          })}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          {types.find((t) => t.id === type)?.description}
        </div>
      </div>

      <div className="grid g2" style={{ gap: 12 }}>
        <div className="field">
          <label>Bot name (optional)</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="My strategy" />
        </div>
        <div className="field">
          <label>Market</label>
          <select className="select" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {list.map((t) => (
              <option key={t.symbol} value={t.symbol}>
                {t.symbol}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Account</label>
        <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
              {a.live ? ' · LIVE' : a.mode === 'demo' ? ' · demo' : ''}
            </option>
          ))}
        </select>
        {accounts.find((a) => a.id === accountId)?.live && (
          <div className="hint" style={{ color: 'var(--up)' }}>
            This bot will execute real orders on your live exchange account.
          </div>
        )}
      </div>

      <div className="grid g2" style={{ gap: 12 }}>
        {fields.map((f) => (
          <div className="field" key={f.key}>
            <label>{f.label}</label>
            <input
              className="input mono"
              type="number"
              step={f.step || '1'}
              value={config[f.key] ?? (type === 'grid' && f.key === 'lowerPrice' && price ? +(price * 0.92).toFixed(4) : config[f.key] ?? f.def)}
              onChange={(e) => setConfig((c) => ({ ...c, [f.key]: Number(e.target.value) }))}
            />
          </div>
        ))}
      </div>
    </Modal>
  )
}

export default function Bots() {
  const toast = useToast()
  const { data: typesData } = useAsync(() => api.get<{ types: any[] }>('/bots/types'), [])
  const { data: accountsData } = useAsync(() => api.get<{ accounts: Account[] }>('/accounts'), [])
  const { data, loading, reload } = useAsync(() => api.get<{ bots: Bot[] }>('/bots'), [], { pollMs: 8000 })
  const [creating, setCreating] = useState(false)

  async function toggle(bot: Bot) {
    try {
      await api.post(`/bots/${bot.id}/${bot.status === 'running' ? 'stop' : 'start'}`)
      toast(`${bot.name} ${bot.status === 'running' ? 'stopped' : 'started'}`, 'success')
      reload()
    } catch (err: any) {
      toast(err.message, 'error')
    }
  }

  async function remove(bot: Bot) {
    if (!confirm(`Delete ${bot.name}? Open positions will keep running.`)) return
    try {
      await api.del(`/bots/${bot.id}`)
      toast(`${bot.name} deleted`, 'success')
      reload()
    } catch (err: any) {
      toast(err.message, 'error')
    }
  }

  if (loading) return <Loader />

  const bots = data?.bots || []
  const running = bots.filter((b) => b.status === 'running')
  const totalPnl = bots.reduce((s, b) => s + (b.stats?.pnl || 0), 0)

  return (
    <div>
      <div className="spread" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Trading Bots</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            {bots.length} bots · {running.length} running · total PnL <Pnl value={totalPnl} />
          </p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Create bot
        </button>
      </div>

      {bots.length === 0 ? (
        <div className="card">
          <Empty title="No bots yet" hint="Create a Grid, DCA, Signal, Market Neutral or AI bot to start automating." />
        </div>
      ) : (
        <div className="grid g3">
          {bots.map((bot) => {
            const Icon = TYPE_ICON[bot.type] || BotIcon
            return (
              <div className="card" key={bot.id}>
                <div className="spread" style={{ marginBottom: 12 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <div className="feature-icon" style={{ width: 36, height: 36, margin: 0 }}>
                      <Icon size={17} />
                    </div>
                    <div>
                      <Link to={`/app/bots/${bot.id}`} style={{ fontWeight: 700 }}>
                        {bot.name}
                      </Link>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {bot.symbol} · {bot.type.replace('_', ' ')}
                      </div>
                    </div>
                  </div>
                  <span className={`badge ${bot.status === 'running' ? 'green' : 'gray'}`}>
                    <span className={`dot ${bot.status === 'running' ? '' : 'off'}`} style={{ width: 6, height: 6 }} />
                    {bot.status}
                  </span>
                </div>

                <div className="grid g2" style={{ gap: 8, marginBottom: 12 }}>
                  <div>
                    <div className="stat-label">PnL</div>
                    <div style={{ fontWeight: 800, fontSize: 18 }}>
                      <Pnl value={bot.stats?.pnl || 0} />
                    </div>
                  </div>
                  <div>
                    <div className="stat-label">Trades</div>
                    <div className="mono" style={{ fontWeight: 800, fontSize: 18 }}>
                      {bot.stats?.trades || 0}
                    </div>
                  </div>
                </div>

                <div className="spread muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
                  <span>Win rate {bot.stats?.winRate || 0}%</span>
                  <span>{bot.stats?.openPositions || 0} open</span>
                  <span>{timeAgo(bot.createdAt)}</span>
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <button className={`btn sm ${bot.status === 'running' ? '' : 'primary'}`} style={{ flex: 1 }} onClick={() => toggle(bot)}>
                    {bot.status === 'running' ? (
                      <>
                        <Pause size={14} /> Stop
                      </>
                    ) : (
                      <>
                        <Play size={14} /> Start
                      </>
                    )}
                  </button>
                  <Link to={`/app/bots/${bot.id}`} className="btn sm">
                    Details
                  </Link>
                  <button className="btn danger sm" onClick={() => remove(bot)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {creating && typesData && accountsData && (
        <CreateBotModal
          types={typesData.types}
          accounts={accountsData.accounts}
          onClose={() => setCreating(false)}
          onCreated={reload}
        />
      )}
    </div>
  )
}
