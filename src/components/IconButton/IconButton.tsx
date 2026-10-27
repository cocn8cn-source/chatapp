import type { ButtonHTMLAttributes } from 'react';
import styles from './IconButton.module.css';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  tone?: 'default' | 'dark' | 'danger' | 'accent';
  size?: 'sm' | 'md';
};

export function IconButton({ label, active, tone = 'default', size = 'md', className, children, ...rest }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={[styles.btn, styles[tone], size === 'sm' ? styles.sm : '', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
