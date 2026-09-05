import { useState, useEffect, useCallback, useRef } from 'react';
import type { AdminData, TrackInfo } from '../types';
import { authHeaders } from '../utils/auth';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Visibility-aware polling: pauses when the tab is hidden (idle-light),
 * resumes on focus. In-flight requests are aborted on unmount — no
 * setState-after-unmount, no dangling network work.
 */
export function useAdmin(pollInterval = 5000) {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (document.hidden) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const d = await api<AdminData>('/admin', { signal: ctrl.signal });
      setData(d);
      setError(null);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(e.message);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollInterval);
    const onVis = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      abortRef.current?.abort();
    };
  }, [refresh, pollInterval]);

  return { data, error, loading, refresh };
}

export function useTrackInfo(videoId: string | null) {
  const [data, setData] = useState<TrackInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!videoId) return;
    const ctrl = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<TrackInfo>(`/info?q=${encodeURIComponent(videoId)}`, { signal: ctrl.signal })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled && e?.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [videoId]);

  return { data, error, loading };
}
