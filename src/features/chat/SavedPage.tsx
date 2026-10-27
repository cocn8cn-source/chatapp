import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/Button/Button';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { Skeleton } from '@/components/Skeleton/Skeleton';
import { fetchSavedMessages, keys, setStar } from './api';
import { formatDateTime, messageSummary } from './format';
import styles from './SavedPage.module.css';

export function SavedPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keys.saved, queryFn: fetchSavedMessages });
  const unsave = useMutation({
    mutationFn: (id: string) => setStar(id, false),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.saved }),
  });

  return (
    <section className={styles.page} aria-labelledby="saved-title">
      <header className={styles.head}>
        <Link to="/app/chats" className={styles.back}><ArrowLeft size={16} aria-hidden /> Chats</Link>
        <h1 id="saved-title">Saved messages</h1>
        <p className={styles.lede}>Messages you star stay here until you remove them. Saved messages are private to your account.</p>
      </header>

      {q.isLoading && <div className={styles.loading} role="status" aria-label="Loading saved messages"><Skeleton height="4.5rem" /><Skeleton height="4.5rem" /><Skeleton height="4.5rem" /></div>}
      {q.isError && <p className={styles.err} role="alert">Could not load saved messages. <button onClick={() => q.refetch()}>Retry</button></p>}
      {q.isSuccess && q.data.length === 0 && (
        <EmptyState variant="saved" title="Nothing saved yet">
          Open a message’s actions and choose <strong>Save message</strong>. You can find it here later without scrolling back.
        </EmptyState>
      )}

      <ul className={styles.list}>
        {q.data?.map((s) => {
          const m = s.messages;
          const deleted = !m || !!m.deleted_at;
          return (
            <li key={s.message_id} className={styles.row}>
              <span className={styles.star} aria-hidden><Star size={16} fill="currentColor" /></span>
              <div className={styles.copy}>
                <span className={styles.meta}>
                  <strong>{m?.conversations?.title ?? 'Conversation'}</strong>
                  <time dateTime={s.created_at}>{formatDateTime(s.created_at)}</time>
                </span>
                <p className={deleted ? styles.deleted : undefined}>{deleted ? 'This message was deleted.' : messageSummary(m.body, m.attachments, m.deleted_at)}</p>
              </div>
              <div className={styles.actions}>
                {m && !deleted && (
                  <Link to={`/app/chats/${m.conversation_id}?message=${m.id}`} className={styles.open}>
                    <ExternalLink size={15} aria-hidden /> Open
                  </Link>
                )}
                <Button variant="ghost" onClick={() => unsave.mutate(s.message_id)} loading={unsave.isPending && unsave.variables === s.message_id}
                  aria-label="Remove from saved messages">
                  <Trash2 size={15} aria-hidden /> Remove
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
