export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;

// Must stay in sync with allowed_mime_types of the `chat-media` bucket (migration 0003).
export const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav',
  'application/pdf', 'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file';

export function kindOf(mime: string): AttachmentKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Returns an error message, or null when the file is acceptable. Server rules remain authoritative. */
export function validateFile(file: { name: string; type: string; size: number }): string | null {
  const mime = file.type.split(';')[0];
  if (!ALLOWED_MIME.includes(mime)) return `${file.name}: this file type is not allowed`;
  if (file.size === 0) return `${file.name}: the file is empty`;
  if (file.size > MAX_FILE_BYTES) return `${file.name}: larger than 25 MB`;
  return null;
}

export function safeFileName(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '-');
  return (cleaned || 'file').slice(-120);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Reduce raw level samples (0..1) to `bars` integer heights (4..100). */
export function downsampleWaveform(levels: number[], bars = 48): number[] {
  if (levels.length === 0) return Array.from({ length: bars }, () => 4);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const a = Math.floor((i * levels.length) / bars);
    const b = Math.max(a + 1, Math.floor(((i + 1) * levels.length) / bars));
    const slice = levels.slice(a, b);
    const peak = Math.max(...slice);
    out.push(Math.max(4, Math.min(100, Math.round(peak * 100))));
  }
  return out;
}
