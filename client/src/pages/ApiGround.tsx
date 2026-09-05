import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Play, Pause, Volume2, VolumeX, Music, ExternalLink, Clock, Hash, Radio, Loader2, Download, X, Copy, Check, BadgeCheck } from 'lucide-react';
import { useTrackInfo } from '../hooks/useApi';
import { useCopy } from '../hooks/useCopy';
import { formatDuration as fmt } from '../utils/format';
import { Card, Button, Input } from '../components/UI';

function describeMediaError(err: MediaError | null): string {
  if (!err) return 'Unknown playback error';
  switch (err.code) {
    case MediaError.MEDIA_ERR_ABORTED: return 'Playback aborted';
    case MediaError.MEDIA_ERR_NETWORK: return 'Network error while fetching stream — likely blocked by CORS or the proxy dropped the connection';
    case MediaError.MEDIA_ERR_DECODE: return 'Browser could not decode the audio stream';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: return 'Source not supported — check Content-Type header from the proxy, or a CORS preflight failure';
    default: return `Playback failed (code ${err.code})`;
  }
}

export default function ApiGround() {
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data: track, loading } = useTrackInfo(activeId);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pct, setPct] = useState(0);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragPct, setDragPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [buffering, setBuffering] = useState(false);

  // Display pct: frozen during drag, live otherwise
  const displayPct = dragging ? dragPct : pct;
  const displayCur = dragging ? (dragPct / 100) * (dur || 0) : cur;

  useEffect(() => {
    const el = new Audio();
    el.preload = 'auto';
    audioRef.current = el;

    const onTime = () => {
      setCur(el.currentTime);
      if (el.duration && isFinite(el.duration)) {
        setPct((el.currentTime / el.duration) * 100);
      }
    };
    const onMeta = () => { if (el.duration && isFinite(el.duration)) setDur(el.duration); };
    const onEnded = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => { setError(describeMediaError(el.error)); setPlaying(false); setBuffering(false); };
    const onCanPlay = () => { setBuffering(false); setError(null); };
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => { setBuffering(false); setPlaying(true); };

    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnded);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('error', onError);
    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('playing', onPlaying);

    return () => {
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('error', onError);
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('playing', onPlaying);
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !track) return;
    setError(null); setPct(0); setCur(0); setDur(0); setPlaying(false); setBuffering(true);
    el.src = track.proxyUrl;
    el.load();
    // NOTE: no extra /saudio?json warmup fetch here — /info already prefetches
    // server-side. The old extra fetch doubled load for zero benefit.
  }, [track]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : vol;
  }, [vol, muted]);

  // Clear any pending play-retry on unmount (no setState after unmount).
  useEffect(() => {
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (el.paused) {
      setError(null);
      setBuffering(true);
      const maxRetries = 8;
      let retries = 0;
      const tryPlay = () => {
        el.play().then(() => {}).catch(() => {
          retries++;
          if (retries < maxRetries) {
            retryTimer.current = setTimeout(tryPlay, 600 + retries * 300);
          } else {
            setError('Stream not ready — try again or check proxy');
            setBuffering(false);
          }
        });
      };
      tryPlay();
    } else {
      el.pause();
    }
  }, []);

  const seekTo = useCallback((p: number) => {
    const el = audioRef.current;
    if (el && el.duration && isFinite(el.duration)) el.currentTime = p * el.duration;
  }, []);

  const getPercentFromEvent = useCallback((clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  // Mouse drag
  const onBarDown = (e: React.MouseEvent) => {
    if (!barRef.current) return;
    const p = getPercentFromEvent(e.clientX);
    setDragging(true);
    setDragPct(p * 100);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => setDragPct(getPercentFromEvent(e.clientX) * 100);
    const onUp = (e: MouseEvent) => {
      seekTo(getPercentFromEvent(e.clientX));
      setDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging, seekTo, getPercentFromEvent]);

  // Touch drag
  const onTouchStart = (e: React.TouchEvent) => {
    if (!barRef.current) return;
    const p = getPercentFromEvent(e.touches[0].clientX);
    setDragging(true);
    setDragPct(p * 100);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: TouchEvent) => { e.preventDefault(); setDragPct(getPercentFromEvent(e.touches[0].clientX) * 100); };
    const onEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (touch) seekTo(getPercentFromEvent(touch.clientX));
      setDragging(false);
    };
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    return () => { window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onEnd); };
  }, [dragging, seekTo, getPercentFromEvent]);

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowLeft' && audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
      if (e.code === 'ArrowRight' && audioRef.current?.duration) audioRef.current.currentTime = Math.min(audioRef.current.duration, audioRef.current.currentTime + 5);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [togglePlay]);

  const handleFetch = () => { const v = query.trim(); if (v) setActiveId(v); };
  const handleClear = () => { setQuery(''); setActiveId(null); };
  const { copied: copiedId, copy: copyId } = useCopy();
  const { copied: copiedUrl, copy: copyUrl } = useCopy();

  return (
    <div className="anim-fade">
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Input icon={<Search size={16} />} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleFetch()} placeholder="Paste YouTube URL, video ID, or any supported link..." />
            {query && (
              <button className="ui-input-clear" onClick={handleClear} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>
          <Button variant="primary" icon={loading ? <Loader2 size={15} className="spin" /> : <Search size={15} />} onClick={handleFetch} disabled={loading}>
            {loading ? 'Fetching...' : 'Fetch'}
          </Button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
          Supports: youtube.com/watch?v=..., youtu.be/..., youtube.com/shorts/..., raw video IDs
        </div>
      </Card>

      {track && (
        <div className="anim-rise">
          {error && (
            <Card style={{ marginBottom: 12, borderColor: 'var(--danger)' }}>
              <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-tertiary)' }}>
                Stream URL works: <a href={track.proxyUrl} target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>{track.proxyUrl}</a>
              </div>
            </Card>
          )}

          <Card className="player-card">
            <div className="player-top">
              <div className="player-thumb">
                <img src={track.thumbnail} alt="" className="player-thumb-img" loading="lazy" />
                <button className={`player-thumb-play ${buffering ? 'player-thumb-busy' : ''}`} onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                  {buffering && !playing
                    ? <Loader2 size={28} color="#fff" className="spin" />
                    : playing
                      ? <Pause size={28} fill="#fff" color="#fff" />
                      : <Play size={28} fill="#fff" color="#fff" style={{ marginLeft: 3 }} />}
                </button>
              </div>
              <div className="player-info">
                <div className="player-title" title={track.title}>{track.title}</div>
                <div className="player-artist">{track.channel}</div>
                <div className="player-meta">
                  <span>{track.videoId}</span>
                  <span>·</span>
                  <span>{track.durationFormatted}</span>
                </div>
              </div>
            </div>

            <div className="yt-progress">
              <div
                className={`yt-progress-bar ${dragging ? 'yt-progress-dragging' : ''}`}
                ref={barRef}
                onMouseDown={onBarDown}
                onTouchStart={onTouchStart}
              >
                <div className="yt-progress-fill" style={{ width: `${displayPct}%` }} />
                <div className="yt-progress-thumb" style={{ left: `${displayPct}%` }} />
              </div>
              <div className="yt-progress-time">
                <span>{fmt(displayCur)}</span>
                <span>{dur ? `-${fmt(dur - displayCur)}` : fmt(track.duration)}</span>
              </div>
            </div>

            <div className="yt-controls">
              <div className="yt-controls-left">
                <button className="yt-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                  {buffering && !playing
                    ? <Loader2 size={22} className="spin" />
                    : playing
                      ? <Pause size={22} fill="currentColor" />
                      : <Play size={22} fill="currentColor" style={{ marginLeft: 1 }} />}
                </button>
              </div>
              <div className="yt-controls-right">
                <div className="yt-volume">
                  <button className="yt-btn yt-btn-sm" onClick={() => setMuted(!muted)}>
                    {muted || vol === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <div className="yt-volume-slider-wrap">
                    <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : vol} onChange={(e) => { setVol(parseFloat(e.target.value)); setMuted(false); }} className="yt-volume-slider" />
                  </div>
                </div>
                <a href={`${track.proxyUrl}?download`} download className="yt-btn yt-btn-sm" style={{ textDecoration: 'none' }}>
                  <Download size={18} />
                </a>
              </div>
            </div>
          </Card>

          <div className="page-grid g2" style={{ marginTop: 12 }}>
            <Card>
              <div className="detail-grid">
                <div className="detail-item">
                  <div className="detail-label"><Hash size={12} /> Video ID</div>
                  <div className="detail-value mono row-value">
                    <span>{track.videoId}</span>
                    <button className="icon-btn" onClick={() => copyId(track.videoId)} aria-label="Copy video ID" title="Copy video ID">
                      {copiedId ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
                <div className="detail-item">
                  <div className="detail-label"><Clock size={12} /> Duration</div>
                  <div className="detail-value">{track.durationFormatted}</div>
                </div>
                <div className="detail-item">
                  <div className="detail-label"><Radio size={12} /> Format</div>
                  <div className="detail-value">MP4 Audio (AAC)</div>
                </div>
                <div className="detail-item">
                  <div className="detail-label"><ExternalLink size={12} /> Stream</div>
                  <div className="detail-value mono row-value">
                    <span className="truncate">{track.proxyUrl}</span>
                    <button className="icon-btn" onClick={() => copyUrl(track.proxyUrl)} aria-label="Copy stream URL" title="Copy stream URL">
                      {copiedUrl ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
              </div>
            </Card>
            <Card>
              <div className="detail-grid">
                <div className="detail-item">
                  <div className="detail-label"><Music size={12} /> Title</div>
                  <div className="detail-value">{track.title}</div>
                </div>
                <div className="detail-item">
                  <div className="detail-label"><Radio size={12} /> Artist</div>
                  <div className="detail-value">{track.channel}</div>
                </div>
                <div className="detail-item">
                  <div className="detail-label"><BadgeCheck size={12} /> Cached</div>
                  <div className="detail-value">{track.cached ? 'Yes' : 'No'}</div>
                </div>
                <div className="detail-item">
                  <div className="detail-label">YouTube</div>
                  <a href={track.ytLink} target="_blank" rel="noopener" className="detail-value link-row">
                    Open <ExternalLink size={13} />
                  </a>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
