export interface AdminData {
  service: string;
  version: string;
  auth: 'open' | 'locked';
  system: {
    uptime: string;
    uptimeSeconds: number;
    startedAt: string;
    memory: {
      rss: string;
      heapUsed: string;
      heapTotal: string;
      external: string;
      rssBytes: number;
      heapUsedBytes: number;
    };
    bunVersion: string;
    platform: string;
    arch: string;
  };
  session: {
    ready: boolean;
    warmed?: boolean;
    client: string;
    clientVersion: string;
    lastPing: string | null;
    latencyMs: number;
    cookieStatus: boolean;
    cookieInfo: { loaded: boolean; cookieCount: number; path: string };
    engine: string;
    engineVersion: string;
    ytConcurrency?: { active: number; queued: number; max: number; maxSeen: number };
  };
  requests: {
    total: number;
    info: number;
    saudio: number;
    rate: { perMinute: number; perHour: number };
  };
  inflight?: number;
  latency: {
    avg: number;
    min: number;
    max: number;
    p95: number;
    count: number;
    history: { timestamp: number; latencyMs: number; videoId: string }[];
  };
  cache: {
    enabled: boolean;
    metadata: { total: number };
    streams: {
      total: number;
      active: number;
      expired: number;
    };
    hitRatios: {
      metadata: { hits: number; misses: number; ratio: string };
      streams: { hits: number; misses: number; ratio: string };
    };
  };
  cacheEnabled?: boolean;
  config: Record<string, string>;
  timestamp: string;
}

export interface TrackInfo {
  videoId: string;
  title: string;
  channel: string;
  duration: number;
  durationFormatted: string;
  thumbnail: string;
  ytLink: string;
  streamUrl: string;
  proxyUrl: string;
  cached: boolean;
}
