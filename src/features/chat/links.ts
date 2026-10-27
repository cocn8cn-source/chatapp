export type MessageSegment = { type: 'text' | 'url' | 'mention'; value: string };

const TOKEN = /(https?:\/\/[^\s<>"']+|@[a-z0-9_]{3,24})/gi;

/** Strip punctuation that commonly follows a pasted link but is not part of it. */
export function trimUrl(url: string): string {
  return url.replace(/[.,;:!?)\]}]+$/g, '');
}

export function safeExternalUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function allUrls(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const safe = safeExternalUrl(trimUrl(match[0]));
    if (safe && !seen.has(safe)) {
      seen.add(safe);
      found.push(safe);
    }
  }
  return found;
}

export function firstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  const url = trimUrl(match[0]);
  return safeExternalUrl(url);
}

export function tokenizeMessage(text: string, mentionUsernames: string[] = []): MessageSegment[] {
  const mentions = new Set(mentionUsernames.map((u) => u.toLowerCase()));
  const out: MessageSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const raw = match[0];
    const index = match.index ?? 0;
    if (index > last) out.push({ type: 'text', value: text.slice(last, index) });
    if (raw.startsWith('@')) {
      const name = raw.slice(1).toLowerCase();
      if (mentions.has(name)) out.push({ type: 'mention', value: raw });
      else out.push({ type: 'text', value: raw });
    } else {
      const clean = trimUrl(raw);
      const safe = safeExternalUrl(clean);
      if (safe) out.push({ type: 'url', value: clean });
      else out.push({ type: 'text', value: clean });
      const trailing = raw.slice(clean.length);
      if (trailing) out.push({ type: 'text', value: trailing });
    }
    last = index + raw.length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out.length ? out : [{ type: 'text', value: text }];
}
