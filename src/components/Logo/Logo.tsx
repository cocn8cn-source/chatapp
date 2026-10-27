import { useSyncExternalStore } from 'react';
import styles from './Logo.module.css';

/**
 * The supplied brand mark comes in two renders: a white bubble for dark surfaces and a
 * black bubble for light ones. The resolved theme already lives on <html data-theme> (set
 * before first paint by index.html), so the mark follows it without a flash and without
 * coupling the component to the settings store.
 */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const query = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
  query?.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    query?.removeEventListener('change', onChange);
  };
}

const isDark = () => document.documentElement.dataset.theme === 'dark';

export function Logo({ size = 32, tone = 'auto', className }: {
  size?: number;
  /** `dark` forces the white mark for surfaces that stay charcoal in both themes. */
  tone?: 'auto' | 'dark';
  className?: string;
}) {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  const white = tone === 'dark' || dark;
  return (
    <img
      className={`${styles.logo} ${className ?? ''}`}
      src={white ? '/brand/logo-white.png' : '/brand/logo-black.png'}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
    />
  );
}
