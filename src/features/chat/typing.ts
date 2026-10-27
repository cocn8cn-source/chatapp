export type TypingRow = { user_id: string; updated_at: string };
export const TYPING_TTL_MS = 5_500;

export function activeTypers(rows: TypingRow[], me: string, now = Date.now()): string[] {
  return rows
    .filter((r) => r.user_id !== me && Number.isFinite(new Date(r.updated_at).getTime()))
    .filter((r) => now - new Date(r.updated_at).getTime() < TYPING_TTL_MS)
    .map((r) => r.user_id);
}

export function typingLabel(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names[0]} and ${names.length - 1} others are typing…`;
}
