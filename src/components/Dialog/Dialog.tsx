import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import styles from './Dialog.module.css';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'center' | 'sheet';
  hideTitle?: boolean;
};

/**
 * Native <dialog> gives us focus trapping, Escape handling and an inert background
 * without a dependency. It is always mounted only while open.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', variant = 'center', hideTitle }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles[size]} ${variant === 'sheet' ? styles.sheet : ''}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div className={styles.inner} onClick={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <div>
            <h2 id={titleId} className={hideTitle ? 'sr-only' : styles.title}>{title}</h2>
            {description && <p id={descId} className={styles.desc}>{description}</p>}
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close dialog">
            <X size={20} aria-hidden />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </dialog>
  );
}
