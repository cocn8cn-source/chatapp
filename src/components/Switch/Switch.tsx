import { useId } from 'react';
import styles from './Switch.module.css';

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  loading?: boolean;
};

export function Switch({ checked, onChange, label, description, disabled, loading }: Props) {
  const labelId = useId();
  const descId = useId();
  return (
    <div className={styles.row}>
      <span className={styles.copy}>
        <span id={labelId} className={styles.label}>{label}</span>
        {description && <span id={descId} className={styles.desc}>{description}</span>}
      </span>
      <button
        type="button" role="switch" aria-checked={checked}
        aria-labelledby={labelId} aria-describedby={description ? descId : undefined}
        className={styles.switch} disabled={disabled || loading}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.thumb} aria-hidden />
        <span className="sr-only">{checked ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}
