import { useState, useEffect, useCallback, useRef } from 'react'

interface AdminProps {
  toast: (msg: string, type?: string) => void
}

interface Config {
  ADDRESS_URL?: string
  PORT?: string
  HOST?: string
  [key: string]: string | undefined
}

export default function Admin({ toast }: AdminProps) {
  const [config, setConfig] = useState<Config>({})
  const [cacheEnabled, setCacheEnabled] = useState(true)
  const [cookieInfo, setCookieInfo] = useState<{ loaded: boolean; cookieCount: number; path: string }>({ loaded: false, cookieCount: 0, path: '' })

  const [configDraft, setConfigDraft] = useState<Config>({})
  const [cookieContent, setCookieContent] = useState('')
  const [showCookieModal, setShowCookieModal] = useState(false)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [flushing, setFlushing] = useState(false)
  const [purging, setPurging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/admin')
      const data = await res.json()
      setConfig(data.config || {})
      setCacheEnabled(data.cache?.enabled ?? true)
      setCookieInfo(data.session?.cookieInfo || { loaded: false, cookieCount: 0, path: '' })
    } catch {
      toast('Failed to load config', 'error')
    }
  }, [toast])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  const toggleCache = async () => {
    const newVal = !cacheEnabled
    try {
      const res = await fetch('/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_cache', enabled: newVal }),
      })
      if (res.ok) {
        setCacheEnabled(newVal)
        toast(`Cache ${newVal ? 'enabled' : 'disabled'}`)
      }
    } catch { toast('Failed to toggle cache', 'error') }
  }

  const flushCache = async () => {
    setFlushing(true)
    try {
      const res = await fetch('/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'flush_cache' }),
      })
      if (res.ok) {
        toast('Cache flushed successfully')
        fetchConfig()
      }
    } catch { toast('Failed to flush cache', 'error') }
    finally { setFlushing(false) }
  }

  const purgeExpired = async () => {
    setPurging(true)
    try {
      const res = await fetch('/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'purge_expired' }),
      })
      const data = await res.json()
      if (data.ok) toast(`Purged ${data.purged} expired entries`)
    } catch { toast('Failed to purge', 'error') }
    finally { setPurging(false) }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setCookieContent(ev.target?.result as string)
      setShowCookieModal(true)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const uploadCookies = async () => {
    try {
      const res = await fetch('/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upload_cookies', content: cookieContent }),
      })
      const data = await res.json()
      if (data.ok) {
        setCookieInfo(data.cookieInfo)
        setShowCookieModal(false)
        setCookieContent('')
        toast('Cookies uploaded successfully')
      }
    } catch { toast('Failed to upload cookies', 'error') }
  }

  const openConfigEditor = () => {
    setConfigDraft({ ...config })
    setShowConfigModal(true)
  }

  const saveConfig = async () => {
    try {
      const res = await fetch('/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_env', config: configDraft }),
      })
      const data = await res.json()
      if (data.ok) {
        setConfig(data.config)
        setShowConfigModal(false)
        toast('Config saved successfully')
      }
    } catch { toast('Failed to save config', 'error') }
  }

  const streamUrl = (videoId: string) => {
    const addr = config.ADDRESS_URL
    if (addr && addr !== 'localhost' && addr !== '0.0.0.0') {
      return `${addr.replace(/\/$/, '')}/saudio/${videoId}`
    }
    return `/saudio/${videoId}`
  }

  return (
    <div className="stagger">
      {/* Header */}
      <div className="section-header animate-in">
        <div className="section-icon" style={{ background: 'rgba(139, 92, 246, 0.15)' }}>⚙️</div>
        <div>
          <div className="section-title">Admin Control Panel</div>
          <div className="section-subtitle">Manage Wolfie configuration and cache</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="stats-grid stagger" style={{ marginBottom: 24 }}>
        <div className="stat-card animate-in" style={{ '--stat-color': 'var(--accent)' } as any}>
          <div className="stat-label">Cache Toggle</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <span style={{ fontSize: 14, color: cacheEnabled ? 'var(--success)' : 'var(--text-muted)' }}>
              {cacheEnabled ? '🟢 Active' : '⚪ Disabled'}
            </span>
            <label className="toggle">
              <input type="checkbox" checked={cacheEnabled} onChange={toggleCache} />
              <span className="toggle-slider" />
            </label>
          </div>
          <div className="stat-sub" style={{ marginTop: 8 }}>
            {cacheEnabled ? 'Caching metadata & stream URLs' : 'Bypassing all cache'}
          </div>
        </div>

        <div className="stat-card animate-in" style={{ '--stat-color': cookieInfo.loaded ? 'var(--success)' : 'var(--warning)' } as any}>
          <div className="stat-label">Cookies Status</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span className={`status-dot ${cookieInfo.loaded ? 'active' : 'warning'}`} />
            <span style={{ fontSize: 14 }}>{cookieInfo.loaded ? 'Active' : 'Not loaded'}</span>
          </div>
          <div className="stat-sub" style={{ marginTop: 8 }}>{cookieInfo.cookieCount} cookies · MWEB</div>
        </div>

        <div className="stat-card animate-in" style={{ '--stat-color': 'var(--accent-3)' } as any}>
          <div className="stat-label">Public URL</div>
          <div style={{ fontSize: 14, marginTop: 8, wordBreak: 'break-all', fontFamily: 'JetBrains Mono, monospace', color: config.ADDRESS_URL ? 'var(--accent-2)' : 'var(--text-muted)' }}>
            {config.ADDRESS_URL || 'Not configured'}
          </div>
          <div className="stat-sub" style={{ marginTop: 8 }}>Used in stream proxy URLs</div>
        </div>

        <div className="stat-card animate-in" style={{ '--stat-color': 'var(--accent-2)' } as any}>
          <div className="stat-label">Port</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>
            {config.PORT || '3000'}
          </div>
          <div className="stat-sub" style={{ marginTop: 8 }}>Server listen port</div>
        </div>
      </div>

      {/* Actions Grid */}
      <div className="grid-2 stagger" style={{ marginBottom: 24 }}>
        {/* Cache Management */}
        <div className="card animate-in">
          <div className="card-header">
            <div className="card-title">🗄️ Cache Management</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button className="btn btn-danger" onClick={flushCache} disabled={flushing} style={{ width: '100%', justifyContent: 'center' }}>
              {flushing ? '⏳ Flushing...' : '🗑️ Delete All Cache Items'}
            </button>
            <button className="btn btn-ghost" onClick={purgeExpired} disabled={purging} style={{ width: '100%', justifyContent: 'center' }}>
              {purging ? '⏳ Purging...' : '🧹 Purge Expired Entries'}
            </button>
            <button className="btn btn-ghost" onClick={fetchConfig} style={{ width: '100%', justifyContent: 'center' }}>
              🔄 Refresh Status
            </button>
          </div>
        </div>

        {/* Cookie Management */}
        <div className="card animate-in">
          <div className="card-header">
            <div className="card-title">🍪 Cookie Management</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.cookie,.cookies"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
            <button
              className="btn btn-primary"
              onClick={() => fileInputRef.current?.click()}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              📁 Upload cookies.txt
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => { setCookieContent(''); setShowCookieModal(true) }}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              ✏️ Paste Cookies Manually
            </button>
            <div style={{
              padding: '12px',
              background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Current Status</div>
              <div style={{ fontSize: 13 }}>
                {cookieInfo.loaded ? (
                  <span style={{ color: 'var(--success)' }}>✓ {cookieInfo.cookieCount} cookies loaded</span>
                ) : (
                  <span style={{ color: 'var(--warning)' }}>⚠ No cookies.txt found</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>
                {cookieInfo.path}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Config Section */}
      <div className="card animate-in" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">🔧 Environment Configuration</div>
          <button className="btn btn-primary btn-sm" onClick={openConfigEditor}>
            ✏️ Edit Config
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {Object.entries(config).length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No configuration found. Create a .env file in the project root.</div>
          ) : (
            Object.entries(config).map(([key, val]) => (
              <div key={key} style={{
                padding: '10px 14px',
                background: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                minWidth: 200,
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                  {key}
                </div>
                <div style={{ fontSize: 14, fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all', color: 'var(--accent-2)' }}>
                  {val || '(empty)'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Stream URL Preview */}
      <div className="card animate-in" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">🔗 Stream URL Preview</div>
        </div>
        <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Example stream URL format:</div>
          <code style={{ fontSize: 13, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-2)', wordBreak: 'break-all' }}>
            {streamUrl('dQw4w9WgXcQ')}
          </code>
        </div>
      </div>

      {/* Cookie Upload Modal */}
      {showCookieModal && (
        <div className="modal-overlay" onClick={() => setShowCookieModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">🍪 Upload cookies.txt</div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Paste your Netscape-format cookies.txt content below. This file is used for MWEB session authentication.
            </p>
            <textarea
              className="textarea"
              value={cookieContent}
              onChange={(e) => setCookieContent(e.target.value)}
              placeholder="# Netscape HTTP Cookie File&#10;.youtube.com	TRUE	/	FALSE	0	SID	..."
              style={{ minHeight: 200 }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowCookieModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={uploadCookies} disabled={!cookieContent.trim()}>
                Upload & Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Config Editor Modal */}
      {showConfigModal && (
        <div className="modal-overlay" onClick={() => setShowConfigModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">🔧 Edit Environment Config</div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Edit your .env configuration. Changes take effect on next server restart.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                  ADDRESS_URL (Public URL for stream proxy)
                </label>
                <input
                  className="input"
                  value={configDraft.ADDRESS_URL || ''}
                  onChange={(e) => setConfigDraft((c) => ({ ...c, ADDRESS_URL: e.target.value }))}
                  placeholder="https://yourdomain.com"
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                  PORT
                </label>
                <input
                  className="input"
                  value={configDraft.PORT || ''}
                  onChange={(e) => setConfigDraft((c) => ({ ...c, PORT: e.target.value }))}
                  placeholder="3000"
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                  HOST
                </label>
                <input
                  className="input"
                  value={configDraft.HOST || ''}
                  onChange={(e) => setConfigDraft((c) => ({ ...c, HOST: e.target.value }))}
                  placeholder="0.0.0.0"
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowConfigModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveConfig}>Save Config</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
