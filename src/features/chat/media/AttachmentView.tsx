import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Image as ImageIcon, Play } from 'lucide-react';
import { fetchMyProfile, keys, type Attachment } from '../api';
import { Lightbox } from './Lightbox';
import { signedUrl } from './upload';
import { useSignedUrl } from './useSignedUrl';
import { VoicePlayer } from './VoicePlayer';
import { formatBytes } from './validation';
import styles from './Media.module.css';

export async function downloadAttachment(a: Pick<Attachment, 'storage_path' | 'file_name'>) {
  const url = await signedUrl(a.storage_path, { download: a.file_name });
  const link = document.createElement('a');
  link.href = url; link.rel = 'noopener'; link.click();
}

export function AttachmentView({ a, pending }: { a: Attachment; pending?: boolean }) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [dlError, setDlError] = useState(false);
  const prefs = useQuery({ queryKey: keys.myProfile, queryFn: fetchMyProfile, staleTime: 120_000, enabled: !pending });
  const autoLoad = a.kind === 'image' ? prefs.data?.auto_download_images !== false
    : a.kind === 'video' ? prefs.data?.auto_download_videos === true
      : true;
  const shouldLoad = !pending && (autoLoad || revealed);
  const url = useSignedUrl(a.storage_path, shouldLoad);

  if (pending) return <div className={styles.placeholder} role="status">Sending {a.file_name}…</div>;
  if (!shouldLoad && (a.kind === 'image' || a.kind === 'video')) {
    return (
      <button type="button" className={styles.loadMedia} onClick={() => setRevealed(true)}>
        {a.kind === 'image' ? <ImageIcon size={18} aria-hidden /> : <Play size={18} aria-hidden />}
        <span><strong>{a.kind === 'image' ? 'Load image' : 'Load video'}</strong><small>{formatBytes(a.size_bytes)} · private media is not downloaded automatically</small></span>
      </button>
    );
  }
  if (url.isError) return <div className={styles.placeholder} role="alert">Could not load {a.file_name}</div>;

  if (a.kind === 'image') {
    return (
      <>
        <button type="button" className={styles.imgBtn} onClick={() => setOpen(true)} aria-label={`Open image ${a.file_name}`} disabled={!url.data}>
          {url.data ? <img src={url.data} alt={a.file_name} loading="lazy" className={styles.img} /> : <span className={styles.imgLoading}>Loading…</span>}
        </button>
        {open && url.data && <Lightbox src={url.data} alt={a.file_name} onClose={() => setOpen(false)} />}
      </>
    );
  }
  if (a.kind === 'video') return <video className={styles.video} src={url.data} controls preload="metadata" aria-label={a.file_name} />;
  if (a.kind === 'audio') return <VoicePlayer src={url.data} durationMs={a.duration_ms ?? 0} waveform={a.waveform} />;
  return (
    <div>
      <button type="button" className={styles.fileChip} onClick={() => { setDlError(false); downloadAttachment(a).catch(() => setDlError(true)); }}>
        <FileText size={20} aria-hidden />
        <span className={styles.fileInfo}><strong>{a.file_name}</strong><small>{formatBytes(a.size_bytes)}</small></span>
        <Download size={18} aria-hidden />
        <span className="sr-only">Download</span>
      </button>
      {dlError && <p className={styles.fileErr} role="alert">Download failed. Try again.</p>}
    </div>
  );
}
