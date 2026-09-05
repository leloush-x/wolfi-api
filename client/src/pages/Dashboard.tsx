import { useState, useEffect } from 'react';
import {
  Activity, Database, Clock, Cpu, HardDrive, BarChart3, Zap, Globe,
  ShieldCheck, ShieldAlert, Flame, Hourglass,
} from 'lucide-react';
import { useAdmin } from '../hooks/useApi';
import { Card, CardTitle, StatCard, Badge, ListItem } from '../components/UI';
import { LineChart, BarChart, DonutChart } from '../components/Charts';

const MEM_MAX = 20;

function startedLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `since ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

export default function Dashboard() {
  const { data, loading } = useAdmin(5000);
  const [memHist, setMemHist] = useState<number[]>([]);

  // Append memory sample per poll (effect, not render — no ref-during-render).
  const rssBytes = data?.system.memory.rssBytes;
  useEffect(() => {
    if (typeof rssBytes !== 'number') return;
    setMemHist((prev) => [...prev, rssBytes / (1024 * 1024)].slice(-MEM_MAX));
  }, [rssBytes]);

  if (loading || !data) {
    return (
      <div className="page-grid g4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="ui-skeleton anim-fade" style={{ height: 110, borderRadius: 'var(--radius-lg)' }} />
        ))}
      </div>
    );
  }

  const { system, session, requests, latency, cache } = data;
  const warmed = session.warmed ?? session.ready;
  const yt = session.ytConcurrency;
  const inflight = data.inflight ?? 0;

  const latencyData = latency.history.length > 1
    ? latency.history.map((h) => h.latencyMs)
    : latency.count > 0
      ? Array(12).fill(latency.avg)
      : Array(12).fill(0);

  return (
    <div className="anim-fade">
      {/* Top stats */}
      <div className="page-grid g4" style={{ marginBottom: 16 }}>
        <div className="anim-rise d1">
          <StatCard
            label="Session"
            value={warmed ? 'Active' : 'Warming'}
            badge={<Badge variant={warmed ? 'success' : 'warning'} dot>{session.client}</Badge>}
            sub={warmed ? `${session.engine} ${session.clientVersion}` : 'Connecting to YouTube…'}
          />
        </div>
        <div className="anim-rise d2">
          <StatCard
            label="Cookies"
            value={session.cookieInfo.cookieCount}
            sub={session.cookieInfo.loaded ? 'Loaded from cookies.txt' : 'No cookie file'}
            badge={session.cookieInfo.loaded ? <Badge variant="success" dot>Valid</Badge> : <Badge variant="danger" dot>Missing</Badge>}
          />
        </div>
        <div className="anim-rise d3">
          <StatCard
            label="Cache"
            value={cache.metadata.total + cache.streams.total}
            badge={cache.enabled ? <Badge variant="success" dot>Enabled</Badge> : <Badge variant="warning" dot>Paused</Badge>}
            sub={`${cache.streams.active} active streams`}
          />
        </div>
        <div className="anim-rise d4" title={startedLabel(system.startedAt)}>
          <StatCard
            label="Uptime"
            value={system.uptime}
            badge={
              data.auth === 'locked'
                ? <Badge variant="accent" dot><ShieldCheck size={11} /> Locked</Badge>
                : <Badge variant="neutral" dot><ShieldAlert size={11} /> Open</Badge>
            }
            sub={startedLabel(system.startedAt)}
          />
        </div>
      </div>

      {/* Charts row */}
      <div className="page-grid g2" style={{ marginBottom: 16 }}>
        <div className="anim-rise d2">
          <Card>
            <CardTitle icon={<BarChart3 size={14} />}>Latency</CardTitle>
            <LineChart data={latencyData} color="var(--accent)" />
            <div className="chart-footer">
              <span>min {latency.min}ms</span>
              <span>p95 {latency.p95}ms</span>
              <span>avg {latency.avg}ms</span>
            </div>
          </Card>
        </div>
        <div className="anim-rise d3">
          <Card>
            <CardTitle icon={<Cpu size={14} />}>Memory</CardTitle>
            <BarChart data={memHist} color="var(--accent)" />
            <div className="chart-footer">
              <span>Heap: {system.memory.heapUsed}</span>
              <span>RSS: {system.memory.rss}</span>
            </div>
          </Card>
        </div>
      </div>

      {/* Bottom row */}
      <div className="page-grid g3" style={{ marginBottom: 16 }}>
        <div className="anim-rise d2">
          <Card>
            <CardTitle icon={<Activity size={14} />}>Requests</CardTitle>
            <div className="ui-list">
              <ListItem left="Total" right={requests.total} icon={<Globe size={13} />} />
              <ListItem left="Info" right={requests.info} icon={<Zap size={13} />} />
              <ListItem left="Audio" right={requests.saudio} icon={<Database size={13} />} />
              <ListItem
                left="In flight"
                right={inflight}
                icon={<Hourglass size={13} />}
              />
            </div>
            <div className="chart-footer" style={{ marginTop: 12 }}>
              <span>{requests.rate.perMinute}/min</span>
              <span>{requests.rate.perHour}/hr</span>
            </div>
          </Card>
        </div>

        <div className="anim-rise d3">
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
        </div>

        <div className="anim-rise d4">
          <Card>
            <CardTitle icon={<HardDrive size={14} />}>System</CardTitle>
            <div className="ui-list">
              <ListItem left="Platform" right={`${system.platform} ${system.arch}`} icon={<Cpu size={13} />} />
              <ListItem left="Runtime" right={`Bun ${system.bunVersion}`} icon={<Activity size={13} />} />
              <ListItem left="Heap" right={system.memory.heapUsed} icon={<HardDrive size={13} />} />
              <ListItem left="Client" right={session.client} icon={<Globe size={13} />} />
              <ListItem left="Engine" right={`${session.engine} v${session.engineVersion}`} icon={<Cpu size={13} />} />
              <ListItem
                left="YT pool"
                right={yt ? `${yt.active}/${yt.max} · ${yt.queued} queued` : '—'}
                icon={<Flame size={13} />}
              />
              <ListItem left="Last ping" right={session.lastPing ? new Date(session.lastPing).toLocaleTimeString() : '—'} icon={<Clock size={13} />} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
