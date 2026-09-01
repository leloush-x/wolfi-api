import { useState, useEffect, useRef, useCallback } from 'react';
import { Package, Search, RefreshCw, ArrowUpCircle, Loader2, ChevronDown, AlertCircle, Check, X } from 'lucide-react';
import { Card, CardTitle, Button, Input, Badge } from '../components/UI';

interface PkgInfo {
  name: string;
  current: string;
  latest: string;
  isOutdated: boolean;
  isDev: boolean;
}

export default function PackageManager() {
  const [packages, setPackages] = useState<PkgInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [expandedPkg, setExpandedPkg] = useState<string | null>(null);
  const longPressTimer = useRef<Timer | null>(null);
  const longPressTriggered = useRef(false);

  const fetchPackages = async () => {
    setLoading(true);
    try {
      const res = await fetch('/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_packages' }),
      });
      const data = await res.json();
      if (data.ok) setPackages(data.packages);
    } catch (e) {
      console.error('Failed to fetch packages:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPackages(); }, []);

  const updatePackage = async (pkgName: string) => {
    setUpdating(pkgName);
    try {
      await fetch('/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_packages', packages: [pkgName] }),
      });
      await fetchPackages();
    } catch (e) {
      console.error('Update failed:', e);
    } finally {
      setUpdating(null);
      setExpandedPkg(null);
    }
  };

  const updateAll = async () => {
    setUpdating('all');
    try {
      await fetch('/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_packages' }),
      });
      await fetchPackages();
    } catch (e) {
      console.error('Update all failed:', e);
    } finally {
      setUpdating(null);
    }
  };

  const filtered = packages.filter((p) =>
    !filter || p.name.toLowerCase().includes(filter.toLowerCase())
  );

  const outdated = packages.filter((p) => p.isOutdated);

  // Long press handlers
  const onPointerDown = useCallback((pkg: PkgInfo) => {
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setExpandedPkg(pkg.name);
    }, 500);
  }, []);

  const onPointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const onClick = useCallback((pkg: PkgInfo) => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    setExpandedPkg(expandedPkg === pkg.name ? null : pkg.name);
  }, [expandedPkg]);

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CardTitle icon={<Package size={14} />} style={{ marginBottom: 0 }}>Packages</CardTitle>
          <Badge variant={outdated.length > 0 ? 'warning' : 'success'} dot>
            {outdated.length > 0 ? `${outdated.length} outdated` : 'All updated'}
          </Badge>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button icon={<RefreshCw size={14} />} onClick={() => fetchPackages()} disabled={loading}>
            Refresh
          </Button>
          {outdated.length > 0 && (
            <Button
              variant="primary"
              icon={updating === 'all' ? <Loader2 size={14} className="spin" /> : <ArrowUpCircle size={14} />}
              onClick={updateAll}
              disabled={!!updating}
            >
              {updating === 'all' ? 'Updating...' : `Update all (${outdated.length})`}
            </Button>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Input
          icon={<Search size={14} />}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter packages..."
        />
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: 'var(--text-tertiary)' }}>
          <Loader2 size={18} className="spin" style={{ marginRight: 8 }} />
          Loading packages...
        </div>
      ) : (
        <div className="pkg-list">
          {filtered.map((pkg) => (
            <div
              key={pkg.name}
              className={`pkg-row ${pkg.isOutdated ? 'pkg-outdated' : ''} ${expandedPkg === pkg.name ? 'pkg-expanded' : ''}`}
              onPointerDown={() => onPointerDown(pkg)}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onClick={() => onClick(pkg)}
            >
              <div className="pkg-info">
                <div className="pkg-name">
                  {pkg.name}
                  {pkg.isDev && <span className="pkg-badge">dev</span>}
                </div>
                <div className="pkg-versions">
                  <span className="pkg-current">{pkg.current}</span>
                  {pkg.isOutdated && (
                    <>
                      <span className="pkg-arrow">→</span>
                      <span className="pkg-latest">{pkg.latest}</span>
                    </>
                  )}
                  {!pkg.isOutdated && (
                    <Check size={12} style={{ color: 'var(--success)', marginLeft: 4 }} />
                  )}
                </div>
              </div>

              {expandedPkg === pkg.name && pkg.isOutdated && (
                <div className="pkg-actions" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={updating === pkg.name ? <Loader2 size={12} className="spin" /> : <ArrowUpCircle size={12} />}
                    onClick={() => updatePackage(pkg.name)}
                    disabled={!!updating}
                  >
                    {updating === pkg.name ? 'Updating...' : `Update to ${pkg.latest}`}
                  </Button>
                  <Button size="sm" icon={<X size={12} />} onClick={() => setExpandedPkg(null)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
          {filter ? 'No packages match your filter.' : 'No packages found.'}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-tertiary)' }}>
        Click to expand · Long press to update · {packages.length} packages installed
      </div>
    </Card>
  );
}
