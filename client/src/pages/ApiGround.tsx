import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Music, ExternalLink, Clock, Hash, Radio, Loader2 } from 'lucide-react';
import { useTrackInfo } from '../hooks/useApi';
import { Card, Button, Input } from '../components/UI';

function formatTime(s: number): string {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function ApiGround() {
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data: track, loading } = useTrackInfo(activeId);

  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [buffered, setBuffered] = useState(0);

  const handleFetch = () => {
    const val = query.trim();
    if (!val) return;
    setActiveId(val);
    setPlaying(false);
    setProgress(0);
    setCurrent(0);
    setDuration(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleFetch();
  };

  // Audio sync
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => {
      setCurrent(audio.currentTime);
      setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
    };
    const onMeta = () => setDuration(audio.duration);
    const onEnd = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onProgress = () => {
      if (audio.buffered.length > 0) {
        setBuffered((audio.buffered.end(audio.buffered.length - 1) / audio.duration) * 100);
      }
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('progress', onProgress);

    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('progress', onProgress);
    };
  }, [track]);

  // Volume sync
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
  }, [volume, muted]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;

    if (playing) {
      audio.pause();
    } else {
      if (!audio.src || audio.src !== window.location.origin + track.proxyUrl) {
        audio.src = track.proxyUrl;
        audio.load();
      }
      audio.play().catch(() => {});
    }
  }, [playing, track]);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const bar = e.currentTarget;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (audioRef.current && audioRef.current.duration) {
      audioRef.current.currentTime = pct * audioRef.current.duration;
    }
  };

  const skip = useCallback((seconds: number) => {
    if (audioRef.current) {
      const newTime = Math.max(0, Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + seconds));
      audioRef.current.currentTime = newTime;
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skip(-5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          skip(5);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlay, skip]);

  return (
    <div style={{ animation: 'fadeIn 0.3s var(--ease)' }}>
      <audio ref={audioRef} preload="metadata" />

      {/* Search */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <Input
              icon={<Search size={16} />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
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

      {/* Player */}
      {track && (
        <div className="player-section" style={{ animation: 'slideUp 0.4s var(--ease)' }}>
          <Card className="player-card">
            {/* Thumbnail + Info */}
            <div className="player-top">
              <div className="player-art">
                <img src={track.thumbnail} alt={track.title} className="player-art-img" />
                <div className="player-art-overlay" />
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

            {/* Progress Bar */}
            <div className="yt-progress">
              <div className="yt-progress-bar" onClick={seek}>
                <div className="yt-progress-buffered" style={{ width: `${buffered}%` }} />
                <div className="yt-progress-fill" style={{ width: `${progress}%` }} />
                <div className="yt-progress-thumb" style={{ left: `${progress}%` }} />
              </div>
              <div className="yt-progress-time">
                <span>{formatTime(currentTime)}</span>
                <span>-{formatTime((duration || track.duration) - currentTime)}</span>
              </div>
            </div>

            {/* Controls */}
            <div className="yt-controls">
              <div className="yt-controls-left">
                <button className="yt-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                  {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" style={{ marginLeft: 1 }} />}
                </button>
                <button className="yt-btn" onClick={() => skip(-10)} aria-label="Rewind 10s">
                  <SkipBack size={18} />
                  <span className="yt-btn-label">10</span>
                </button>
                <button className="yt-btn" onClick={() => skip(10)} aria-label="Forward 10s">
                  <SkipForward size={18} />
                  <span className="yt-btn-label">10</span>
                </button>
              </div>
              <div className="yt-controls-right">
                <div className="yt-volume">
                  <button className="yt-btn yt-btn-sm" onClick={() => setMuted(!muted)} aria-label="Volume">
                    {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <div className="yt-volume-slider-wrap">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={muted ? 0 : volume}
                      onChange={(e) => { setVolume(parseFloat(e.target.value)); setMuted(false); }}
                      className="yt-volume-slider"
                    />
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Track Details */}
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
                  <a href={track.ytLink} target="_blank" rel="noopener" className="detail-value" style={{ color: 'var(--accent)' }}>
                    Open ↗
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
