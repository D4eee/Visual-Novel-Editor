/**
 * Audio waveforms for timeline media bars. Files are decoded once (per asset and URL) into
 * peak values; bars draw the part between their trim points.
 */
import { useEffect, useRef, useState } from 'react';

const RATE = 100; // peaks per second
interface Peaks { duration: number; data: Float32Array }
const cache = new Map<string, Promise<Peaks | null>>();
let ctx: AudioContext | null = null;

export function loadPeaks(url: string): Promise<Peaks | null> {
  let p = cache.get(url);
  if (p) return p;
  p = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      ctx = ctx || new AudioContext();
      const audio = await ctx.decodeAudioData(buf);
      const n = Math.max(1, Math.ceil(audio.duration * RATE));
      const data = new Float32Array(n);
      const per = audio.length / n;
      for (let c = 0; c < audio.numberOfChannels; c++) {
        const ch = audio.getChannelData(c);
        for (let i = 0; i < n; i++) {
          let m = 0;
          const end = Math.min(ch.length, Math.floor((i + 1) * per));
          // Sample a few hundred points per bucket: enough for a picture, fast for long files.
          const step = Math.max(1, Math.floor(per / 256));
          for (let j = Math.floor(i * per); j < end; j += step) { const v = Math.abs(ch[j]); if (v > m) m = v; }
          if (m > data[i]) data[i] = m;
        }
      }
      return { duration: audio.duration, data };
    } catch { return null; }
  })();
  cache.set(url, p);
  return p;
}

export function forgetPeaks(url?: string): void {
  if (url) cache.delete(url); else cache.clear();
}

/** The waveform of [trimIn, trimIn + duration) of an audio file, drawn to fill its parent. */
export function Waveform({ url, trimIn, duration, width, height = 18 }: { url: string | null; trimIn: number; duration: number; width: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  useEffect(() => {
    let alive = true;
    setPeaks(null);
    if (url) loadPeaks(url).then((p) => { if (alive) setPeaks(p); });
    return () => { alive = false; };
  }, [url]);
  useEffect(() => {
    const c = ref.current;
    if (!c || !peaks) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.min(8000, Math.round(width)));
    c.width = Math.round(w * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, height);
    g.fillStyle = 'rgba(200, 228, 255, 0.55)';
    const mid = height / 2;
    for (let x = 0; x < w; x++) {
      const t0 = trimIn + (x / w) * duration;
      const t1 = trimIn + ((x + 1) / w) * duration;
      if (t0 >= peaks.duration) break;
      let m = 0;
      for (let i = Math.floor(t0 * RATE); i <= Math.min(peaks.data.length - 1, Math.floor(t1 * RATE)); i++) if (peaks.data[i] > m) m = peaks.data[i];
      const h = Math.max(0.5, m * (height - 2) / 2);
      g.fillRect(x, mid - h, 1, h * 2);
    }
  }, [peaks, trimIn, duration, width, height]);
  if (!url) return null;
  return <canvas ref={ref} className="waveform" style={{ width, height }} aria-hidden />;
}
