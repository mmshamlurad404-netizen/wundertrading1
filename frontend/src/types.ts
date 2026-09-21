export interface Candle {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface Ticker {
  symbol: string
  price: number
  change24h: number
  high24h: number
  low24h: number
  volume24h: number
  category: string
}

export interface Account {
  id: string
  exchange: string
  label: string
  mode: string
  marketType?: string
  testnet?: boolean
  live?: boolean
  liveCapable?: boolean
  keyLast4: string
  passphraseSet?: boolean
  connected: boolean
  balances: Record<string, number>
  equity: number
  syncedAt?: number | null
  createdAt: number
}

export interface Position {
  id: string
  accountId: string
  botId: string | null
  symbol: string
  side: 'long' | 'short'
  size: number
  notional: number
  margin: number
  leverage: number
  entryPrice: number
  stopLoss: number | null
  takeProfit: number | null
  trailingStop: number | null
  unrealizedPnl: number
  realizedPnl: number
  status: 'open' | 'closed'
  source: string
  openedAt: number
  closedAt?: number
  closePrice?: number
  closeReason?: string
  markPrice?: number
}

export interface Order {
  id: string
  symbol: string
  side: string
  type: string
  qty: number
  price: number
  filledPrice: number
  status: string
  source: string
  createdAt: number
}

export interface Bot {
  id: string
  accountId: string
  name: string
  type: 'grid' | 'dca' | 'signal' | 'market_neutral' | 'ai'
  symbol: string
  status: 'running' | 'stopped'
  config: Record<string, number | string>
  runtime: any
  stats: {
    pnl: number
    realizedPnl: number
    unrealizedPnl: number
    trades: number
    closedTrades: number
    winRate: number
    openPositions: number
  }
  createdAt: number
}

export interface LogEntry {
  id: string
  botId: string | null
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  createdAt: number
}

export interface Signal {
  id: string
  symbol: string
  action: string
  price: number
  source: string
  consumed: boolean
  createdAt: number
}

export interface Notification {
  id: string
  title: string
  body: string
  read: boolean
  createdAt: number
}

export interface PortfolioSummary {
  equity: number
  balances: Record<string, number>
  unrealizedPnl: number
  realizedPnl: number
  totalPnl: number
  totalPnlPct: number
  openPositions: number
  totalTrades: number
  winRate: number
}
