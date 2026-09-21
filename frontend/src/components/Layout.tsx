import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  CandlestickChart,
  Bot as BotIcon,
  Wallet,
  Radar,
  FlaskConical,
  Radio,
  Cable,
  Bell,
  Settings,
  LogOut,
  Menu,
  ChevronDown,
} from 'lucide-react'
import { useAuth } from '../auth'
import { useLive } from '../live'
import { api } from '../api'
import { useAsync, useInterval } from './ui'
import type { Notification } from '../types'
import { timeAgo } from '../lib/format'

const NAV = [
  { section: 'Trading', items: [
    { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/app/terminal', label: 'Trading Terminal', icon: CandlestickChart },
    { to: '/app/screener', label: 'Pump Screener', icon: Radar },
    { to: '/app/portfolio', label: 'Portfolio', icon: Wallet },
  ]},
  { section: 'Automation', items: [
    { to: '/app/bots', label: 'Trading Bots', icon: BotIcon },
    { to: '/app/signals', label: 'Signal Hub', icon: Radio },
    { to: '/app/backtest', label: 'Backtesting', icon: FlaskConical },
  ]},
  { section: 'Account', items: [
    { to: '/app/exchanges', label: 'Exchanges', icon: Cable },
    { to: '/app/settings', label: 'Settings', icon: Settings },
  ]},
]

function TickerTape() {
  const { list } = useLive()
  const items = list.slice(0, 14)
  return (
    <div className="ticker-tape">
      {items.map((t) => (
        <div key={t.symbol} className="tape-item">
          <span style={{ fontWeight: 700 }}>{t.symbol.split('/')[0]}</span>
          <span className="mono">{t.price >= 1 ? t.price.toFixed(2) : t.price.toFixed(6)}</span>
          <span className={`mono ${t.change24h >= 0 ? 'up' : 'down'}`}>
            {t.change24h >= 0 ? '+' : ''}
            {t.change24h.toFixed(2)}%
          </span>
        </div>
      ))}
      {!items.length && <span className="muted">Loading markets...</span>}
    </div>
  )
}

function Notifications() {
  const [open, setOpen] = useState(false)
  const { data, reload } = useAsync(() => api.get<{ notifications: Notification[]; unread: number }>('/notifications'))
  useInterval(reload, 15000)
  const unread = data?.unread || 0

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn ghost sm" onClick={() => setOpen((o) => !o)} style={{ position: 'relative' }}>
        <Bell size={17} />
        {unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              background: 'var(--down)',
              color: '#fff',
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 5px',
            }}
          >
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div
          className="card"
          style={{ position: 'absolute', right: 0, top: 42, width: 320, zIndex: 50, padding: 0 }}
        >
          <div className="spread" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <strong style={{ fontSize: 13 }}>Notifications</strong>
            <button
              className="btn ghost sm"
              onClick={async () => {
                await api.post('/notifications/read-all')
                reload()
              }}
            >
              Mark all read
            </button>
          </div>
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {(data?.notifications || []).length === 0 && (
              <div className="empty" style={{ padding: 24 }}>
                No notifications yet
              </div>
            )}
            {(data?.notifications || []).map((n) => (
              <div
                key={n.id}
                style={{
                  padding: '11px 14px',
                  borderBottom: '1px solid var(--border-soft)',
                  opacity: n.read ? 0.6 : 1,
                }}
              >
                <div className="spread">
                  <strong style={{ fontSize: 12.5 }}>{n.title}</strong>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {timeAgo(n.createdAt)}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                  {n.body}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const { connected } = useLive()
  const navigate = useNavigate()
  const [userOpen, setUserOpen] = useState(false)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">N</div>
          NebulaTrade
        </div>
        {NAV.map((group) => (
          <div key={group.section}>
            <div className="nav-section">{group.section}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                <item.icon size={17} />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="nav-spacer" />
        <div className="plan-card">
          <div style={{ fontWeight: 800, marginBottom: 4 }}>PRO Trial active</div>
          <div className="muted" style={{ lineHeight: 1.5 }}>
            Unlimited bots, API &amp; webhooks, priority execution.
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn ghost sm" style={{ display: 'none' }}>
            <Menu size={18} />
          </button>
          <TickerTape />
          <div className="row" style={{ gap: 10, marginLeft: 'auto' }}>
            <div className="row" style={{ gap: 6 }}>
              <span className={`dot ${connected ? '' : 'off'}`} />
              <span className="muted" style={{ fontSize: 12 }}>
                {connected ? 'Live' : 'Reconnecting'}
              </span>
            </div>
            <Notifications />
            <div style={{ position: 'relative' }}>
              <button className="btn sm" onClick={() => setUserOpen((o) => !o)}>
                <span
                  className="coin-avatar"
                  style={{ width: 22, height: 22, fontSize: 10, background: 'linear-gradient(135deg,#5b8cff,#8b5bff)' }}
                >
                  {(user?.name || 'U').slice(0, 1).toUpperCase()}
                </span>
                {user?.name}
                <ChevronDown size={14} />
              </button>
              {userOpen && (
                <div
                  className="card"
                  style={{ position: 'absolute', right: 0, top: 42, width: 210, zIndex: 50 }}
                >
                  <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                    {user?.email}
                  </div>
                  <button
                    className="btn ghost sm block"
                    onClick={() => {
                      logout()
                      navigate('/')
                    }}
                  >
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
