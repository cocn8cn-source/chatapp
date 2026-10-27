import { useObjectUrl } from '@/lib/useObjectUrl';
import styles from './Avatar.module.css';

type Props = {
  name: string;
  path?: string | null;
  size?: number;
  bucket?: 'avatars' | 'group-photos';
  online?: boolean | null;
};

/** Avatars and group photos live in private buckets and are loaded with signed URLs. */
export function Avatar({ name, path, size = 44, bucket = 'avatars', online }: Props) {
  const url = useObjectUrl(bucket, path);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
  return (
    <span className={styles.wrap} style={{ width: size, height: size }}>
      <span className={`${styles.avatar} ${bucket === 'group-photos' ? styles.group : ''}`} style={{ fontSize: size * 0.38 }}>
        {url.data ? <img src={url.data} alt="" width={size} height={size} loading="lazy" /> : initials}
      </span>
      {online != null && (
        <span className={online ? styles.online : styles.offline} aria-hidden title={online ? 'Online' : 'Offline'} />
      )}
    </span>
  );
}
