import type { ReactNode } from 'react';
import { Dialog } from '@/components/Dialog/Dialog';
import { Button } from '@/components/Button/Button';

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  confirmDisabled?: boolean;
};

export function ConfirmDialog({
  open, onClose, onConfirm, title, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  destructive, loading, confirmDisabled,
}: Props) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>{cancelLabel}</Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={() => void onConfirm()}
            loading={loading}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-small)', lineHeight: 1.6 }}>{children}</div>
    </Dialog>
  );
}
