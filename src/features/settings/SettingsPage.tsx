import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bell, Download, MessageCircle, Palette, ShieldCheck, Smartphone, UserRound,
} from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { fetchMyProfile, keys } from '@/features/chat/api';
import { Skeleton } from '@/components/Skeleton/Skeleton';
import { errorMessage, isMissingSchemaObject } from '@/lib/errors';
import { ProfileSettings } from './ProfileSettings';
import { AccountSettings } from './AccountSettings';
import { PrivacySettings } from './PrivacySettings';
import { NotificationsSettings } from './NotificationsSettings';
import { ChatSettings } from './ChatSettings';
import { AppearanceSettings } from './AppearanceSettings';
import { InstallSettings } from './InstallSettings';
import styles from './Settings.module.css';

const SECTIONS = [
  { id: 'profile', label: 'Profile', Icon: UserRound },
  { id: 'account', label: 'Account', Icon: Smartphone },
  { id: 'privacy', label: 'Privacy', Icon: ShieldCheck },
  { id: 'notifications', label: 'Notifications', Icon: Bell },
  { id: 'chats', label: 'Chats & media', Icon: MessageCircle },
  { id: 'appearance', label: 'Appearance', Icon: Palette },
  { id: 'install', label: 'Install app', Icon: Download },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

export function SettingsPage() {
  const session = useAuth((s) => s.session)!;
  const [params, setParams] = useSearchParams();
  const requested = params.get('section');
  const active: SectionId = SECTIONS.some((s) => s.id === requested) ? (requested as SectionId) : 'profile';
  const page = useRef<HTMLElement>(null);
  const profile = useQuery({ queryKey: keys.myProfile, queryFn: fetchMyProfile });

  useEffect(() => { page.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); }, [active]);
  useEffect(() => {
    if (!profile.data) return;
    document.documentElement.dataset.motion = profile.data.reduced_motion ? 'reduced' : 'full';
  }, [profile.data]);

  const choose = (id: SectionId) => setParams({ section: id }, { replace: true });

  return (
    <section className={styles.page} ref={page} aria-labelledby="settings-title">
      <div className={styles.wrap}>
        <header className={styles.head}>
          <h1 id="settings-title">Settings</h1>
          <p className={styles.lede}>Make ChatSpace yours: profile, privacy, notifications, media, appearance and installation.</p>
        </header>

        <nav className={styles.nav} aria-label="Settings sections">
          <span className={styles.navLabel}>Preferences</span>
          {SECTIONS.map(({ id, label, Icon }) => (
            <button key={id} type="button" onClick={() => choose(id)} aria-current={active === id ? 'page' : undefined}>
              <Icon size={17} aria-hidden /> {label}
            </button>
          ))}
          <div className={styles.navFoot}>
            <strong>Signed in</strong>
            <span>{session.user.email}</span>
          </div>
        </nav>

        <div className={styles.content}>
          {profile.isLoading && (
            <div className={styles.panel} aria-busy="true" aria-label="Loading settings">
              <div className={styles.panelBody}>
                <Skeleton width="35%" height="1.4rem" />
                <Skeleton height="3.25rem" />
                <Skeleton height="3.25rem" />
                <Skeleton width="55%" height="2.75rem" radius="var(--r-pill)" />
              </div>
            </div>
          )}
          {profile.isError && (
            <div className={styles.panel}>
              <div className={styles.panelBody}>
                <p className={styles.err} role="alert">Could not load your profile and settings.</p>
                <div className={styles.actions}>
                  <button className={styles.choice} onClick={() => profile.refetch()}>Try again</button>
                </div>
                {isMissingSchemaObject(profile.error)
                  ? <p className={styles.hint}>The database schema is out of date. Apply migrations 0001 → 0006 in the Supabase SQL Editor, then try again.</p>
                  : <p className={styles.hint}>{errorMessage(profile.error)}</p>}
              </div>
            </div>
          )}
          {profile.data && active === 'profile' && <ProfileSettings me={profile.data} />}
          {profile.data && active === 'account' && <AccountSettings email={session.user.email ?? ''} />}
          {profile.data && active === 'privacy' && (
            <PrivacySettings
              key={`${profile.data.avatar_visibility}-${profile.data.about_visibility}-${profile.data.online_visibility}-${profile.data.last_seen_visibility}-${profile.data.read_receipts}-${profile.data.who_can_message}`}
              me={profile.data}
            />
          )}
          {profile.data && active === 'notifications' && (
            <NotificationsSettings
              key={`${profile.data.notify_messages}-${profile.data.notify_calls}-${profile.data.notification_sound}`}
              me={profile.data}
            />
          )}
          {profile.data && active === 'chats' && (
            <ChatSettings
              key={`${profile.data.auto_download_images}-${profile.data.auto_download_videos}-${profile.data.enter_to_send}`}
              me={profile.data}
            />
          )}
          {profile.data && active === 'appearance' && <AppearanceSettings key={String(profile.data.reduced_motion)} me={profile.data} />}
          {active === 'install' && <InstallSettings />}
        </div>
      </div>
    </section>
  );
}
