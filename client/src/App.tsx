import { useState, useCallback } from 'react'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import './index.css'

type Page = 'dashboard' | 'admin'

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([])

  const toast = useCallback((msg: string, type = 'success') => {
    const id = Date.now()
    setToasts((t) => [...t, { id, msg, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000)
  }, [])

  return (
    <>
      <div className="bg-gradient" />
      <div className="noise-overlay" />
      <div className="scanline" />

      <div className="app-container">
        <nav className="nav">
          <div className="nav-brand">
            <div className="nav-brand-icon">🐺</div>
            <span className="nav-brand-text">Wolfie</span>
            <span className="nav-brand-version">v1.0</span>
          </div>
          <div className="nav-links">
            <button
              className={`nav-link ${page === 'dashboard' ? 'active' : ''}`}
              onClick={() => setPage('dashboard')}
            >
              📊 Dashboard
            </button>
            <button
              className={`nav-link ${page === 'admin' ? 'active' : ''}`}
              onClick={() => setPage('admin')}
            >
              ⚙️ Admin
            </button>
          </div>
        </nav>

        <main className="main-content">
          {page === 'dashboard' && <Dashboard toast={toast} />}
          {page === 'admin' && <Admin toast={toast} />}
        </main>
      </div>

      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.type === 'success' ? '✓' : '✗'} {t.msg}
          </div>
        ))}
      </div>
    </>
  )
}
