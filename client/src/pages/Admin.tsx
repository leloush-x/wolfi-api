import { Settings, Cookie, Trash2, RefreshCw, ToggleLeft, Globe, Cpu, Server, Link } from 'lucide-react';
import { useAdmin } from '../hooks/useApi';
import { Card, CardTitle, Button, Toggle, ListItem, Badge } from '../components/UI';

export default function Admin() {
  const { data, loading, refresh } = useAdmin(5000);

  const postAction = async (action: string, body?: Record<string, any>) => {
    try {
      await fetch('/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      refresh();
    } catch (e) {
      console.error(e);
    }
  };

  const toggleCache = () => postAction('toggle_cache', { enabled: !data?.cache.enabled });

  if (loading || !data) {
    return (
      <div className="page-grid g2">
        {[1, 2].map((i) => (
          <div key={i} className="ui-skeleton" style={{ height: 300, borderRadius: 'var(--radius-lg)' }} />
        ))}
      </div>
    );
  }

  const { session, cache, config, system } = data;

  return (
    <div style={{ animation: 'fadeIn 0.3s var(--ease)' }}>
      <div className="page-grid g2" style={{ marginBottom: 16 }}>
        {/* Control panel */}
        <Card>
          <CardTitle icon={<Settings size={14} />}>Control Panel</CardTitle>
          <div className="ui-list">
            <div className="ui-list-item">
              <div className="ui-list-left">
                <ToggleLeft size={13} /> Cache toggle
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Badge variant={cache.enabled ? 'success' : 'warning'} dot>
                  {cache.enabled ? 'Active' : 'Paused'}
                </Badge>
                <Toggle on={cache.enabled} onToggle={toggleCache} />
              </div>
            </div>
            <ListItem left="Cookies" right={`${session.cookieInfo.cookieCount} loaded`} icon={<Cookie size={13} />} />
            <ListItem left="Public URL" right={config.ADDRESS_URL || 'http://0.0.0.0:3000'} icon={<Globe size={13} />} />
            <ListItem left="Port" right={config.PORT || '3000'} icon={<Server size={13} />} />
            <ListItem left="Client" right={session.client} icon={<Cpu size={13} />} />
          </div>
          <div className="admin-actions">
            <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => postAction('flush_cache')}>
              Flush all cache
            </Button>
            <Button icon={<RefreshCw size={14} />} onClick={() => postAction('purge_expired')}>
              Purge expired
            </Button>
            <Button icon={<RefreshCw size={14} />} onClick={refresh}>
              Refresh status
            </Button>
          </div>
        </Card>

        {/* Cookies */}
        <Card>
          <CardTitle icon={<Cookie size={14} />}>Cookie Management</CardTitle>
          <div className="admin-actions" style={{ marginBottom: 12 }}>
            <Button icon={<Cookie size={14} />}>Upload cookies.txt</Button>
            <Button icon={<Settings size={14} />}>Paste manually</Button>
          </div>
          <div className={`admin-status ${session.cookieInfo.loaded ? 'admin-status-ok' : 'admin-status-err'}`}>
            {session.cookieInfo.loaded ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/></svg>
                {session.cookieInfo.cookieCount} cookies loaded
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/></svg>
                No cookies loaded
              </>
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--mono)' }}>
            {session.cookieInfo.path}
          </div>
        </Card>
      </div>

      {/* Env config */}
      <Card style={{ marginBottom: 16 }}>
        <CardTitle icon={<Settings size={14} />}>Environment Configuration</CardTitle>
        {Object.entries(config).map(([key, val]) => (
          <div key={key} className="config-row">
            <div className="config-key">{key}</div>
            <div className="config-val">{val}</div>
          </div>
        ))}
      </Card>

      {/* Stream URL preview */}
      <Card>
        <CardTitle icon={<Link size={14} />}>Stream URL Preview</CardTitle>
        <div className="url-box">
          {config.ADDRESS_URL || 'http://0.0.0.0:3000'}/saudio/{'{videoId}'}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
          Replace <code className="inline-code">{'{videoId}'}</code> with any YouTube video ID.
        </div>
      </Card>
    </div>
  );
}
