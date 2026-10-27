import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, MonitorPlay, PhoneOff, Settings2, Users, Video, VideoOff, Volume2 } from 'lucide-react';
import type { Participant } from 'livekit-client';
import { Track } from 'livekit-client';
import { supabase } from '@/lib/supabase';
import { createChannel } from '@/lib/realtime';
import { useAuth } from '@/stores/auth';
import { formatDuration } from '@/features/chat/media/validation';
import {
  dismissGroupCallNotice, enableGroupAudio, endGroupCall, groupCallElapsed, leaveGroupCall,
  switchGroupDevice, toggleGroupCamera, toggleGroupMute,
} from './groupCall';
import { useGroupCall } from './groupCallStore';
import styles from './GroupCall.module.css';

function Avatar({ name }: { name: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
  return <span className={styles.avatar} aria-hidden>{initials}</span>;
}

function VideoTrack({ participant, muted }: { participant: Participant; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const version = useGroupCall((s) => s.version);
  useEffect(() => {
    const el = ref.current;
    const pub = participant.getTrackPublication(Track.Source.Camera);
    const track = pub?.videoTrack;
    if (!el || !track) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [participant, version]);
  return <video ref={ref} className={styles.video} autoPlay playsInline muted={muted} />;
}

function AudioTrack({ participant }: { participant: Participant }) {
  const ref = useRef<HTMLAudioElement>(null);
  const version = useGroupCall((s) => s.version);
  useEffect(() => {
    const el = ref.current;
    const track = participant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
    if (!el || !track) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [participant, version]);
  return <audio ref={ref} autoPlay />;
}

function Tile({ participant, local }: { participant: Participant; local: boolean }) {
  const name = participant.name || participant.identity || 'Guest';
  const hasVideo = participant.isCameraEnabled;
  return (
    <div className={`${styles.tile} ${participant.isSpeaking ? styles.speaking : ''} ${local ? styles.local : ''}`}>
      {hasVideo ? <VideoTrack participant={participant} muted={local} /> : <div className={styles.avatarWrap}><Avatar name={name} /></div>}
      {!local && <AudioTrack participant={participant} />}
      <span className={styles.name}>{name}{local ? ' (you)' : ''}</span>
      <span className={styles.mic} aria-label={participant.isMicrophoneEnabled ? 'Microphone on' : 'Muted'}>
        {participant.isMicrophoneEnabled ? <Mic size={13} aria-hidden /> : <MicOff size={13} aria-hidden />}
      </span>
      <span className="sr-only" aria-live="polite">{participant.isSpeaking ? `${name} is speaking` : ''}</span>
    </div>
  );
}

function Devices() {
  const [list, setList] = useState<MediaDeviceInfo[]>([]);
  const load = () => navigator.mediaDevices.enumerateDevices().then(setList).catch(() => setList([]));
  const mics = list.filter((d) => d.kind === 'audioinput');
  const cams = list.filter((d) => d.kind === 'videoinput');
  return (
    <details className={styles.devices} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) void load(); }}>
      <summary className={styles.control} aria-label="Choose microphone and camera"><Settings2 size={22} aria-hidden /></summary>
      <div className={styles.devicesMenu}>
        <label>Microphone
          <select onChange={(e) => void switchGroupDevice('audioinput', e.target.value)} defaultValue="">
            <option value="" disabled>Select…</option>
            {mics.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
          </select>
        </label>
        {cams.length > 0 && <label>Camera
          <select onChange={(e) => void switchGroupDevice('videoinput', e.target.value)} defaultValue="">
            <option value="" disabled>Select…</option>
            {cams.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
          </select>
        </label>}
      </div>
    </details>
  );
}

export function GroupCallOverlay() {
  const { status, room, title, error, canEnd, muted, cameraOff, audioBlocked, call } = useGroupCall();
  const uid = useAuth((s) => s.session?.user.id);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (status !== 'connected') return;
    const update = () => setElapsed(groupCallElapsed());
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [status]);

  // When the host ends the call, every participant leaves the LiveKit room too.
  useEffect(() => {
    if (!supabase || !call?.id || status === 'idle') return;
    const channel = createChannel(`group-call-status:${call.id}`);
    if (!channel) return;
    channel
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_calls', filter: `id=eq.${call.id}` }, (p) => {
        if ((p.new as { status?: string }).status === 'ended') {
          room?.disconnect();
          useGroupCall.setState({ status: 'ended', room: null, error: 'The host ended the call.' });
        }
      })
      .subscribe();
    return () => { void supabase!.removeChannel(channel); };
  }, [call?.id, status, room]);

  if (status === 'idle') return null;

  if (status === 'error' || status === 'ended') {
    return (
      <div className={styles.scrim} role="dialog" aria-modal="true" aria-label={status === 'error' ? 'Group call error' : 'Group call ended'}>
        <div className={styles.errorCard}>
          <span className={styles.errorIcon}><PhoneOff size={26} aria-hidden /></span>
          <h2>{status === 'error' ? 'Group call unavailable' : 'Group call ended'}</h2>
          <p role="status">{error ?? 'The call has ended.'}</p>
          <button className={styles.primary} onClick={dismissGroupCallNotice}>Close</button>
        </div>
      </div>
    );
  }

  if (status === 'connecting' || !room) {
    return (
      <div className={styles.scrim} role="dialog" aria-modal="true" aria-label="Connecting group call">
        <div className={styles.errorCard}>
          <span className={styles.pulse} aria-hidden />
          <h2>{title}</h2>
          <p role="status">Connecting to the group call…</p>
          <button className={styles.secondary} onClick={leaveGroupCall}>Cancel</button>
        </div>
      </div>
    );
  }

  const participants = [room.localParticipant, ...room.remoteParticipants.values()];
  const isVideo = call?.kind === 'video';

  return (
    <div className={styles.full} role="dialog" aria-modal="true" aria-label={`Group call: ${title}`}>
      <header className={styles.head}>
        <span className={styles.groupIcon}><Users size={18} aria-hidden /></span>
        <div>
          <strong>{title}</strong>
          <span>{participants.length} {participants.length === 1 ? 'person' : 'people'} · {status === 'reconnecting' ? 'Reconnecting…' : formatDuration(elapsed)}</span>
        </div>
        {status === 'reconnecting' && <span className={styles.reconnect} role="status">Reconnecting…</span>}
      </header>

      {audioBlocked && (
        <button className={styles.audioNotice} onClick={() => void enableGroupAudio()}>
          <Volume2 size={16} aria-hidden /> Tap to enable call audio
        </button>
      )}

      <div className={styles.grid} data-count={participants.length}>
        {participants.map((p) => <Tile key={p.identity} participant={p} local={p.identity === uid || p === room.localParticipant} />)}
      </div>

      <div className={styles.controls}>
        <button className={styles.control} data-off={muted} aria-pressed={muted} onClick={() => void toggleGroupMute()}
          aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>
          {muted ? <MicOff size={22} aria-hidden /> : <Mic size={22} aria-hidden />}
        </button>
        {isVideo && (
          <button className={styles.control} data-off={cameraOff} aria-pressed={cameraOff} onClick={() => void toggleGroupCamera()}
            aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}>
            {cameraOff ? <VideoOff size={22} aria-hidden /> : <Video size={22} aria-hidden />}
          </button>
        )}
        <Devices />
        {canEnd ? (
          <button className={styles.end} onClick={() => void endGroupCall()} aria-label="End call for everyone">
            <PhoneOff size={24} aria-hidden /><span>End</span>
          </button>
        ) : (
          <button className={styles.end} onClick={leaveGroupCall} aria-label="Leave call">
            <PhoneOff size={24} aria-hidden /><span>Leave</span>
          </button>
        )}
      </div>
      <p className={styles.footnote}><MonitorPlay size={12} aria-hidden /> Group media is carried by the configured LiveKit server.</p>
    </div>
  );
}
