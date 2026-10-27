import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@/components/Dialog/Dialog';
import { Button } from '@/components/Button/Button';
import styles from './AvatarCropper.module.css';

const OUT = 512;

export function AvatarCropper({ file, onCancel, onDone }: {
  file: File | null;
  onCancel: () => void;
  onDone: (f: File) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { setImg(image); setZoom(1); setOffset({ x: 0, y: 0 }); setError(null); };
    image.onerror = () => setError('This image could not be opened.');
    image.src = url;
    return () => { image.onload = null; image.onerror = null; URL.revokeObjectURL(url); };
  }, [file]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const base = Math.max(OUT / img.naturalWidth, OUT / img.naturalHeight);
    const scale = base * zoom;
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    const x = (OUT - w) / 2 + offset.x * OUT;
    const y = (OUT - h) / 2 + offset.y * OUT;
    ctx.clearRect(0, 0, OUT, OUT);
    ctx.fillStyle = '#f3f0e2';
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, x, y, w, h);
  }, [img, zoom, offset]);

  const save = () => {
    const c = canvas.current;
    if (!c) return;
    c.toBlob((blob) => {
      if (!blob) { setError('Could not prepare the image.'); return; }
      onDone(new File([blob], 'avatar.webp', { type: 'image/webp' }));
    }, 'image/webp', 0.9);
  };

  return (
    <Dialog
      open={!!file} onClose={onCancel} title="Crop your photo" size="sm"
      description="Drag to reposition. The photo is shown as a circle in chats."
      footer={<><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button onClick={save} disabled={!img}>Use photo</Button></>}
    >
      <div className={styles.wrap}>
        <div className={styles.stage}>
          <canvas
            ref={canvas} width={OUT} height={OUT} className={styles.canvas}
            role="img" aria-label="Photo crop preview"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const size = (e.currentTarget as HTMLElement).clientWidth || 1;
              setOffset({
                x: Math.max(-0.5, Math.min(0.5, drag.current.ox + (e.clientX - drag.current.x) / size)),
                y: Math.max(-0.5, Math.min(0.5, drag.current.oy + (e.clientY - drag.current.y) / size)),
              });
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
          />
          <span className={styles.mask} aria-hidden />
        </div>
        <label className={styles.zoom}>
          <span>Zoom</span>
          <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
        <button type="button" className={styles.reset} onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>Reset position</button>
        {error && <p className={styles.err} role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
