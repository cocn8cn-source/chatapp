let ctx: AudioContext | null = null;
let timer: number | undefined;

/** Soft two-beep ring made with WebAudio (no audio files). Silently does nothing if the browser blocks audio. */
export function startRing() {
  stopRing();
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    const beep = (at: number) => {
      if (!ctx) return;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 440; g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.4);
    };
    const pattern = () => { beep(0); beep(0.5); };
    pattern(); timer = window.setInterval(pattern, 2500);
  } catch { /* audio blocked */ }
}
export function stopRing() {
  window.clearInterval(timer); timer = undefined;
  void ctx?.close().catch(() => {}); ctx = null;
}
