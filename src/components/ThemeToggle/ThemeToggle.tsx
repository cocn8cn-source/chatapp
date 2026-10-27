import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '@/stores/theme';
import styles from './ThemeToggle.module.css';

const options: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  return (
    <div role="radiogroup" aria-label="Appearance" className={styles.group}>
      {options.map(({ value, label, Icon }) => (
        <button
          key={value} type="button" role="radio" aria-checked={preference === value}
          className={styles.opt} onClick={() => setPreference(value)}
        >
          <Icon size={16} aria-hidden /> {label}
        </button>
      ))}
    </div>
  );
}
