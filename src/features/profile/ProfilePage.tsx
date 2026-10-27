import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ProfileView } from './ProfileView';
import styles from './ProfilePage.module.css';

export function ProfilePage() {
  const { userId } = useParams();
  if (!userId) {
    return (
      <section className={styles.page}>
        <p className={styles.err}>No profile was selected.</p>
        <Link to="/app/people" className={styles.back}><ArrowLeft size={16} aria-hidden /> Back to People</Link>
      </section>
    );
  }
  return (
    <section className={styles.page} aria-labelledby="profile-title">
      <Link to="/app/people" className={styles.back}><ArrowLeft size={16} aria-hidden /> Back to People</Link>
      <div className={styles.card}>
        <h1 id="profile-title" className={styles.eyebrow}>Profile</h1>
        <ProfileView userId={userId} />
      </div>
    </section>
  );
}
