import { useState, useEffect, useCallback } from 'react';
import type { AdminData, TrackInfo } from '../types';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export function useAdmin(pollInterval = 5000) {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try { const d = await api<AdminData>('/admin'); setData(d); setError(null); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollInterval);
    return () => clearInterval(id);
  }, [refresh, pollInterval]);

  return { data, error, loading, refresh };
}

export function useTrackInfo(videoId: string | null) {
  const [data, setData] = useState<TrackInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<TrackInfo>(`/info?q=${encodeURIComponent(videoId)}`)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [videoId]);

  return { data, error, loading };
}
