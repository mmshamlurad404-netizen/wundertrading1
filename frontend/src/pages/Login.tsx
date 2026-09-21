import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email, password)
      navigate('/app')
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Link to="/" className="row" style={{ gap: 10, fontWeight: 800, fontSize: 18, marginBottom: 22 }}>
          <span className="brand-mark">N</span> NebulaTrade
        </Link>
        <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>Welcome back</h2>
        <p className="muted" style={{ margin: '0 0 22px', fontSize: 13.5 }}>
          Sign in to manage your bots and portfolio.
        </p>
        {error && (
          <div className="badge red" style={{ marginBottom: 14, width: '100%', justifyContent: 'center' }}>
            {error}
          </div>
        )}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              required
            />
          </div>
          <button className="btn primary block lg" disabled={busy} type="submit">
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="muted" style={{ textAlign: 'center', marginTop: 18, fontSize: 13 }}>
          No account yet? <Link to="/register" style={{ color: 'var(--accent)' }}>Create one free</Link>
        </p>
      </div>
    </div>
  )
}
