import { useState } from 'react'
import { Settings as SettingsIcon, Star, Plus, Trash2, User, ShieldCheck } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useAsync, useToast, Loader, Empty, CoinAvatar } from '../components/ui'
import { useLive } from '../live'
import { fmtPct, fmtPrice } from '../lib/format'

export default function Settings() {
  const { user } = useAuth()
  const toast = useToast()
  const { list } = useLive()
  const { data, loading, reload } = useAsync(() => api.get<{ watchlist: any[] }>('/watchlist'), [])
  const [selected, setSelected] = useState('SOL/USDT')

  if (loading) return <Loader />

  async function add() {
    await api.post('/watchlist', { symbol: selected, action: 'add' })
    toast('Added to watchlist', 'success')
    reload()
  }
  async function remove(symbol: string) {
    await api.post('/watchlist', { symbol, action: 'remove' })
    reload()
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">
          <SettingsIcon size={22} style={{ verticalAlign: -3 }} /> Settings
        </h1>
        <p className="page-sub" style={{ margin: 0 }}>
          Manage your profile, watchlist and workspace preferences.
        </p>
      </div>

      <div className="grid g2" style={{ marginBottom: 18 }}>
        <div className="card">
          <h3 className="card-title">
            <User size={14} style={{ verticalAlign: -2 }} /> Profile
          </h3>
          <div className="field">
            <label>Name</label>
            <input className="input" value={user?.name || ''} readOnly />
          </div>
          <div className="field">
            <label>Email</label>
            <input className="input" value={user?.email || ''} readOnly />
          </div>
          <div className="field">
            <label>Plan</label>
            <div className="row" style={{ gap: 8 }}>
              <span className="badge blue">{user?.plan || 'free'}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                Unlimited bots, API and webhooks enabled
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">
            <ShieldCheck size={14} style={{ verticalAlign: -2 }} /> Security
          </h3>
          <div className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>Two-factor authentication</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Add an extra layer of protection to your account
              </div>
            </div>
            <span className="badge yellow">Recommended</span>
          </div>
          <div className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>API access &amp; webhooks</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Enabled for incoming trading signals
              </div>
            </div>
            <span className="badge green">Active</span>
          </div>
          <div className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>Withdrawal permissions</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Never enabled for connected exchanges
              </div>
            </div>
            <span className="badge green">Disabled</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="spread" style={{ marginBottom: 12 }}>
          <h3 className="card-title" style={{ margin: 0 }}>
            <Star size={14} style={{ verticalAlign: -2 }} /> Watchlist
          </h3>
          <div className="row" style={{ gap: 8 }}>
            <select className="select" style={{ width: 170 }} value={selected} onChange={(e) => setSelected(e.target.value)}>
              {list.map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.symbol}
                </option>
              ))}
            </select>
            <button className="btn primary sm" onClick={add}>
              <Plus size={14} /> Add
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Market</th>
                <th className="num">Price</th>
                <th className="num">24h</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(data?.watchlist || []).map((t: any) => (
                <tr key={t.symbol}>
                  <td>
                    <div className="row" style={{ gap: 9 }}>
                      <CoinAvatar symbol={t.symbol} size={24} />
                      <span style={{ fontWeight: 600 }}>{t.symbol}</span>
                    </div>
                  </td>
                  <td className="num mono">{fmtPrice(t.price)}</td>
                  <td className={`num mono ${t.change24h >= 0 ? 'up' : 'down'}`}>{fmtPct(t.change24h)}</td>
                  <td>
                    <button className="btn danger sm" onClick={() => remove(t.symbol)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {!(data?.watchlist || []).length && (
                <tr>
                  <td colSpan={4}>
                    <Empty title="Your watchlist is empty" hint="Add a market from the selector above." />
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
