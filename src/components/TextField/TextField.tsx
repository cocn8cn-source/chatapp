import { useId, type ComponentProps } from 'react';
import styles from './TextField.module.css';

type Props = ComponentProps<'input'> & { label: string; error?: string; hint?: string };

export function TextField({ label, error, hint, id, className, ...rest }: Props) {
  const auto = useId();
  const fieldId = id ?? auto;
  const msgId = `${fieldId}-msg`;
  return (
    <div className={styles.field}>
      <label htmlFor={fieldId} className={styles.label}>{label}</label>
      <input
        id={fieldId} className={`${styles.input} ${className ?? ''}`}
        aria-invalid={error ? true : undefined} aria-describedby={error || hint ? msgId : undefined} {...rest}
      />
      {(error || hint) && <p id={msgId} className={error ? styles.error : styles.hint} role={error ? 'alert' : undefined}>{error ?? hint}</p>}
    </div>
  );
}
