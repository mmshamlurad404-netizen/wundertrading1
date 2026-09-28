import { useEffect, useState } from 'react'
import { Settings as SettingsIcon, Star, Plus, Trash2, User, KeyRound, ShieldCheck } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useAsync, useToast, Loader, Empty, CoinAvatar } from '../components/ui'
import { useLive } from '../live'
import { fmtPct, fmtPrice } from '../lib/format'

interface SystemStatus {
  llm: { enabled: boolean; model: string | null }
  smtp: { enabled: boolean }
  feed: { enabled: boolean; source: string }
  userStream?: { started: boolean; streams: string[] }
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

  const [twoFaSetup, setTwoFaSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null)
  const [twoFaCode, setTwoFaCode] = useState('')
  const [disablePassword, setDisablePassword] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [busy2fa, setBusy2fa] = useState(false)

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

  async function startTwoFa() {
    setBusy2fa(true)
    try {
      const res = await api.post<{ secret: string; otpauthUrl: string }>('/auth/2fa/setup', {})
      setTwoFaSetup(res)
      setTwoFaCode('')
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setBusy2fa(false)
    }
  }

  async function enableTwoFa() {
    setBusy2fa(true)
    try {
      await api.post('/auth/2fa/enable', { code: twoFaCode })
      setTwoFaSetup(null)
      setTwoFaCode('')
      await refresh()
      toast('Two-factor authentication enabled', 'success')
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setBusy2fa(false)
    }
  }

  async function disableTwoFa() {
    setBusy2fa(true)
    try {
      await api.post('/auth/2fa/disable', { password: disablePassword, code: disableCode })
      setDisablePassword('')
      setDisableCode('')
      await refresh()
      toast('Two-factor authentication disabled', 'success')
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setBusy2fa(false)
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

          <div className="divider" style={{ margin: '16px 0' }} />
          <div className="spread" style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 8, fontWeight: 600, fontSize: 13.5 }}>
              <ShieldCheck size={14} /> Two-factor authentication
            </div>
            <span className={`badge ${user?.twoFactorEnabled ? 'green' : 'gray'}`}>
              {user?.twoFactorEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>

          {user?.twoFactorEnabled ? (
            <>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                Authenticator app protection is active. Disabling requires your password and a current code.
              </p>
              <div className="field">
                <label>Password</label>
                <input
                  className="input"
                  type="password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  placeholder="Current password"
                />
              </div>
              <div className="field">
                <label>Authentication code</label>
                <input
                  className="input mono"
                  inputMode="numeric"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                />
              </div>
              <button
                className="btn danger"
                onClick={disableTwoFa}
                disabled={busy2fa || !disablePassword || disableCode.length < 6}
              >
                {busy2fa ? 'Disabling...' : 'Disable 2FA'}
              </button>
            </>
          ) : twoFaSetup ? (
            <>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                Add this secret to your authenticator app, then enter the 6-digit code it shows.
              </p>
              <div className="field">
                <label>Secret key</label>
                <input className="input mono" readOnly value={twoFaSetup.secret} onFocus={(e) => e.target.select()} />
              </div>
              <div className="field">
                <label>Authentication code</label>
                <input
                  className="input mono"
                  inputMode="numeric"
                  value={twoFaCode}
                  onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn primary" onClick={enableTwoFa} disabled={busy2fa || twoFaCode.length < 6}>
                  {busy2fa ? 'Verifying...' : 'Enable 2FA'}
                </button>
                <button className="btn" onClick={() => setTwoFaSetup(null)} disabled={busy2fa}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                Protect your account with an authenticator app (TOTP).
              </p>
              <button className="btn" onClick={startTwoFa} disabled={busy2fa}>
                {busy2fa ? 'Starting...' : 'Set up 2FA'}
              </button>
            </>
          )}

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
          <div className="list-item">
            <div>
              <div style={{ fontWeight: 600 }}>Real-time order stream</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Binance, Bybit and OKX user-data websockets
              </div>
            </div>
            <span className={`badge ${(status?.userStream?.streams?.length || 0) > 0 ? 'green' : 'gray'}`}>
              {(status?.userStream?.streams?.length || 0) > 0
                ? `${status!.userStream!.streams.length} active`
                : 'Idle'}
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
