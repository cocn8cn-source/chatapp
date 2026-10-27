// Supabase Edge Function: safe Open Graph metadata for chat link previews.
// Requires a signed-in user. Blocks localhost/private network targets and revalidates redirects
// to reduce SSRF risk. Bodies are capped, requests time out, and results are cached briefly.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const cache = new Map<string, { at: number; value: Preview }>();
type Preview = { url: string; title: string; description: string; image: string | null; siteName: string };

function isPrivateIp(ip: string): boolean {
  if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.)/.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip === '::1' || ip === '::' || /^(fc|fd|fe80)/i.test(ip)) return true;
  return false;
}

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return isPrivateIp(h);
  if (h.startsWith('[')) return isPrivateIp(h.replace(/^\[|\]$/g, ''));
  return false;
}

async function assertPublicUrl(url: URL) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol');
  if (url.username || url.password) throw new Error('credentials in URL are not allowed');
  if (isBlockedHost(url.hostname)) throw new Error('private host');
  let v4: string[] = [];
  try {
    v4 = await Deno.resolveDns(url.hostname, 'A');
  } catch {
    // A host without an A record may still have AAAA; resolve it below.
  }
  if (v4.some(isPrivateIp)) throw new Error('private address');
  if (v4.length > 0) return;

  let v6: string[];
  try {
    v6 = await Deno.resolveDns(url.hostname, 'AAAA');
  } catch (cause) {
    throw new Error('host could not be resolved', { cause });
  }
  if (v6.some(isPrivateIp)) throw new Error('private address');
}

async function readCapped(res: Response, max = 300_000): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel().catch(() => {}); break; }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
  return text;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ').trim();
}

function meta(html: string, keys: string[]): string {
  for (const key of keys) {
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i'),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m?.[1]) return decodeEntities(m[1]).slice(0, 500);
    }
  }
  return '';
}

async function fetchPreview(input: string): Promise<Preview> {
  let url = new URL(input);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(url);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6_000);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: ctl.signal,
        headers: { 'User-Agent': 'ChatSpaceLinkPreview/1.0 (+link preview)', Accept: 'text/html,application/xhtml+xml' },
      });
    } finally { clearTimeout(timer); }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('bad redirect');
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) throw new Error('upstream error');
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('text/html')) throw new Error('not html');
    const html = await readCapped(res);
    const titleTag = HTML_SAFE(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    return {
      url: url.href,
      title: meta(html, ['og:title', 'twitter:title']) || titleTag || url.hostname,
      description: meta(html, ['og:description', 'twitter:description', 'description']).slice(0, 300),
      image: absolutize(meta(html, ['og:image', 'twitter:image', 'og:image:url']), url),
      siteName: meta(html, ['og:site_name']) || url.hostname.replace(/^www\./, ''),
    };
  }
  throw new Error('too many redirects');
}

function HTML_SAFE(s: string) {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).slice(0, 300);
}

function absolutize(candidate: string | null, base: URL): string | null {
  if (!candidate) return null;
  try {
    const u = new URL(candidate, base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (isBlockedHost(u.hostname)) return null;
    return u.href;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { url } = await req.json().catch(() => ({}));
  if (typeof url !== 'string' || url.length > 2048) return json({ error: 'invalid url' }, 400);

  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < 10 * 60_000) return json(cached.value);

  try {
    const value = await fetchPreview(url);
    if (cache.size > 200) cache.clear();
    cache.set(url, { at: Date.now(), value });
    return json(value);
  } catch {
    return json({ error: 'preview unavailable' }, 422);
  }
});
