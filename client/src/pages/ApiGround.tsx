import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Music, ExternalLink, Clock, Hash, Radio } from 'lucide-react';
import { useTrackInfo } from '../hooks/useApi';
import { Card, Button, Input } from '../components/UI';
import type { TrackInfo } from '../types';

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

  const handleFetch = () => {
    const val = query.trim();
    if (!val) return;
    setActiveId(val);
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
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
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
      audio.src = track.proxyUrl;
      audio.play();
    }
    setPlaying(!playing);
  }, [playing, track]);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const bar = e.currentTarget;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (audioRef.current && audioRef.current.duration) {
      audioRef.current.currentTime = pct * audioRef.current.duration;
    }
  };

  const skip = (dir: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, Math.min(audioRef.current.duration, audioRef.current.currentTime + dir * 10));
    }
  };

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
          <Button variant="primary" icon={<Search size={15} />} onClick={handleFetch} disabled={loading}>
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
            <div className="player-top">
              <div className="player-art">
                <video src="/logo.mp4" autoPlay loop muted playsInline className="player-art-video" />
                <div className="player-art-overlay" />
                <Music size={32} color="#fff" style={{ position: 'relative', zIndex: 1 }} />
              </div>
              <div className="player-info">
                <div className="player-title">{track.title}</div>
                <div className="player-artist">{track.channel}</div>
                <div className="player-meta">
                  <span>{track.videoId}</span>
                  <span>·</span>
                  <span>{track.durationFormatted}</span>
                </div>
              </div>
            </div>

            {/* Progress */}
            <div className="progress">
              <div className="progress-bar" onClick={seek}>
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="progress-time">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration || track.duration)}</span>
              </div>
            </div>

            {/* Controls */}
            <div className="controls-row">
              <div className="controls">
                <button className="ctrl-btn" onClick={() => skip(-1)}><SkipBack size={18} /></button>
                <button className="ctrl-btn ctrl-play" onClick={togglePlay}>
                  {playing ? <Pause size={22} /> : <Play size={22} style={{ marginLeft: 2 }} />}
                </button>
                <button className="ctrl-btn" onClick={() => skip(1)}><SkipForward size={18} /></button>
              </div>
              <div className="volume">
                <button className="ctrl-btn ctrl-btn-sm" onClick={() => setMuted(!muted)}>
                  {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={muted ? 0 : volume}
                  onChange={(e) => { setVolume(parseFloat(e.target.value)); setMuted(false); }}
                  className="volume-slider"
                />
              </div>
            </div>
          </Card>

          {/* Track details */}
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
