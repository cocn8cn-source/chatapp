import { useId, type ComponentProps } from 'react';
import styles from './SelectField.module.css';

type Props = Omit<ComponentProps<'select'>, 'id'> & {
  label: string;
  hint?: string;
  options: { value: string; label: string }[];
};

export function SelectField({ label, hint, options, className, ...rest }: Props) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>{label}</label>
      <select id={id} className={`${styles.select} ${className ?? ''}`} {...rest}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}
