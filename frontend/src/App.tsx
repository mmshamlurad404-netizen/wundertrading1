import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import Layout from './components/Layout'
import { Loader } from './components/ui'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Terminal from './pages/Terminal'
import Bots from './pages/Bots'
import BotDetail from './pages/BotDetail'
import Portfolio from './pages/Portfolio'
import Screener from './pages/Screener'
import Backtest from './pages/Backtest'
import Exchanges from './pages/Exchanges'
import Signals from './pages/Signals'
import Settings from './pages/Settings'

function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth()
  if (loading) return <Loader label="Loading your workspace" />
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/app"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="terminal" element={<Terminal />} />
        <Route path="bots" element={<Bots />} />
        <Route path="bots/:id" element={<BotDetail />} />
        <Route path="portfolio" element={<Portfolio />} />
        <Route path="screener" element={<Screener />} />
        <Route path="backtest" element={<Backtest />} />
        <Route path="exchanges" element={<Exchanges />} />
        <Route path="signals" element={<Signals />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
