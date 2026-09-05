import { useState, useRef } from 'react';
import { Settings, Cookie, Trash2, RefreshCw, ToggleLeft, Globe, Cpu, Server, Link, Upload, FileText, Save, Plus, X, Pencil, KeyRound, ShieldCheck, ShieldAlert, Copy, Check, Flame, TriangleAlert } from 'lucide-react';
import { useAdmin, isAuthError } from '../hooks/useApi';
import { useCopy } from '../hooks/useCopy';
import { getToken, setToken, authHeaders } from '../utils/auth';
import { Card, CardTitle, Button, Toggle, ListItem, Badge, Input, ErrorState } from '../components/UI';
import PackageManager from '../components/PackageManager';

export default function Admin() {
  const { data, loading, error, refresh } = useAdmin(5000);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState(getToken());
  const fileRef = useRef<HTMLInputElement>(null);
  const { copied, copy } = useCopy();

  // Env config editing
  const [editingEnv, setEditingEnv] = useState(false);
  const [envDraft, setEnvDraft] = useState<Record<string, string>>({});
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvVal, setNewEnvVal] = useState('');
  const [saving, setSaving] = useState(false);

  const postAction = async (action: string, body?: Record<string, any>) => {
    setActionError(null);
    try {
      const res = await fetch('/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action, ...body }),
      });
      if (res.status === 401) {
        setActionError('Unauthorized — enter the admin token below.');
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setActionError(`Action failed (${res.status}): ${text.slice(0, 160)}`);
        return;
      }
      refresh();
    } catch (e) {
      console.error(e);
      setActionError('Network error — is the server running?');
    }
  };

  const saveToken = () => {
    setToken(tokenDraft.trim());
    setActionError(null);
    refresh();
  };

  const clearToken = () => {
    setTokenDraft('');
    setToken('');
    refresh();
  };

  const toggleCache = () => postAction('toggle_cache', { enabled: !data?.cache.enabled });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const content = await file.text();
      await postAction('upload_cookies', { content });
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handlePasteSubmit = async () => {
    if (!pasteContent.trim()) return;
    setUploading(true);
    try {
      await postAction('upload_cookies', { content: pasteContent });
      setPasteContent('');
      setShowPaste(false);
    } catch (err) {
      console.error('Paste submit failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const startEditEnv = () => {
    setEnvDraft({ ...data!.config });
    setEditingEnv(true);
    setNewEnvKey('');
    setNewEnvVal('');
  };

  const updateEnvDraft = (key: string, val: string) => {
    setEnvDraft((prev) => ({ ...prev, [key]: val }));
  };

  const removeEnvDraft = (key: string) => {
    setEnvDraft((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const addEnvDraft = () => {
    if (!newEnvKey.trim()) return;
    setEnvDraft((prev) => ({ ...prev, [newEnvKey.trim()]: newEnvVal }));
    setNewEnvKey('');
    setNewEnvVal('');
  };

  const saveEnv = async () => {
    setSaving(true);
    try {
      await postAction('update_env', { config: envDraft });
      setEditingEnv(false);
    } catch (err) {
      console.error('Save env failed:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !data) {
    // Error with no data (e.g. 401 locked, server down) → error card with
    // inline unlock, NEVER an endless skeleton. This was the stuck bug.
    if (!loading && !data) {
      const locked = isAuthError(error);
      return (
        <div className="anim-fade" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ErrorState
            title="Couldn't load admin status"
            message={error ?? 'Unknown error'}
            action={
              <Button icon={<RefreshCw size={14} />} onClick={refresh}>
                Retry
              </Button>
            }
          />
          {locked && (
            <Card>
              <CardTitle icon={<KeyRound size={14} />}>Unlock with admin token</CardTitle>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <Input
                    icon={<KeyRound size={14} />}
                    type="password"
                    value={tokenDraft}
                    onChange={(e) => setTokenDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveToken()}
                    placeholder="Enter admin token…"
                  />
                </div>
                <Button variant="primary" icon={<Save size={14} />} onClick={saveToken} disabled={!tokenDraft.trim()}>
                  Unlock
                </Button>
              </div>
            </Card>
          )}
        </div>
      );
    }
    return (
      <div className="page-grid g2">
        {[1, 2].map((i) => (
          <div key={i} className="ui-skeleton" style={{ height: 300, borderRadius: 'var(--radius-lg)' }} />
        ))}
      </div>
    );
  }

  const { session, cache, config } = data;
  const warmed = session.warmed ?? session.ready;
  const yt = session.ytConcurrency;
  const previewUrl = `${config.ADDRESS_URL || 'http://0.0.0.0:3000'}/saudio/{videoId}`;

  return (
    <div className="anim-fade">
      {(actionError || error) && (
        <Card style={{ marginBottom: 16, borderColor: 'var(--danger)' }}>
          <div className="alert-row">
            <TriangleAlert size={15} />
            <span>{actionError ?? `Status poll failed: ${error}`}</span>
          </div>
        </Card>
      )}
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
            <ListItem left="Session" right={warmed ? 'Warmed' : 'Warming…'} icon={<Flame size={13} />} />
            <ListItem left="YT pool" right={yt ? `${yt.active}/${yt.max} · ${yt.queued} queued` : '—'} icon={<Cpu size={13} />} />
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
            <input ref={fileRef} type="file" accept=".txt,.cookie" style={{ display: 'none' }} onChange={handleFileUpload} />
            <Button icon={<Upload size={14} />} onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading...' : 'Upload cookies.txt'}
            </Button>
            <Button icon={<FileText size={14} />} onClick={() => setShowPaste(!showPaste)}>
              {showPaste ? 'Cancel' : 'Paste manually'}
            </Button>
          </div>
          {showPaste && (
            <div style={{ marginBottom: 12 }}>
              <textarea
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
                placeholder={`Paste Netscape cookie format here...\n\n# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSAPISID\tYourValueHere`}
                style={{
                  width: '100%', minHeight: 120, padding: 10, borderRadius: 'var(--radius)',
                  background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)',
                  fontFamily: 'var(--mono)', fontSize: 11, resize: 'vertical', boxSizing: 'border-box',
                }}
              />
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <Button variant="primary" icon={<Upload size={14} />} onClick={handlePasteSubmit} disabled={uploading || !pasteContent.trim()}>
                  {uploading ? 'Saving...' : 'Save cookies'}
                </Button>
                <Button onClick={() => { setShowPaste(false); setPasteContent(''); }}>Cancel</Button>
              </div>
            </div>
          )}
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

      {/* Security */}
      <Card style={{ marginBottom: 16 }}>
        <CardTitle icon={<KeyRound size={14} />}>Security</CardTitle>
        <div className="ui-list" style={{ marginBottom: 12 }}>
          <ListItem
            left="Admin API"
            right={
              data.auth === 'locked'
                ? <Badge variant="accent" dot><ShieldCheck size={11} /> Locked</Badge>
                : <Badge variant="warning" dot><ShieldAlert size={11} /> Open</Badge>
            }
            icon={<ShieldCheck size={13} />}
          />
        </div>
        {data.auth === 'locked' ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Input
                icon={<KeyRound size={14} />}
                type="password"
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveToken()}
                placeholder="Enter admin token…"
              />
            </div>
            <Button variant="primary" icon={<Save size={14} />} onClick={saveToken} disabled={!tokenDraft.trim()}>
              Save
            </Button>
            {getToken() && (
              <Button icon={<X size={14} />} onClick={clearToken}>Clear</Button>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            No <code className="inline-code">ADMIN_TOKEN</code> set — admin actions are open.
            Set one in the server environment to lock this panel.
          </div>
        )}
      </Card>

      {/* Package Manager */}
      <PackageManager />

      {/* Env config */}
      <Card style={{ marginBottom: 16 }}>
        <div className="env-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <CardTitle icon={<Settings size={14} />} style={{ marginBottom: 0 }}>Environment Configuration</CardTitle>
          {editingEnv ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" icon={<Save size={14} />} onClick={saveEnv} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <Button icon={<X size={14} />} onClick={() => setEditingEnv(false)}>Cancel</Button>
            </div>
          ) : (
            <Button icon={<Pencil size={14} />} onClick={startEditEnv}>Edit</Button>
          )}
        </div>

        {editingEnv ? (
          <div>
            {Object.entries(envDraft).map(([key, val]) => (
              <div key={key} className="env-edit-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <input
                  value={key} readOnly
                  style={{
                    width: 160, padding: '6px 10px', borderRadius: 'var(--radius)',
                    background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                    border: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 12,
                  }}
                />
                <input
                  value={val}
                  onChange={(e) => updateEnvDraft(key, e.target.value)}
                  style={{
                    flex: 1, padding: '6px 10px', borderRadius: 'var(--radius)',
                    background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                    border: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 12,
                  }}
                />
                <button
                  onClick={() => removeEnvDraft(key)}
                  style={{
                    background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer',
                    padding: 4, display: 'flex', alignItems: 'center',
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <div className="env-edit-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <input
                value={newEnvKey} onChange={(e) => setNewEnvKey(e.target.value)}
                placeholder="KEY"
                onKeyDown={(e) => e.key === 'Enter' && addEnvDraft()}
                style={{
                  width: 160, padding: '6px 10px', borderRadius: 'var(--radius)',
                  background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 12,
                }}
              />
              <input
                value={newEnvVal} onChange={(e) => setNewEnvVal(e.target.value)}
                placeholder="value"
                onKeyDown={(e) => e.key === 'Enter' && addEnvDraft()}
                style={{
                  flex: 1, padding: '6px 10px', borderRadius: 'var(--radius)',
                  background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 12,
                }}
              />
              <Button icon={<Plus size={14} />} onClick={addEnvDraft} disabled={!newEnvKey.trim()}>Add</Button>
            </div>
          </div>
        ) : (
          Object.entries(config).length > 0 ? (
            Object.entries(config).map(([key, val]) => (
              <div key={key} className="config-row">
                <div className="config-key">{key}</div>
                <div className="config-val">{val}</div>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No environment variables configured.</div>
          )
        )}
      </Card>

      {/* Stream URL preview */}
      <Card>
        <CardTitle icon={<Link size={14} />}>Stream URL Preview</CardTitle>
        <div className="url-box row-value">
          <span className="truncate">{previewUrl}</span>
          <button className="icon-btn" onClick={() => copy(previewUrl)} aria-label="Copy stream URL template" title="Copy">
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
          Replace <code className="inline-code">{'{videoId}'}</code> with any YouTube video ID.
        </div>
      </Card>
    </div>
  );
}
