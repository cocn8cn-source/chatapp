import { useCallback, useEffect, useRef, useState } from 'react';
import { downsampleWaveform } from './validation';

export type RecState = 'idle' | 'recording' | 'paused' | 'preview';
export type VoiceResult = { blob: Blob; mime: string; durationMs: number; waveform: number[] };

const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
export function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

export function useVoiceRecorder() {
  const [state, setState] = useState<RecState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [live, setLive] = useState<number[]>([]);
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = pickMime() !== null && !!navigator.mediaDevices?.getUserMedia;

  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const chunks = useRef<Blob[]>([]);
  const levels = useRef<number[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const acc = useRef(0);
  const since = useRef(0);

  const teardown = useCallback(() => {
    window.clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
  }, []);
  useEffect(() => () => {
    const r = rec.current;
    if (r && r.state !== 'inactive') { r.onstop = null; r.stop(); }
    teardown();
  }, [teardown]);

  const reset = useCallback(() => {
    teardown(); rec.current = null; chunks.current = []; levels.current = []; acc.current = 0;
    setElapsedMs(0); setLive([]); setResult(null); setState('idle');
  }, [teardown]);

  const start = useCallback(async () => {
    setError(null);
    const mime = pickMime();
    if (!mime || !navigator.mediaDevices?.getUserMedia) { setError('Voice notes are not supported in this browser.'); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const c = new AC(); ctx.current = c;
      const analyser = c.createAnalyser(); analyser.fftSize = 512;
      c.createMediaStreamSource(s).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);

      const r = new MediaRecorder(s, { mimeType: mime });
      rec.current = r; chunks.current = []; levels.current = []; acc.current = 0;
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => {
        const blob = new Blob(chunks.current, { type: mime.split(';')[0] });
        const durationMs = acc.current;
        teardown();
        if (blob.size === 0 || durationMs < 500) { setError('That recording was too short.'); reset(); return; }
        setResult({ blob, mime: mime.split(';')[0], durationMs, waveform: downsampleWaveform(levels.current) });
        setState('preview');
      };
      r.start(250);
      since.current = performance.now();
      setState('recording');
      timer.current = window.setInterval(() => {
        if (r.state !== 'recording') return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 3);
        levels.current.push(level);
        setLive((l) => [...l.slice(-39), level]);
        setElapsedMs(acc.current + (performance.now() - since.current));
      }, 100);
    } catch (e) {
      teardown();
      const name = (e as DOMException).name;
      setError(name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser settings to record.'
        : name === 'NotFoundError' ? 'No microphone was found.' : 'Could not start recording.');
      setState('idle');
    }
  }, [reset, teardown]);

  const pause = useCallback(() => {
    if (rec.current?.state !== 'recording') return;
    rec.current.pause(); acc.current += performance.now() - since.current; setElapsedMs(acc.current); setState('paused');
  }, []);
  const resume = useCallback(() => {
    if (rec.current?.state !== 'paused') return;
    rec.current.resume(); since.current = performance.now(); setState('recording');
  }, []);
  const stop = useCallback(() => {
    const r = rec.current;
    if (!r || r.state === 'inactive') return;
    if (r.state === 'recording') acc.current += performance.now() - since.current;
    r.stop();
  }, []);
  const cancel = useCallback(() => {
    const r = rec.current;
    if (r && r.state !== 'inactive') { r.onstop = null; r.stop(); }
    reset();
  }, [reset]);

  return { state, elapsedMs, live, result, error, supported, start, pause, resume, stop, cancel, discard: reset };
}
