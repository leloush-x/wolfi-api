import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Play, Pause, Volume2, VolumeX, Music, ExternalLink, Clock, Hash, Radio, Loader2 } from 'lucide-react';
import { useTrackInfo } from '../hooks/useApi';
import { Card, Button, Input } from '../components/UI';

function fmt(s: number): string {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function ApiGround() {
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data: track, loading } = useTrackInfo(activeId);

  const audio = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pct, setPct] = useState(0);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Create audio element once
  useEffect(() => {
    const el = new Audio();
    el.preload = 'metadata';
    audio.current = el;

    const onTime = () => { setCur(el.currentTime); if (el.duration) setPct((el.currentTime / el.duration) * 100); };
    const onMeta = () => setDur(el.duration);
    const onEnded = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnded);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);

    return () => {
      el.pause();
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      audio.current = null;
    };
  }, []);

  // Load new track
  useEffect(() => {
    const el = audio.current;
    if (!el || !track) return;
    el.src = track.proxyUrl;
    el.load();
    setPlaying(false);
    setPct(0);
    setCur(0);
    setDur(0);
  }, [track]);

  // Volume
  useEffect(() => {
    if (audio.current) audio.current.volume = muted ? 0 : vol;
  }, [vol, muted]);

  const togglePlay = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, []);

  const seekTo = useCallback((p: number) => {
    const el = audio.current;
    if (el && el.duration) el.currentTime = p * el.duration;
  }, []);

  const onBarClick = (e: React.MouseEvent) => {
    const rect = barRef.current!.getBoundingClientRect();
    seekTo(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  };

  const onBarDown = (e: React.MouseEvent) => {
    setDragging(true);
    onBarClick(e);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const rect = barRef.current?.getBoundingClientRect();
      if (rect) seekTo(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging, seekTo]);

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowLeft') { e.preventDefault(); if (audio.current) audio.current.currentTime = Math.max(0, audio.current.currentTime - 5); }
      if (e.code === 'ArrowRight') { e.preventDefault(); if (audio.current && audio.current.duration) audio.current.currentTime = Math.min(audio.current.duration, audio.current.currentTime + 5); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [togglePlay]);

  const handleFetch = () => { const v = query.trim(); if (v) setActiveId(v); };

  return (
    <div style={{ animation: 'fadeIn 0.3s var(--ease)' }}>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <Input
              icon={<Search size={16} />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
              placeholder="Paste YouTube URL, video ID, or any supported link..."
            />
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
        <div style={{ animation: 'slideUp 0.4s var(--ease)' }}>
          <Card className="player-card">
            <div className="player-top">
              <div className="player-art">
                <img src={track.thumbnail} alt="" className="player-art-img" />
                <button className="player-art-play" onClick={togglePlay}>
                  {playing ? <Pause size={24} /> : <Play size={24} style={{ marginLeft: 2 }} />}
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

            {/* Progress */}
            <div className="yt-progress">
              <div className="yt-progress-bar" ref={barRef} onMouseDown={onBarDown}>
                <div className="yt-progress-fill" style={{ width: `${pct}%` }} />
                <div className="yt-progress-thumb" style={{ left: `${pct}%` }} />
              </div>
              <div className="yt-progress-time">
                <span>{fmt(cur)}</span>
                <span>{dur ? `-${fmt(dur - cur)}` : fmt(track.duration)}</span>
              </div>
            </div>

            {/* Controls */}
            <div className="yt-controls">
              <div className="yt-controls-left">
                <button className="yt-btn" onClick={togglePlay}>
                  {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" style={{ marginLeft: 1 }} />}
                </button>
              </div>
              <div className="yt-controls-right">
                <div className="yt-volume">
                  <button className="yt-btn yt-btn-sm" onClick={() => setMuted(!muted)}>
                    {muted || vol === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <div className="yt-volume-slider-wrap">
                    <input
                      type="range" min="0" max="1" step="0.01"
                      value={muted ? 0 : vol}
                      onChange={(e) => { setVol(parseFloat(e.target.value)); setMuted(false); }}
                      className="yt-volume-slider"
                    />
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <div className="page-grid g2" style={{ marginTop: 12 }}>
            <Card>
              <div className="detail-grid">
                <div className="detail-item">
                  <div className="detail-label"><Hash size={12} /> Video ID</div>
                  <div className="detail-value mono">{track.videoId}</div>
                </div>
                <div className="detail-item">
                  <div className="detail-label"><Clock size={12} /> Duration</div>
                  <div className="detail-value">{track.durationFormatted}</div>
                </div>
                <div className="detail-item">
                  <div className="detail-label"><Radio size={12} /> Format</div>
                  <div className="detail-value">WebM Audio</div>
                </div>
                <div className="detail-item">
                  <div className="detail-label"><ExternalLink size={12} /> Stream</div>
                  <div className="detail-value mono">{track.streamUrl}</div>
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
                  <div className="detail-label">Cached</div>
                  <div className="detail-value">{track.cached ? 'Yes' : 'No'}</div>
                </div>
                <div className="detail-item">
                  <div className="detail-label">YouTube</div>
                  <a href={track.ytLink} target="_blank" rel="noopener" className="detail-value" style={{ color: 'var(--accent)' }}>Open ↗</a>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
