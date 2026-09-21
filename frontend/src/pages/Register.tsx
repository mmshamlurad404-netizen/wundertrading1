import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { api } from '../api'

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await register(email, password, name)
      // seed a demo workspace on first login so the dashboard is not empty
      try {
        await api.post('/demo/seed')
      } catch {
        /* ignore */
      }
      navigate('/app')
    } catch (err: any) {
      setError(err.message || 'Registration failed')
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
        <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>Create your account</h2>
        <p className="muted" style={{ margin: '0 0 22px', fontSize: 13.5 }}>
          Includes a 100,000 USDT paper wallet and starter bots.
        </p>
        {error && (
          <div className="badge red" style={{ marginBottom: 14, width: '100%', justifyContent: 'center' }}>
            {error}
          </div>
        )}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Trader"
              required
            />
          </div>
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
              placeholder="At least 6 characters"
              minLength={6}
              required
            />
          </div>
          <button className="btn primary block lg" disabled={busy} type="submit">
            {busy ? 'Creating account...' : 'Create account'}
          </button>
        </form>
        <p className="muted" style={{ textAlign: 'center', marginTop: 18, fontSize: 13 }}>
          Already registered? <Link to="/login" style={{ color: 'var(--accent)' }}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}
