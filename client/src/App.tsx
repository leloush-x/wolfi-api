import { useState } from 'react';
import { LayoutDashboard, Music, Settings } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import ApiGround from './pages/ApiGround';
import Admin from './pages/Admin';
import StarCanvas from './components/StarCanvas';

const TABS = [
  { id: 'dash', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'api', label: 'API Ground', icon: Music },
  { id: 'admin', label: 'Admin', icon: Settings },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function App() {
  const [active, setActive] = useState<TabId>('dash');

  return (
    <div className="app">
      <StarCanvas />
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon brand-icon-video">
            <video src="/logo.mp4" autoPlay loop muted playsInline className="brand-video" />
          </div>
          <div>
            <span className="brand-text">Wolfie</span>
            <span className="brand-ver">v2.0</span>
          </div>
        </div>
        <nav className="nav" aria-label="Primary">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-btn ${active === id ? 'nav-btn-active' : ''}`}
              onClick={() => setActive(id)}
              aria-current={active === id ? 'page' : undefined}
            >
              <Icon size={16} aria-hidden />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {active === 'dash' && <Dashboard />}
        {active === 'api' && <ApiGround />}
        {active === 'admin' && <Admin />}
      </main>
    </div>
  );
}
