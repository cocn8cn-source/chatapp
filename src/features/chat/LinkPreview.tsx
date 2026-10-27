import { useQuery } from '@tanstack/react-query';
import { Link2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useInView } from '@/lib/useInView';
import { safeExternalUrl } from './links';
import styles from './MessageBubble.module.css';

type Preview = { url: string; title: string; description: string; image: string | null; siteName: string };

async function fetchPreview(url: string): Promise<Preview> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.functions.invoke('link-preview', { body: { url } });
  if (error) throw error;
  if (!data || typeof data !== 'object' || !data.url) throw new Error('No preview');
  return data as Preview;
}

export function LinkPreview({ url }: { url: string | null }) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const safe = url ? safeExternalUrl(url) : null;
  const q = useQuery({
    queryKey: ['link-preview', safe],
    queryFn: () => fetchPreview(safe!),
    enabled: !!safe && inView,
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
    retry: 0,
  });
  if (!safe) return null;
  const p = q.data;
  if (!p) return <span ref={ref} className={styles.previewPending} aria-hidden />;
  const img = p.image ? safeExternalUrl(p.image) : null;
  return (
    <span ref={ref} className={styles.previewWrap}>
      <a className={styles.preview} href={safe} target="_blank" rel="noopener noreferrer nofollow ugc">
        {img && <img src={img} alt="" className={styles.previewImg} loading="lazy" referrerPolicy="no-referrer" />}
        <span className={styles.previewBody}>
          <span className={styles.previewSite}><Link2 size={11} aria-hidden /> {p.siteName || new URL(safe).hostname}</span>
          <strong className={styles.previewTitle}>{p.title || safe}</strong>
          {p.description && <span className={styles.previewDesc}>{p.description}</span>}
        </span>
      </a>
    </span>
  );
}
