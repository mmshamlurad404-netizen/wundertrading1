import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react'
import { api, setTokenGetter } from './api'

export interface User {
  id: string
  email: string
  name: string
  plan: string
  createdAt: number
  twoFactorEnabled?: boolean
}

interface AuthContextValue {
  user: User | null
  token: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<{ requires2fa: boolean; pendingToken?: string }>
  submitTwoFactor: (pendingToken: string, code: string) => Promise<void>
  register: (email: string, password: string, name: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('nt_token'))
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setTokenGetter(() => token)
  }, [token])

  useEffect(() => {
    let active = true
    async function load() {
      if (!token) {
        setUser(null)
        setLoading(false)
        return
      }
      try {
        const res = await api.get<{ user: User }>('/auth/me')
        if (active) setUser(res.user)
      } catch {
        if (active) {
          setToken(null)
          localStorage.removeItem('nt_token')
          setUser(null)
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [token])

  async function login(email: string, password: string) {
    const res = await api.post<{
      token?: string
      user: User
      requires2fa?: boolean
      pendingToken?: string
    }>('/auth/login', { email, password })
    if (res.requires2fa) return { requires2fa: true, pendingToken: res.pendingToken }
    applySession(res.token!, res.user)
    return { requires2fa: false }
  }

  async function submitTwoFactor(pendingToken: string, code: string) {
    const res = await api.post<{ token: string; user: User }>('/auth/login/2fa', { pendingToken, code })
    applySession(res.token, res.user)
  }

  function applySession(nextToken: string, nextUser: User) {
    localStorage.setItem('nt_token', nextToken)
    setTokenGetter(() => nextToken)
    setToken(nextToken)
    setUser(nextUser)
  }

  async function register(email: string, password: string, name: string) {
    const res = await api.post<{ token: string; user: User }>('/auth/register', {
      email,
      password,
      name,
    })
    applySession(res.token, res.user)
  }

  function logout() {
    localStorage.removeItem('nt_token')
    setTokenGetter(() => null)
    setToken(null)
    setUser(null)
  }

  async function refresh() {
    if (!token) return
    const res = await api.get<{ user: User }>('/auth/me')
    setUser(res.user)
  }

  const value = useMemo(
    () => ({ user, token, loading, login, submitTwoFactor, register, logout, refresh }),
    [user, token, loading]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
