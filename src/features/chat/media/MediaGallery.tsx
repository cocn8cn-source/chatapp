import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Link2 } from 'lucide-react';
import { fetchLinkSources, fetchMedia, keys, type MediaItem } from '../api';
import { allUrls } from '../links';
import { formatDateTime } from '../format';
import { AttachmentView } from './AttachmentView';
import { formatBytes } from './validation';
import { downloadAttachment } from './AttachmentView';
import styles from './Media.module.css';

type Tab = 'media' | 'audio' | 'files' | 'links';
const inTab = (m: MediaItem, t: Tab) => (t === 'media' ? m.kind === 'image' || m.kind === 'video' : t === 'audio' ? m.kind === 'audio' : m.kind === 'file');

type LinkRow = { url: string; createdAt: string; senderId: string; messageId: string };

export function MediaGallery({ cid }: { cid: string }) {
  const [tab, setTab] = useState<Tab>('media');
  const q = useQuery({ queryKey: keys.media(cid), queryFn: () => fetchMedia(cid) });
  const links = useQuery({ queryKey: [...keys.media(cid), 'links'], queryFn: () => fetchLinkSources(cid), enabled: tab === 'links' });
  const items = (q.data ?? []).filter((m) => inTab(m, tab));

  const linkRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: LinkRow[] = [];
    for (const source of links.data ?? []) {
      for (const url of allUrls(source.body)) {
        if (seen.has(url)) continue;
        seen.add(url);
        rows.push({ url, createdAt: source.created_at, senderId: source.sender_id, messageId: source.id });
      }
    }
    return rows;
  }, [links.data]);

  return (
    <div className={styles.gallery}>
      <div className={styles.galleryTabs} role="group" aria-label="Shared content">
        {(['media', 'audio', 'files', 'links'] as const).map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === 'media' ? 'Photos & videos' : t === 'audio' ? 'Voice & audio' : t === 'files' ? 'Files' : 'Links'}
          </button>
        ))}
      </div>

      {tab === 'links' ? (
        <>
          {links.isLoading && <p className={styles.galleryNote} role="status">Loading shared links…</p>}
          {links.isError && (
            <p className={styles.galleryNote} role="alert">Could not load shared links. <button onClick={() => links.refetch()}>Retry</button></p>
          )}
          {links.isSuccess && linkRows.length === 0 && (
            <div className={styles.galleryEmpty}>
              <h3>No links shared yet</h3>
              <p>Web links sent in this chat collect here. Only members of this conversation can see them.</p>
            </div>
          )}
          <ul className={styles.list}>
            {linkRows.map((row) => {
              const host = new URL(row.url).hostname.replace(/^www\./, '');
              return (
                <li key={row.url}>
                  <a className={styles.linkRow} href={row.url} target="_blank" rel="noopener noreferrer nofollow ugc">
                    <span className={styles.linkIcon} aria-hidden><Link2 size={17} /></span>
                    <span className={styles.linkCopy}>
                      <strong>{host}</strong>
                      <small className={styles.linkUrl}>{row.url}</small>
                      <small>{formatDateTime(row.createdAt)}</small>
                    </span>
                    <ExternalLink size={15} aria-hidden />
                  </a>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          {q.isLoading && <p className={styles.galleryNote} role="status">Loading…</p>}
          {q.isError && <p className={styles.galleryNote} role="alert">Could not load shared content. <button onClick={() => q.refetch()}>Retry</button></p>}
          {q.isSuccess && items.length === 0 && (
            <div className={styles.galleryEmpty}>
              <h3>Nothing shared here yet</h3>
              <p>Photos, videos, voice notes and files sent in this chat will collect here.</p>
            </div>
          )}
          <ul className={tab === 'media' ? styles.grid : styles.list}>
            {items.map((m) => (
              <li key={m.id}>
                {tab === 'files'
                  ? <button className={styles.fileRow} onClick={() => void downloadAttachment(m)}><strong>{m.file_name}</strong><small>{formatBytes(m.size_bytes)} · {new Date(m.created_at).toLocaleDateString()}</small></button>
                  : <AttachmentView a={m} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
