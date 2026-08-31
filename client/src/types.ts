export interface AdminData {
  system: {
    uptime: string;
    uptimeSeconds: number;
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
    client: string;
    clientVersion: string;
    lastPing: string | null;
    latencyMs: number;
    cookieStatus: boolean;
    cookieInfo: { loaded: boolean; cookieCount: number; path: string };
    engine: string;
  };
  requests: {
    total: number;
    info: number;
    saudio: number;
    rate: { perMinute: number; perHour: number };
  };
  latency: {
    avg: number;
    min: number;
    max: number;
    p95: number;
    count: number;
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

export interface StreamResponse {
  videoId: string;
  streamUrl: string;
  proxyUrl: string;
  expiresAt: number;
  expiresIn: number;
  cached: boolean;
  note: string;
}
