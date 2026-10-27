# Calling setup

ChatSpace has two calling paths:

| Path | Transport | Server pieces |
|---|---|---|
| 1:1 voice/video | WebRTC peer connection + Supabase Realtime signalling | `calls`, `call_signals`, RPCs in `0004_calls.sql`, optional `ice-servers` Edge Function for TURN |
| Group voice/video | LiveKit SFU | `group_calls` RPCs in `0006_groups_notifications_calls.sql`, `livekit-token` Edge Function |

Calls require **HTTPS** (or `http://localhost`) and explicit microphone/camera permission. Nothing here is verified until you test with two signed-in accounts (and for group calls, a third participant).

---

## 1. One-to-one calls (WebRTC)

### Database
Run `supabase/migrations/0004_calls.sql` after `0001`–`0003`. It creates the call state, participants, RLS and the locked transitions:

- `start_call(cid, call_kind)` — rejects a peer who is already in a call
- `answer_call`, `reject_call`, `end_call`, `expire_call`

The browser only sends SDP/ICE candidates; it cannot write call status directly. The Realtime publication must include `calls` and `call_signals` (the migration adds both).

### TURN (recommended for real networks)
Without a relay, a call can connect on friendly networks and fail behind symmetric NAT, corporate firewalls or some mobile carriers. The app falls back to public STUN and shows an on-screen notice, and it refuses to pretend the call is connected.

The included `supabase/functions/ice-servers` function mints time-limited coturn credentials with HMAC:

```bash
supabase functions deploy ice-servers
supabase secrets set \
  TURN_URLS="turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp" \
  TURN_SECRET="<long random shared secret>"
```

Your coturn server must use `use-auth-secret` with the same `static-auth-secret`. Open UDP/TCP 3478 and TLS 5349 plus your relay port range. Hosted TURN providers work too — replace the credential request in `ice-servers/index.ts` with their API.

Without TURN the client still works, but the UI discloses the limitation (`No TURN relay is configured…`). Do not describe calls as relay-verified until TURN is configured and tested.

### Verify 1:1 calls
1. Two browsers (normal + private is fine), two accounts, same conversation.
2. Call → allow mic → the callee sees an incoming call; accept.
3. Check mute/unmute, camera toggle, device switching, timer, hang-up.
4. Reject, ignore until timeout (45s), and call a user who is already busy.
5. Deny microphone permission once and confirm the actionable error.
6. Blocked people must not be able to ring each other (RLS/RPC enforcement).

---

## 2. Group calls (LiveKit)

### Create a LiveKit project
Use LiveKit Cloud or a self-hosted LiveKit server. You need the WebSocket URL and an API key/secret.

### Deploy the token function
`supabase/functions/livekit-token` authenticates the Supabase user, confirms an **active** `group_calls` row through RLS, calls `join_group_call`, then mints a short-lived JWT for that room only. A user cannot join by guessing a room or call id.

```bash
supabase functions deploy livekit-token
supabase secrets set \
  LIVEKIT_URL="wss://your-project.livekit.cloud" \
  LIVEKIT_API_KEY="<key>" \
  LIVEKIT_API_SECRET="<secret>"
```

`supabase/functions/livekit-token/index.ts` also reads `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Supabase normally provides `SUPABASE_URL`; if your project does not inject the anon key into functions, set it too:

```bash
supabase secrets set SUPABASE_ANON_KEY="<publishable/anon key>"
```

Never expose `LIVEKIT_API_SECRET` in `.env`, the browser or a repository.

### What is implemented in the client
- Start a group voice or video call from a group chat.
- A live-call banner for other members, with a Join action.
- A single active call per group (database unique index).
- Participant grid, camera/mic mute, participant names, reconnect/ended states.
- Leaving the call keeps the room alive for others; the host can end it for everyone.
- Clear configuration errors when the function or secrets are missing — no fake “connected” state.

### Verify group calls
1. Three accounts in one group. Start a video call as account A.
2. Accounts B and C see the banner/notification and join.
3. Confirm each participant sees all cameras, can mute themselves, and audio playback is not blocked (use the “enable audio” control if the browser blocks autoplay).
4. Disconnect one client’s network briefly and confirm the reconnecting state.
5. Leave and re-join; confirm the participant list updates.
6. End the call as the host and confirm all clients exit and the banner disappears.
7. Confirm a non-member cannot mint a token for the call id (403).

---

## 3. Known limitations
- Calls are not end-to-end encrypted; WebRTC encrypts in transit (DTLS-SRTP), and LiveKit terminates media at the SFU.
- Group call recording, screen sharing, virtual backgrounds and dial-in are not implemented.
- Call quality depends on TURN/LiveKit capacity; nothing here has been load-tested.
