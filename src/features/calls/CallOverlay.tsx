import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mic, MicOff, Phone, PhoneOff, Settings2, Video, VideoOff } from 'lucide-react';
import { Avatar } from '@/components/Avatar/Avatar';
import { fetchProfileCard, keys } from '@/features/chat/api';
import { formatDuration } from '@/features/chat/media/validation';
import { acceptIncoming, declineIncoming, hangUp, switchDevice, toggleCamera, toggleMute } from './callEngine';
import { endMessage } from './callMachine';
import { useCall } from './callStore';
import { startRing, stopRing } from './ringtone';
import styles from './Calls.module.css';

function Stream({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

function Devices() {
  const [list, setList] = useState<MediaDeviceInfo[]>([]);
  const load = () => navigator.mediaDevices.enumerateDevices().then(setList).catch(() => setList([]));
  const mics = list.filter((d) => d.kind === 'audioinput');
  const cams = list.filter((d) => d.kind === 'videoinput');
  return (
    <details className={styles.devices} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) void load(); }}>
      <summary className={styles.ctl} aria-label="Choose microphone and camera"><Settings2 size={22} aria-hidden /></summary>
      <div className={styles.devMenu}>
        <label>Microphone
          <select onChange={(e) => void switchDevice('audioinput', e.target.value)} defaultValue="">
            <option value="" disabled>Select…</option>{mics.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
          </select>
        </label>
        {cams.length > 0 && <label>Camera
          <select onChange={(e) => void switchDevice('videoinput', e.target.value)} defaultValue="">
            <option value="" disabled>Select…</option>{cams.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
          </select>
        </label>}
      </div>
    </details>
  );
}

export function CallOverlay() {
  const { machine: m, localStream, remoteStream, muted, cameraOff, connectedAt, notice, dispatch } = useCall();
  const peer = useQuery({ queryKey: keys.profileCard(m.peerId ?? ''), queryFn: () => fetchProfileCard(m.peerId!), enabled: !!m.peerId });
  const [elapsed, setElapsed] = useState(0);
  const name = peer.data?.display_name ?? 'Contact';
  const isVideo = m.kind === 'video';

  useEffect(() => {
    if (m.phase === 'incoming' || m.phase === 'outgoing') { startRing(); return stopRing; }
    stopRing();
  }, [m.phase]);
  useEffect(() => {
    if (m.phase !== 'connected' || !connectedAt) return;
    const update = () => setElapsed(Date.now() - connectedAt);
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [m.phase, connectedAt]);
  useEffect(() => {
    if (m.phase !== 'ended') return;
    if (['hangup', 'remote_hangup', 'cancelled', 'declined', 'rejected', 'no_answer'].includes(m.endReason ?? '')) {
      const t = window.setTimeout(() => dispatch({ type: 'RESET' }), 5000);
      return () => window.clearTimeout(t);
    }
  }, [m.phase, m.endReason, dispatch]);

  if (m.phase === 'idle') return null;

  if (m.phase === 'ended') {
    return (
      <div className={styles.scrim} role="dialog" aria-modal="true" aria-label="Call ended">
        <div className={styles.card}>
          <Avatar name={name} path={peer.data?.avatar_path} size={72} />
          <h2>{name}</h2>
          <p role="status">{endMessage(m.endReason, m.direction)}</p>
          <button className={styles.primary} onClick={() => dispatch({ type: 'RESET' })} autoFocus>Close</button>
        </div>
      </div>
    );
  }

  if (m.phase === 'incoming') {
    return (
      <div className={styles.scrim} role="alertdialog" aria-modal="true" aria-label={`Incoming ${m.kind} call from ${name}`}>
        <div className={styles.card}>
          <Avatar name={name} path={peer.data?.avatar_path} size={88} />
          <h2>{name}</h2>
          <p>Incoming {isVideo ? 'video' : 'voice'} call</p>
          {notice && <p className={styles.notice} role="alert">{notice}</p>}
          <div className={styles.row}>
            <button className={styles.decline} onClick={() => void declineIncoming()} aria-label="Decline call"><PhoneOff size={24} aria-hidden /><span>Decline</span></button>
            <button className={styles.accept} onClick={() => void acceptIncoming()} aria-label="Accept call" autoFocus>{isVideo ? <Video size={24} aria-hidden /> : <Phone size={24} aria-hidden />}<span>Accept</span></button>
          </div>
        </div>
      </div>
    );
  }

  const status = m.phase === 'outgoing' ? (m.callId ? 'Ringing…' : 'Calling…')
    : m.phase === 'connecting' ? 'Connecting…'
    : m.phase === 'reconnecting' ? 'Reconnecting…'
    : formatDuration(elapsed);
  const showRemoteVideo = isVideo && !!remoteStream && (m.phase === 'connected' || m.phase === 'reconnecting');

  return (
    <div className={styles.full} role="dialog" aria-modal="true" aria-label={`Call with ${name}`}>
      {/* always mounted so remote audio plays on voice calls too */}
      <Stream stream={remoteStream} className={showRemoteVideo ? styles.remote : styles.hiddenMedia} />
      {!showRemoteVideo && (
        <div className={styles.center}>
          <Avatar name={name} path={peer.data?.avatar_path} size={112} />
          <h2>{name}</h2>
        </div>
      )}
      <div className={styles.top}>
        {showRemoteVideo && <strong>{name}</strong>}
        <span role="timer" aria-live="polite">{status}</span>
        {notice && <span className={styles.notice} role="status">{notice}</span>}
      </div>
      {isVideo && localStream && !cameraOff && <Stream stream={localStream} muted className={styles.pip} />}
      <div className={styles.controls}>
        <button className={styles.ctl} aria-pressed={muted} onClick={toggleMute} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} disabled={!localStream}>
          {muted ? <MicOff size={22} aria-hidden /> : <Mic size={22} aria-hidden />}
        </button>
        {isVideo && (
          <button className={styles.ctl} aria-pressed={cameraOff} onClick={toggleCamera} aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'} disabled={!localStream}>
            {cameraOff ? <VideoOff size={22} aria-hidden /> : <Video size={22} aria-hidden />}
          </button>
        )}
        {localStream && <Devices />}
        <button className={styles.hang} onClick={() => void hangUp()} aria-label={m.phase === 'outgoing' ? 'Cancel call' : 'End call'} autoFocus><PhoneOff size={24} aria-hidden /></button>
      </div>
    </div>
  );
}
