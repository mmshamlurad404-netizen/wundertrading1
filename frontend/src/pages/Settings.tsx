import { useEffect, useState } from 'react'
import { Settings as SettingsIcon, Star, Plus, Trash2, User, KeyRound } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useAsync, useToast, Loader, Empty, CoinAvatar } from '../components/ui'
import { useLive } from '../live'
import { fmtPct, fmtPrice } from '../lib/format'

interface SystemStatus {
  llm: { enabled: boolean; model: string | null }
  smtp: { enabled: boolean }
  feed: { enabled: boolean; source: string }
}

export default function Settings() {
  const { user, refresh } = useAuth()
  const toast = useToast()
  const { list } = useLive()
  const { data, loading, reload } = useAsync(() => api.get<{ watchlist: any[] }>('/watchlist'), [])
  const { data: status } = useAsync(() => api.get<SystemStatus>('/system/status'), [])
  const [selected, setSelected] = useState('SOL/USDT')

  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [savingProfile, setSavingProfile] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    if (user) {
      setName(user.name || '')
      setEmail(user.email || '')
    }
  }, [user])

  if (loading) return <Loader />

  async function saveProfile() {
    setSavingProfile(true)
    try {
      await api.patch('/auth/profile', { name, email })
      await refresh()
      toast('Profile updated', 'success')
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  async function changePassword() {
    setSavingPassword(true)
    try {
      await api.post('/auth/password', { currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      toast('Password changed', 'success')
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setSavingPassword(false)
    }
  }

  async function add() {
    await api.post('/watchlist', { symbol: selected, action: 'add' })
    toast('Added to watchlist', 'success')
    reload()
  }
  async function remove(symbol: string) {
    await api.post('/watchlist', { symbol, action: 'remove' })
    reload()
  }

  const profileDirty = name !== (user?.name || '') || email !== (user?.email || '')
  const passwordReady = currentPassword.length > 0 && newPassword.length >= 6

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
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Email</label>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
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
          <button className="btn primary" onClick={saveProfile} disabled={savingProfile || !profileDirty}>
            {savingProfile ? 'Saving...' : 'Save profile'}
          </button>
        </div>

        <div className="card">
          <h3 className="card-title">
            <KeyRound size={14} style={{ verticalAlign: -2 }} /> Security
          </h3>
          <div className="field">
            <label>Current password</label>
            <input
              className="input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
            />
          </div>
          <div className="field">
            <label>New password</label>
            <input
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>
          <button className="btn primary" onClick={changePassword} disabled={savingPassword || !passwordReady}>
            {savingPassword ? 'Updating...' : 'Change password'}
          </button>

          <div className="list-item" style={{ marginTop: 14 }}>
            <div>
              <div style={{ fontWeight: 600 }}>LLM strategy provider</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Set NT_LLM_* environment variables to enable
              </div>
            </div>
            <span className={`badge ${status?.llm.enabled ? 'green' : 'gray'}`}>
              {status?.llm.enabled ? `Active${status.llm.model ? ` (${status.llm.model})` : ''}` : 'Disabled'}
            </span>
          </div>
          <div className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>Email alerts</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Set NT_SMTP_* environment variables to enable
              </div>
            </div>
            <span className={`badge ${status?.smtp.enabled ? 'green' : 'gray'}`}>
              {status?.smtp.enabled ? 'Active' : 'Disabled'}
            </span>
          </div>
          <div className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>Market data feed</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {status?.feed.source || 'simulator'}
              </div>
            </div>
            <span className={`badge ${status?.feed.enabled ? 'green' : 'yellow'}`}>
              {status?.feed.enabled ? 'Live' : 'Simulated'}
            </span>
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
