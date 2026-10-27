import { Dialog } from '@/components/Dialog/Dialog';
import { ProfileView } from './ProfileView';

export function ProfileDialog({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!userId} onClose={onClose} title="Profile" hideTitle variant="sheet" size="sm">
      {userId && <ProfileView userId={userId} onClose={onClose} />}
    </Dialog>
  );
}
