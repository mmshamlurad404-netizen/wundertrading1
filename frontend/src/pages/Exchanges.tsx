import { useState } from 'react'
import { Cable, Plus, Trash2, ShieldCheck, Link2, ExternalLink, RefreshCw, FlaskConical, Zap } from 'lucide-react'
import { api } from '../api'
import { useAsync, useToast, Modal, Loader, Empty } from '../components/ui'
import { fmtUsd, timeAgo } from '../lib/format'
import type { Account } from '../types'

interface SupportedExchange {
  id: string
  name: string
  type: string
  regions: string[]
  markets: string[]
  liveCapable: boolean
  requiresSecret: boolean
  requiresPassphrase: boolean
  futures: boolean
  verified: boolean
}

export default function Exchanges() {
  const toast = useToast()
  const { data: supData } = useAsync(() => api.get<{ exchanges: SupportedExchange[] }>('/exchanges/supported'), [])
  const { data, loading, reload } = useAsync(() => api.get<{ accounts: Account[] }>('/accounts'), [], { pollMs: 10000 })
  const [connecting, setConnecting] = useState<SupportedExchange | null>(null)
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [mode, setMode] = useState('demo')
  const [testnet, setTestnet] = useState(false)
  const [marketType, setMarketType] = useState('futures')
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState<string | null>(null)

  const isPaper = connecting?.id === 'paper'
  const liveCapable = !!connecting?.liveCapable
  const needsPassphrase = !!connecting?.requiresPassphrase
  const needsSecret = connecting?.requiresSecret !== false

  function openConnect(ex: SupportedExchange) {
    setConnecting(ex)
    setLabel('')
    setApiKey('')
    setApiSecret('')
    setPassphrase('')
    setMode(ex.id === 'paper' ? 'demo' : 'demo')
    setTestnet(false)
    setMarketType(ex.futures ? 'futures' : 'spot')
  }

  async function connect() {
    if (!connecting) return
    if (!isPaper && mode === 'live') {
      if (!apiKey) {
        toast('Live mode needs a valid API key', 'error')
        return
      }
      if (needsSecret && !apiSecret) {
        toast(`${connecting.name} live mode needs an API secret`, 'error')
        return
      }
      if (needsPassphrase && !passphrase) {
        toast(`${connecting.name} live mode needs a passphrase`, 'error')
        return
      }
    }
    setBusy(true)
    try {
      const payload: Record<string, unknown> = {
        exchange: connecting.id,
        label: label || connecting.name,
        mode: isPaper ? 'demo' : mode,
        marketType,
        testnet: isPaper ? false : testnet,
      }
      if (!isPaper) {
        payload.apiKey = apiKey
        if (apiSecret) payload.apiSecret = apiSecret
        if (passphrase) payload.passphrase = passphrase
      }
      await api.post('/accounts', payload)
      toast(
        !isPaper && mode === 'live'
          ? `${connecting.name} connected - live orders enabled`
          : `${connecting.name} connected`,
        'success'
      )
      setConnecting(null)
      reload()
    } catch (err: any) {
      toast(err.message || 'Connection failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function sync(a: Account) {
    setSyncing(a.id)
    try {
      await api.post(`/accounts/${a.id}/sync`, {})
      toast(`${a.label} synced with exchange`, 'success')
      reload()
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setSyncing(null)
    }
  }

  if (loading || !supData) return <Loader />

  const accounts = data?.accounts || []

  return (
    <div>
      <div className="spread" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">
            <Cable size={22} style={{ verticalAlign: -3 }} /> Exchanges
          </h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Connect exchange accounts or trade risk-free with the built-in paper wallet.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18, borderColor: 'rgba(22,199,132,0.3)' }}>
        <div className="row" style={{ gap: 12 }}>
          <ShieldCheck size={20} className="up" />
          <div>
            <strong>Your keys stay yours.</strong>
            <div className="muted" style={{ fontSize: 13 }}>
              API keys are stored masked and never displayed in full. In this demo environment all
              connected accounts settle against simulated balances so you can test strategies safely.
            </div>
          </div>
        </div>
      </div>

      <h3 className="card-title">Connected accounts</h3>
      <div className="grid g3" style={{ marginBottom: 24 }}>
        {accounts.map((a) => (
          <div className="card" key={a.id}>
            <div className="spread" style={{ marginBottom: 10 }}>
              <div className="row" style={{ gap: 10 }}>
                <div className="coin-avatar" style={{ width: 34, height: 34, background: 'linear-gradient(135deg,#5b8cff,#8b5bff)' }}>
                  {a.exchange.slice(0, 3).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 700 }}>{a.label}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {a.exchange} · {a.mode}
                    {a.marketType ? ` · ${a.marketType}` : ''}
                    {a.testnet ? ' · testnet' : ''}
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {a.live && <span className="badge green">live</span>}
                <span className={`badge ${a.connected ? 'green' : 'gray'}`}>{a.connected ? 'active' : 'offline'}</span>
              </div>
            </div>
            <div className="spread">
              <div>
                <div className="stat-label">Equity</div>
                <div className="mono" style={{ fontWeight: 800, fontSize: 18 }}>
                  {fmtUsd(a.equity)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="stat-label">API key</div>
                <div className="mono muted">****{a.keyLast4}</div>
              </div>
            </div>
            <div className="spread" style={{ marginTop: 12 }}>
              <span className="muted" style={{ fontSize: 11.5 }}>
                {a.live && a.syncedAt ? `Synced ${timeAgo(a.syncedAt)}` : `Linked ${timeAgo(a.createdAt)}`}
              </span>
              <div className="row" style={{ gap: 6 }}>
                {a.live && (
                  <button className="btn ghost sm" onClick={() => sync(a)} disabled={syncing === a.id}>
                    <RefreshCw size={14} className={syncing === a.id ? 'spin' : ''} /> Sync
                  </button>
                )}
                {a.exchange !== 'paper' && (
                  <button
                    className="btn danger sm"
                    onClick={async () => {
                      if (!confirm(`Disconnect ${a.label}?`)) return
                      try {
                        await api.del(`/accounts/${a.id}`)
                        toast('Account disconnected', 'success')
                        reload()
                      } catch (err: any) {
                        toast(err.message, 'error')
                      }
                    }}
                  >
                    <Trash2 size={14} /> Disconnect
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        <button
          className="card"
          style={{ borderStyle: 'dashed', display: 'grid', placeItems: 'center', minHeight: 180, color: 'inherit' }}
          onClick={() => openConnect(supData.exchanges.find((e) => e.id === 'binance') || supData.exchanges[0])}
        >
          <div style={{ textAlign: 'center' }}>
            <Plus size={22} className="muted" />
            <div style={{ marginTop: 8, fontWeight: 600 }}>Add exchange</div>
            <div className="muted" style={{ fontSize: 12 }}>
              API key connection
            </div>
          </div>
        </button>
      </div>

      <h3 className="card-title">Supported exchanges</h3>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Exchange</th>
                <th>Type</th>
                <th>Markets</th>
                <th>Region</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {supData.exchanges.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontWeight: 700 }}>
                    {e.name}
                    {e.liveCapable && (
                      <span className="badge green" style={{ marginLeft: 8 }}>
                        <Zap size={11} style={{ verticalAlign: -1 }} /> live
                      </span>
                    )}
                    {e.liveCapable && !e.verified && (
                      <span className="badge gray" style={{ marginLeft: 6 }}>
                        beta
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="badge gray">{e.type}</span>
                  </td>
                  <td className="muted">{e.markets.join(', ')}</td>
                  <td className="muted">{e.regions.join(', ')}</td>
                  <td>
                    <button className="btn ghost sm" onClick={() => openConnect(e)}>
                      <Link2 size={14} /> Connect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {connecting && (
        <Modal
          title={`Connect ${connecting.name}`}
          onClose={() => setConnecting(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConnecting(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={connect} disabled={busy}>
                {busy ? 'Connecting...' : 'Connect account'}
              </button>
            </>
          }
        >
          <div className="field">
            <label>Account label</label>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={connecting.name} />
          </div>
          {!isPaper && (
            <div className="field">
              <label>Mode</label>
              <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="demo">Demo (simulated balances)</option>
                <option value="live" disabled={!liveCapable}>
                  Live (real orders{liveCapable ? '' : ' - unsupported for this exchange'})
                </option>
              </select>
            </div>
          )}
          {!isPaper && connecting.futures && (
            <div className="field">
              <label>Market type</label>
              <select className="select" value={marketType} onChange={(e) => setMarketType(e.target.value)}>
                <option value="futures">Futures / perpetual</option>
                <option value="spot">Spot</option>
              </select>
            </div>
          )}
          {!isPaper && (
            <>
              <div className="field">
                <label>API key{needsSecret ? '' : ' / access token'}</label>
                <input className="input mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={needsSecret ? 'Paste read & trade key' : 'Paste API key or access token'} />
              </div>
              {needsSecret && (
                <div className="field">
                  <label>API secret</label>
                  <input className="input mono" type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="Paste secret" />
                </div>
              )}
            </>
          )}
          {needsPassphrase && !isPaper && (
            <div className="field">
              <label>Passphrase</label>
              <input className="input mono" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="API passphrase" />
            </div>
          )}
          {liveCapable && !isPaper && (
            <label className="row" style={{ gap: 8, marginTop: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={testnet} onChange={(e) => setTestnet(e.target.checked)} />
              <span style={{ fontSize: 13 }}>
                <FlaskConical size={13} style={{ verticalAlign: -2 }} /> Use exchange testnet / sandbox
              </span>
            </label>
          )}
          <div className="hint">
            {mode === 'live' && !isPaper
              ? 'Live mode places real orders on your exchange account using the key you provide. Credentials are validated before saving and stored encrypted.'
              : 'Leave the key blank to connect a sandbox account with a demo key. In demo mode orders are simulated.'}{' '}
            Enable trading permissions only; never enable withdrawals.{' '}
            <ExternalLink size={11} style={{ verticalAlign: -1 }} />
          </div>
        </Modal>
      )}
    </div>
  )
}
