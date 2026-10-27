import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Dialog } from '@/components/Dialog/Dialog';
import { Button } from '@/components/Button/Button';
import { reportMessage, reportUser } from '@/features/chat/api';
import styles from './ReportDialog.module.css';

const REASONS = [
  { value: 'Spam or unwanted messages', label: 'Spam or unwanted messages' },
  { value: 'Harassment or abuse', label: 'Harassment or abuse' },
  { value: 'Inappropriate content', label: 'Inappropriate content' },
  { value: 'Impersonation', label: 'Impersonation' },
  { value: 'Other safety concern', label: 'Other safety concern' },
];

type Props = {
  open: boolean;
  onClose: () => void;
  userId?: string;
  messageId?: string;
  name: string;
};

export function ReportDialog({ open, onClose, userId, messageId, name }: Props) {
  const [reason, setReason] = useState(REASONS[0].value);
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState(false);

  const send = useMutation({
    mutationFn: async () => {
      if (messageId) return reportMessage(messageId, reason, details.trim());
      if (userId) return reportUser(userId, reason, details.trim());
      throw new Error('Nothing to report');
    },
    onSuccess: () => setSent(true),
  });

  return (
    <Dialog
      open={open} onClose={onClose} title={sent ? 'Report received' : `Report ${name}`} size="sm"
      description={sent ? undefined : 'Reports are private. The other person is not told who reported them.'}
      footer={sent
        ? <Button onClick={onClose}>Close</Button>
        : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={send.isPending}>Cancel</Button>
            <Button variant="danger" onClick={() => send.mutate()} loading={send.isPending}>Send report</Button>
          </>
        )}
    >
      {sent ? (
        <p className={styles.ok} role="status">
          Thank you. Your report was saved for review. You can also block this person from their profile to stop contact immediately.
        </p>
      ) : (
        <form className={styles.form} onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <fieldset className={styles.reasons}>
            <legend>What happened?</legend>
            {REASONS.map((r) => (
              <label key={r.value}>
                <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
                {r.label}
              </label>
            ))}
          </fieldset>
          <label className={styles.details}>
            <span>Anything else? <em>Optional</em></span>
            <textarea value={details} maxLength={1000} rows={4} onChange={(e) => setDetails(e.target.value)}
              placeholder="Add context that would help a moderator." />
          </label>
          {send.isError && <p className={styles.err} role="alert">{(send.error as Error).message}</p>}
        </form>
      )}
    </Dialog>
  );
}
