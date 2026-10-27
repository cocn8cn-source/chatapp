import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import styles from './Media.module.css';

export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className={styles.lightbox} aria-label={alt} onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      <button className={styles.lbClose} onClick={() => ref.current?.close()} aria-label="Close image"><X size={22} aria-hidden /></button>
      <img src={src} alt={alt} className={styles.lbImg} />
    </dialog>
  );
}
