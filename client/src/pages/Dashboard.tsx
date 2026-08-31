import { Activity, Database, Clock, Cpu, HardDrive, BarChart3, Zap, Globe } from 'lucide-react';
import { useAdmin } from '../hooks/useApi';
import { Card, CardTitle, StatCard, Badge, ListItem } from '../components/UI';
import { LineChart, BarChart, DonutChart } from '../components/Charts';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function memHistory(bytes: number): number[] {
  const base = bytes / (1024 * 1024);
  return Array.from({ length: 20 }, (_, i) => base + Math.sin(i * 0.5) * 0.8 + (Math.random() - 0.5) * 0.4);
}

export default function Dashboard() {
  const { data, loading } = useAdmin(5000);

  if (loading || !data) {
    return (
      <div className="page-grid g4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="ui-skeleton" style={{ height: 110, borderRadius: 'var(--radius-lg)' }} />
        ))}
      </div>
    );
  }

  const { system, session, requests, latency, cache } = data;
  const memHist = memHistory(system.memory.rssBytes);

  return (
    <div style={{ animation: 'fadeIn 0.3s var(--ease)' }}>
      {/* Top stats */}
      <div className="page-grid g4" style={{ marginBottom: 16 }}>
        <StatCard
          label="Session"
          value={session.ready ? 'Active' : 'Inactive'}
          badge={<Badge variant={session.ready ? 'success' : 'danger'} dot>{session.client}</Badge>}
          sub={`${session.engine} ${session.clientVersion}`}
        />
        <StatCard
          label="Cookies"
          value={session.cookieInfo.cookieCount}
          sub={session.cookieInfo.loaded ? 'Loaded from cookies.txt' : 'No cookie file'}
          badge={session.cookieInfo.loaded ? <Badge variant="success" dot>Valid</Badge> : <Badge variant="danger" dot>Missing</Badge>}
        />
        <StatCard
          label="Cache"
          value={cache.metadata.total + cache.streams.total}
          badge={cache.enabled ? <Badge variant="success" dot>Enabled</Badge> : <Badge variant="warning" dot>Paused</Badge>}
          sub={`${cache.streams.active} active streams`}
        />
        <StatCard
          label="Uptime"
          value={system.uptime}
          sub={`${system.platform} ${system.arch} · ${system.bunVersion}`}
        />
      </div>

      {/* Charts row */}
      <div className="page-grid g2" style={{ marginBottom: 16 }}>
        <Card>
          <CardTitle icon={<BarChart3 size={14} />}>Latency</CardTitle>
          <LineChart data={latency.count > 0 ? Array.from({ length: 12 }, () => latency.avg + (Math.random() - 0.5) * latency.avg * 0.4) : Array(12).fill(0)} color="var(--accent)" />
          <div className="chart-footer">
            <span>min {latency.min}ms</span>
            <span>p95 {latency.p95}ms</span>
            <span>avg {latency.avg}ms</span>
          </div>
        </Card>
        <Card>
          <CardTitle icon={<Cpu size={14} />}>Memory</CardTitle>
          <BarChart data={memHist} color="var(--accent)" />
          <div className="chart-footer">
            <span>Heap: {system.memory.heapUsed}</span>
            <span>RSS: {system.memory.rss}</span>
          </div>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="page-grid g3" style={{ marginBottom: 16 }}>
        {/* Request history */}
        <Card>
          <CardTitle icon={<Activity size={14} />}>Requests</CardTitle>
          <div className="ui-list">
            <ListItem left="Total" right={requests.total} icon={<Globe size={13} />} />
            <ListItem left="Info" right={requests.info} icon={<Zap size={13} />} />
            <ListItem left="Saudio" right={requests.saudio} icon={<Database size={13} />} />
          </div>
          <div className="chart-footer" style={{ marginTop: 12 }}>
            <span>{requests.rate.perMinute}/min</span>
            <span>{requests.rate.perHour}/hr</span>
          </div>
        </Card>

        {/* Cache breakdown */}
        <Card>
          <CardTitle icon={<Database size={14} />}>Cache</CardTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <DonutChart
              values={[cache.metadata.total || 0, cache.streams.total || 0]}
              colors={['var(--accent)', 'var(--peach)']}
            />
            <div className="ui-list" style={{ flex: 1 }}>
              <ListItem left="Metadata" right={`${cache.metadata.total} · ${cache.hitRatios.metadata.ratio}`} icon={<span className="dot-inline" style={{ background: 'var(--accent)' }} />} />
              <ListItem left="Streams" right={`${cache.streams.total} · ${cache.hitRatios.streams.ratio}`} icon={<span className="dot-inline" style={{ background: 'var(--peach)' }} />} />
            </div>
          </div>
        </Card>

        {/* System info */}
        <Card>
          <CardTitle icon={<HardDrive size={14} />}>System</CardTitle>
          <div className="ui-list">
            <ListItem left="Platform" right={`${system.platform} ${system.arch}`} icon={<Cpu size={13} />} />
            <ListItem left="Runtime" right={`Bun ${system.bunVersion}`} icon={<Activity size={13} />} />
            <ListItem left="Heap" right={system.memory.heapUsed} icon={<HardDrive size={13} />} />
            <ListItem left="Client" right={session.client} icon={<Globe size={13} />} />
            <ListItem left="Last ping" right={session.lastPing ? new Date(session.lastPing).toLocaleTimeString() : '—'} icon={<Clock size={13} />} />
          </div>
        </Card>
      </div>
    </div>
  );
}
