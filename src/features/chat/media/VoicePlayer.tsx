import { useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { formatDuration } from './validation';
import styles from './Media.module.css';

const RATES = [1, 1.5, 2];
const FALLBACK = Array.from({ length: 40 }, (_, i) => 20 + ((i * 37) % 40));

export function VoicePlayer({ src, durationMs, waveform }: { src?: string; durationMs: number; waveform?: number[] | null }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [rateIdx, setRateIdx] = useState(0);
  const bars = waveform && waveform.length ? waveform : FALLBACK;
  const progress = durationMs > 0 ? Math.min(1, timeMs / durationMs) : 0;

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play(); else a.pause();
  };
  const cycleRate = () => {
    const next = (rateIdx + 1) % RATES.length;
    setRateIdx(next);
    if (audio.current) audio.current.playbackRate = RATES[next];
  };

  return (
    <div className={styles.voice}>
      <audio ref={audio} src={src} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setTimeMs(0); }}
        onTimeUpdate={(e) => setTimeMs(e.currentTarget.currentTime * 1000)} />
      <button type="button" className={styles.playBtn} onClick={toggle} disabled={!src} aria-label={playing ? 'Pause voice message' : 'Play voice message'}>
        {playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
      </button>
      <div className={styles.waveWrap}>
        <div className={styles.wave} aria-hidden>
          {bars.map((h, i) => <span key={i} className={i / bars.length < progress ? styles.barOn : styles.bar} style={{ height: `${h}%` }} />)}
        </div>
        <input type="range" className={styles.seek} min={0} max={Math.max(durationMs, 1)} step={100} value={Math.min(timeMs, durationMs)}
          aria-label="Seek voice message" aria-valuetext={`${formatDuration(timeMs)} of ${formatDuration(durationMs)}`} disabled={!src}
          onChange={(e) => { const v = Number(e.target.value); setTimeMs(v); if (audio.current) audio.current.currentTime = v / 1000; }} />
      </div>
      <span className={styles.time}>{formatDuration(playing || timeMs > 0 ? timeMs : durationMs)}</span>
      <button type="button" className={styles.rate} onClick={cycleRate} aria-label={`Playback speed ${RATES[rateIdx]}x. Change speed`}>{RATES[rateIdx]}x</button>
    </div>
  );
}
