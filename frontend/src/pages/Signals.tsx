import { useState } from 'react'
import { Radio, Copy, Send, Webhook, Check } from 'lucide-react'
import { api } from '../api'
import { useAsync, useToast, Loader, Empty } from '../components/ui'
import { timeAgo, fmtPrice } from '../lib/format'
import type { Bot, Signal } from '../types'

export default function Signals() {
  const toast = useToast()
  const { data: tokenData } = useAsync(
    () => api.get<{ token: string; exampleUrl: string; body: any }>('/signals/webhook-token'),
    []
  )
  const { data, loading, reload } = useAsync(() => api.get<{ signals: Signal[] }>('/signals'), [])
  const { data: botsData } = useAsync(() => api.get<{ bots: Bot[] }>('/bots'), [])
  const [copied, setCopied] = useState<string | null>(null)

  const [symbol, setSymbol] = useState('BTC/USDT')
  const [action, setAction] = useState('buy')
  const [price, setPrice] = useState('')
  const [botId, setBotId] = useState('')

  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  async function dispatch() {
    const signalBots = (botsData?.bots || []).filter((b) => b.type === 'signal')
    const target = botId || signalBots[0]?.id
    if (!target) {
      toast('Create a Signal Bot first', 'error')
      return
    }
    try {
      await api.post(`/bots/${target}/signal`, {
        action,
        symbol,
        price: price ? Number(price) : undefined,
      })
      toast('Signal dispatched to bot', 'success')
      setTimeout(reload, 700)
    } catch (err: any) {
      toast(err.message, 'error')
    }
  }

  const webhookUrl = tokenData
    ? `${location.origin}/api/signals/webhook?token=${tokenData.token}`
    : ''

  const signalBots = (botsData?.bots || []).filter((b) => b.type === 'signal')

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">
          <Radio size={22} style={{ verticalAlign: -3 }} /> Signal Hub
        </h1>
        <p className="page-sub" style={{ margin: 0 }}>
          Connect TradingView-style webhooks or dispatch manual signals to your signal bots.
        </p>
      </div>

      <div className="grid g2" style={{ marginBottom: 18 }}>
        <div className="card">
          <h3 className="card-title">
            <Webhook size={14} style={{ verticalAlign: -2 }} /> Webhook endpoint
          </h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            POST a JSON payload to this URL from TradingView, a custom script or any automation tool.
          </p>
          {tokenData ? (
            <>
              <div className="row" style={{ gap: 8, marginBottom: 12 }}>
                <input className="input mono" readOnly value={webhookUrl} style={{ fontSize: 12 }} />
                <button className="btn sm" onClick={() => copy(webhookUrl, 'url')}>
                  {copied === 'url' ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <div className="card" style={{ background: 'var(--bg-soft)', padding: 12 }}>
                <div className="stat-label">Example JSON body</div>
                <pre className="mono" style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
{`{
  "symbol": "BTCUSDT",
  "action": "buy",
  "price": 94250,
  "size_multiplier": 1
}`}
                </pre>
                <button
                  className="btn sm"
                  style={{ marginTop: 10 }}
                  onClick={() =>
                    copy(
                      JSON.stringify(
                        { symbol: 'BTCUSDT', action: 'buy', price: 94250, size_multiplier: 1 },
                        null,
                        2
                      ),
                      'body'
                    )
                  }
                >
                  {copied === 'body' ? <Check size={14} /> : <Copy size={14} />} Copy payload
                </button>
              </div>
            </>
          ) : (
            <Loader />
          )}
        </div>

        <div className="card">
          <h3 className="card-title">
            <Send size={14} style={{ verticalAlign: -2 }} /> Dispatch a test signal
          </h3>
          <div className="field">
            <label>Target signal bot</label>
            <select className="select" value={botId} onChange={(e) => setBotId(e.target.value)}>
              {signalBots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.symbol})
                </option>
              ))}
              {!signalBots.length && <option value="">No signal bots available</option>}
            </select>
          </div>
          <div className="grid g2" style={{ gap: 10 }}>
            <div className="field">
              <label>Action</label>
              <select className="select" value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="buy">Buy / Long</option>
                <option value="sell">Sell / Short</option>
                <option value="close">Close</option>
              </select>
            </div>
            <div className="field">
              <label>Market</label>
              <input className="input" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Price (optional, defaults to market)</label>
            <input className="input mono" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Market price" />
          </div>
          <button className="btn primary block" onClick={dispatch}>
            <Send size={15} /> Dispatch signal
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="panel-head">
          <strong>Signal history</strong>
          <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={reload}>
            Refresh
          </button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Time</th>
                <th>Market</th>
                <th>Action</th>
                <th className="num">Price</th>
                <th>Source</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(data?.signals || []).map((s) => (
                <tr key={s.id}>
                  <td className="muted">{timeAgo(s.createdAt)}</td>
                  <td style={{ fontWeight: 600 }}>{s.symbol}</td>
                  <td>
                    <span className={`badge ${s.action === 'buy' || s.action === 'long' ? 'green' : s.action === 'close' ? 'gray' : 'red'}`}>
                      {s.action}
                    </span>
                  </td>
                  <td className="num mono">{fmtPrice(s.price)}</td>
                  <td className="muted">{s.source}</td>
                  <td>
                    <span className={`badge ${s.consumed ? 'blue' : 'yellow'}`}>
                      {s.consumed ? 'executed' : 'pending'}
                    </span>
                  </td>
                </tr>
              ))}
              {!(data?.signals || []).length && (
                <tr>
                  <td colSpan={6}>
                    <Empty title="No signals yet" hint="Send a webhook or dispatch a test signal above." />
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
