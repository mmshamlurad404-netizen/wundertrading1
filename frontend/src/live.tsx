import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { wsUrl } from './api'
import { api } from './api'

export interface Ticker {
  symbol: string
  price: number
  change24h: number
  high24h?: number
  low24h?: number
  volume24h?: number
  category?: string
}

interface LiveContextValue {
  tickers: Record<string, Ticker>
  list: Ticker[]
  connected: boolean
  priceOf: (symbol: string) => number | null
}

const LiveContext = createContext<LiveContextValue | null>(null)

export function LiveProvider({ children }: { children: ReactNode }) {
  const [tickers, setTickers] = useState<Record<string, Ticker>>({})
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<number>(0)

  useEffect(() => {
    let closed = false

    api
      .get<{ pairs: Ticker[] }>('/market/pairs')
      .then((res) => {
        const map: Record<string, Ticker> = {}
        for (const t of res.pairs) map[t.symbol] = t
        setTickers(map)
      })
      .catch(() => {})

    function connect() {
      try {
        const ws = new WebSocket(wsUrl('/ws'))
        wsRef.current = ws
        ws.onopen = () => {
          setConnected(true)
          retryRef.current = 0
        }
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data)
            if (msg.type === 'snapshot' || msg.type === 'tickers') {
              const map: Record<string, Ticker> = {}
              for (const t of msg.data as Ticker[]) map[t.symbol] = t
              setTickers(map)
            }
          } catch {
            /* ignore */
          }
        }
        ws.onclose = () => {
          setConnected(false)
          if (!closed) {
            const delay = Math.min(8000, 1000 * 2 ** retryRef.current)
            retryRef.current += 1
            setTimeout(connect, delay)
          }
        }
        ws.onerror = () => ws.close()
      } catch {
        setConnected(false)
      }
    }

    connect()
    return () => {
      closed = true
      wsRef.current?.close()
    }
  }, [])

  const list = Object.values(tickers)

  return (
    <LiveContext.Provider
      value={{
        tickers,
        list,
        connected,
        priceOf: (symbol: string) => tickers[symbol]?.price ?? null,
      }}
    >
      {children}
    </LiveContext.Provider>
  )
}

export function useLive() {
  const ctx = useContext(LiveContext)
  if (!ctx) throw new Error('useLive must be used within LiveProvider')
  return ctx
}
