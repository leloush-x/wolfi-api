import { useState, useEffect, useCallback } from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

interface DashboardProps {
  toast: (msg: string, type?: string) => void
}

interface DashData {
  system: {
    uptime: string
    uptimeSeconds: number
    memory: { rss: string; heapUsed: string; heapTotal: string; rssBytes: number; heapUsedBytes: number }
    bunVersion: string
    platform: string
    arch: string
  }
  session: {
    ready: boolean
    client: string
    lastPing: string | null
    latencyMs: number
    cookieStatus: boolean
    cookieInfo: { loaded: boolean; cookieCount: number; path: string }
  }
  requests: { total: number; info: number; saudio: number; rate: { perMinute: number; perHour: number } }
  latency: { avg: number; min: number; max: number; p95: number; count: number }
  cache: {
    enabled: boolean
    metadata: { total: number }
    streams: { total: number; active: number; expired: number }
    hitRatios: { metadata: { hits: number; misses: number; ratio: string }; streams: { hits: number; misses: number; ratio: string } }
  }
}

export default function Dashboard({ toast }: DashboardProps) {
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState<{ time: string; requests: number; latency: number }[]>([])
  const [memHistory, setMemHistory] = useState<{ time: string; mb: number }[]>([])

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch('/admin')
      const json = await res.json()
      setData(json)

      const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      setHistory((h) => {
        const next = [...h, { time: now, requests: json.requests?.total ?? 0, latency: json.latency?.avg ?? 0 }]
        return next.slice(-20)
      })
      setMemHistory((h) => {
        const mb = Math.round((json.system?.memory?.rssBytes ?? 0) / 1024 / 1024)
        const next = [...h, { time: now, mb }]
        return next.slice(-20)
      })
    } catch {
      toast('Failed to fetch dashboard data', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchDashboard()
    const interval = setInterval(fetchDashboard, 3000)
    return () => clearInterval(interval)
  }, [fetchDashboard])

  const latencyColor = (ms: number) => ms < 200 ? 'var(--success)' : ms < 500 ? 'var(--warning)' : 'var(--danger)'

  if (loading || !data) {
    return (
      <div className="stagger">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton" style={{ height: 120, marginBottom: 16 }} />
        ))}
      </div>
    )
  }

  return (
    <div className="stagger">
      {/* Header */}
      <div className="section-header animate-in">
        <div className="section-icon" style={{ background: 'var(--accent-glow)' }}>📊</div>
        <div>
          <div className="section-title">Dashboard</div>
          <div className="section-subtitle">Real-time system overview</div>
        </div>
      </div>

      {/* Status Row */}
      <div className="stats-grid stagger" style={{ marginBottom: 24 }}>
        <div className="stat-card animate-in" style={{ '--stat-color': 'var(--success)' } as any}>
          <div className="stat-label">Session Status</div>
          <div className="stat-value" style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`status-dot ${data.session.ready ? 'active' : 'inactive'}`} />
            {data.session.ready ? 'Active' : 'Offline'}
          </div>
          <div className="stat-sub">{data.session.client} client</div>
        </div>

        <div className="stat-card animate-in" style={{ '--stat-color': data.session.cookieStatus ? 'var(--success)' : 'var(--warning)' } as any}>
          <div className="stat-label">Cookies</div>
          <div className="stat-value" style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`status-dot ${data.session.cookieStatus ? 'active' : 'warning'}`} />
            {data.session.cookieStatus ? 'Loaded' : 'Not Found'}
          </div>
          <div className="stat-sub">{data.session.cookieInfo.cookieCount} cookies</div>
        </div>

        <div className="stat-card animate-in" style={{ '--stat-color': data.cache.enabled ? 'var(--accent)' : 'var(--text-muted)' } as any}>
          <div className="stat-label">Cache</div>
          <div className="stat-value" style={{ fontSize: 16 }}>
            {data.cache.enabled ? '🟢 Enabled' : '⚪ Disabled'}
          </div>
          <div className="stat-sub">{data.cache.metadata.total + data.cache.streams.total} items</div>
        </div>

        <div className="stat-card animate-in" style={{ '--stat-color': latencyColor(data.latency.avg) } as any}>
          <div className="stat-label">Latency</div>
          <div className="stat-value" style={{ fontSize: 28, color: latencyColor(data.latency.avg) }}>
            {data.latency.avg}ms
          </div>
          <div className="stat-sub">avg · {data.latency.count} samples</div>
        </div>
      </div>

      {/* Request Stats */}
      <div className="stats-grid stagger" style={{ marginBottom: 24 }}>
        <div className="stat-card animate-in" style={{ '--stat-color': 'var(--accent)' } as any}>
          <div className="stat-label">Total Requests</div>
          <div className="stat-value">{data.requests.total.toLocaleString()}</div>
          <div className="stat-sub">{data.requests.rate.perMinute}/min · {data.requests.rate.perHour}/hr</div>
        </div>

        <div className="stat-card animate-in" style={{ '--stat-color': 'var(--accent-2)' } as any}>
          <div className="stat-label">Info Requests</div>
          <div className="stat-value">{data.requests.info.toLocaleString()}</div>
          <div className="stat-sub">metadata lookups</div>
        </div>

        <div className="stat-card animate-in" style={{ '--stat-color': 'var(--accent-3)' } as any}>
          <div className="stat-label">Stream Requests</div>
          <div className="stat-value">{data.requests.saudio.toLocaleString()}</div>
          <div className="stat-sub">audio streams served</div>
        </div>

        <div className="stat-card animate-in" style={{ '--stat-color': 'var(--success)' } as any}>
          <div className="stat-label">Uptime</div>
          <div className="stat-value" style={{ fontSize: 22 }}>{data.system.uptime}</div>
          <div className="stat-sub">{data.system.bunVersion}</div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid-2 stagger" style={{ marginBottom: 24 }}>
        {/* Request History */}
        <div className="card animate-in">
          <div className="card-header">
            <div className="card-title">Request History</div>
            <div className="badge badge-info">{data.requests.total} total</div>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#55556a' }} />
                <YAxis tick={{ fontSize: 10, fill: '#55556a' }} />
                <Tooltip
                  contentStyle={{
                    background: '#12121a',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
                <Area type="monotone" dataKey="requests" stroke="#8b5cf6" fill="url(#reqGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Latency Chart */}
        <div className="card animate-in">
          <div className="card-header">
            <div className="card-title">Latency</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="badge badge-success">min {data.latency.min}ms</div>
              <div className="badge badge-warning">p95 {data.latency.p95}ms</div>
            </div>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#55556a' }} />
                <YAxis tick={{ fontSize: 10, fill: '#55556a' }} />
                <Tooltip
                  contentStyle={{
                    background: '#12121a',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="latency" fill="#06b6d4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Memory & Cache Row */}
      <div className="grid-2 stagger" style={{ marginBottom: 24 }}>
        {/* Memory */}
        <div className="card animate-in">
          <div className="card-header">
            <div className="card-title">Memory Usage</div>
            <div className="badge badge-info">{data.system.memory.rss}</div>
          </div>
          <div className="chart-container" style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={memHistory}>
                <defs>
                  <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#55556a' }} />
                <YAxis tick={{ fontSize: 10, fill: '#55556a' }} unit=" MB" />
                <Tooltip
                  contentStyle={{
                    background: '#12121a',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
                <Area type="monotone" dataKey="mb" stroke="#f59e0b" fill="url(#memGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cache Breakdown */}
        <div className="card animate-in">
          <div className="card-header">
            <div className="card-title">Cache Breakdown</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Metadata */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Metadata</span>
                <span className="badge badge-info">{data.cache.metadata.total}</span>
              </div>
              <div className="progress">
                <div className="progress-fill" style={{ width: `${Math.min((data.cache.metadata.total / 100) * 100, 100)}%` }} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <span className="stat-sub">Hit ratio: {data.cache.hitRatios.metadata.ratio}</span>
                <span className="stat-sub">· {data.cache.hitRatios.metadata.hits} hits</span>
              </div>
            </div>

            <div className="divider" />

            {/* Streams */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Stream URLs</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <span className="badge badge-success">{data.cache.streams.active} active</span>
                  <span className="badge badge-danger">{data.cache.streams.expired} expired</span>
                </div>
              </div>
              <div className="progress">
                <div className="progress-fill" style={{
                  width: `${data.cache.streams.total > 0 ? (data.cache.streams.active / data.cache.streams.total) * 100 : 0}%`,
                  background: 'linear-gradient(90deg, var(--success), var(--accent-2))',
                }} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <span className="stat-sub">Hit ratio: {data.cache.hitRatios.streams.ratio}</span>
                <span className="stat-sub">· {data.cache.hitRatios.streams.hits} hits</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* System Info Bar */}
      <div className="card animate-in" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">System Info</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <div className="badge badge-info">🏗️ {data.system.platform} {data.system.arch}</div>
          <div className="badge badge-info">⚡ Bun {data.system.bunVersion}</div>
          <div className="badge badge-info">💾 Heap: {data.system.memory.heapUsed} / {data.system.memory.heapTotal}</div>
          <div className="badge badge-info">🌐 Client: {data.session.client}</div>
          {data.session.lastPing && (
            <div className="badge badge-success">📡 Last ping: {new Date(data.session.lastPing).toLocaleTimeString()}</div>
          )}
        </div>
      </div>
    </div>
  )
}
