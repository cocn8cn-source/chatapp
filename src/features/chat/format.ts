export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatClock(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatListTime(iso: string | null, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (sameDay(d, now)) return formatClock(d);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  if (now.getTime() - d.getTime() < 7 * 86400_000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * One-line description of a message for reply quotes, pinned bars and saved items.
 * Attachment-only messages all used to read "Attachment", which made a voice note
 * or a photo look like a stray file that nobody sent.
 */
export function messageSummary(
  body: string | null | undefined,
  attachments?: { kind: string }[] | null,
  deletedAt?: string | null,
): string {
  if (deletedAt) return 'Message deleted';
  const text = (body ?? '').trim();
  if (text) return text;
  const kinds = new Set((attachments ?? []).map((a) => a.kind));
  if (kinds.has('audio')) return 'Voice note';
  if (kinds.has('image')) return 'Photo';
  if (kinds.has('video')) return 'Video';
  if (kinds.has('file')) return 'File';
  return 'Message';
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
