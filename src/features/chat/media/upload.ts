import { envResult } from '@/config/env';
import { supabase } from '@/lib/supabase';
import { safeFileName } from './validation';

export function buildPath(cid: string, messageId: string, fileName: string): string {
  return `${cid}/${messageId}/${crypto.randomUUID()}-${safeFileName(fileName)}`;
}

/** Upload to the private bucket with progress + cancellation (supabase-js exposes neither). */
export async function uploadWithProgress(path: string, file: File, onProgress: (pct: number) => void, signal: AbortSignal): Promise<void> {
  if (!supabase || !envResult.ok) throw new Error('Supabase is not configured');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const cfg = envResult.env;
  const url = `${cfg.VITE_SUPABASE_URL}/storage/v1/object/chat-media/${path.split('/').map(encodeURIComponent).join('/')}`;
  const body = new FormData();
  body.append('cacheControl', '3600');
  body.append('', file); // same shape supabase-js uses
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', cfg.VITE_SUPABASE_ANON_KEY);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

export async function signedUrl(path: string, opts?: { download?: string }): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.storage.from('chat-media').createSignedUrl(path, 3600, opts?.download ? { download: opts.download } : undefined);
  if (error) throw error;
  return data.signedUrl;
}
