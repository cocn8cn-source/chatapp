# ChatSpace

A real-time messaging web app and installable PWA: private and group chats, replies, reactions, shared media, voice notes, one-to-one WebRTC calls, LiveKit group calls, notifications, privacy controls and a full settings area.

React 19 · Vite · TypeScript · CSS Modules · Supabase (Auth, Postgres, Realtime, Storage) · TanStack Query · Zustand · React Router · React Hook Form + Zod · Lucide · WebRTC · LiveKit · vite-plugin-pwa.

No Tailwind, Bootstrap, Next.js or custom application server.

> **Current state:** the application code is complete and the database is installed (`0001` → `0007`): signing in, conversations, sending, replies, reactions and attachments work against the live project. Typecheck, lint, the unit tests and the production build pass. Calls, TURN, LiveKit, email, push and the Edge Functions still need owner-supplied credentials, so those paths are implemented but unverified. Details are in [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Quick start

```bash
npm install --legacy-peer-deps
cp .env.example .env      # add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev               # http://localhost:5173
```

`--legacy-peer-deps` is required because `@hookform/resolvers` declares optional peer ranges that npm's strict resolver rejects.

### Environment

Only public values belong in `.env`; everything is baked into the browser bundle at build time:

| Variable | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | yes | Publishable/anon key (safe in the browser) |
| `VITE_APP_NAME` | no | Display name (default `ChatSpace`) |
| `VITE_VAPID_PUBLIC_KEY` | for push | Web Push application server key |
| `VITE_LIVEKIT_URL` | no | Informational LiveKit URL |

Service-role keys, VAPID **private** keys, TURN secrets and LiveKit API secrets must never appear in `.env` or in client code. They belong to Supabase Edge Function secrets.

## Database

**Fastest path (development project):** run `npm run db:setup`, then paste the generated [supabase/setup-all.sql](supabase/setup-all.sql) into the Supabase SQL Editor once. It resets the `public` schema and installs everything, so it also repairs a half-applied database. It deletes all app data — never run it on a database you care about.

Otherwise apply the migrations **in order** — either with the Supabase CLI (`supabase db push`) or by pasting each file into the SQL Editor:

1. `0001_profiles_chat_core.sql`
2. `0002_message_actions_and_organization.sql`
3. `0003_attachments_and_voice.sql`
4. `0004_calls.sql`
5. `0005_privacy_social_message_actions.sql`
6. `0006_groups_notifications_calls.sql`
7. `0007_fix_push_subscription_rpc.sql`

They create the profiles trigger, conversations and messages, attachments and storage buckets, 1:1 calls and signals, privacy/contacts/reactions/receipts/presence, groups, notifications and push subscriptions. `0001` also creates the `avatars` bucket; `0003` the private `chat-media` bucket; `0006` the `group-photos` bucket. Realtime publication entries are part of the same files.

Full instructions, verification steps and troubleshooting: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Edge Functions

| Function | Needed for |
|---|---|
| `link-preview` | Server-side, SSRF-guarded link previews |
| `ice-servers` | Time-limited TURN credentials for reliable 1:1 calls |
| `livekit-token` | Authorised group-call tokens |
| `send-push` | Web Push delivery from the notifications webhook |
| `delete-account` | Trusted deletion of account data and storage |

See [docs/CALLING_SETUP.md](docs/CALLING_SETUP.md) for TURN/LiveKit and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for secret names and webhook setup.

## Checks

```bash
npm run typecheck   # tsc -b --noEmit
npm run lint        # eslint .
npm test            # vitest run
npm run build       # tsc -b && vite build (emits dist/ with manifest + service worker)
```

## Project layout

```
src/
  app/            router
  components/     shared UI primitives (Button, Dialog, Avatar, Skeleton, …)
  features/
    auth/         login, register, password reset, route guard
    welcome/      onboarding page
    shell/        navigation shell
    chat/         inbox, thread, composer, media, search, dialogs
    calls/        1:1 WebRTC engine, group-call LiveKit overlay, history
    contacts/     people, requests, blocked users
    notifications/ in-app notifications and push opt-in
    presence/     heartbeat, last seen, online state
    profile/      profile pages, avatar cropper
    settings/     profile, account, privacy, notifications, media, appearance, install
    pwa/          install prompt, update prompt, offline banner
  lib/            Supabase client, query client, helpers
  stores/         Zustand stores (auth, theme, drafts)
  styles/         tokens.css and global.css
supabase/         migrations and Edge Functions
```

## Design

The visual system — ivory surfaces, the signature grid, charcoal rail, yellow actions and restrained pink/mint accents — is documented in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md). Styling is CSS Modules per component plus global tokens; there is no utility-CSS framework.

## Honest limitations

- No end-to-end encryption. Message content is readable by the Supabase project; 1:1 WebRTC media is DTLS-SRTP in transit, but LiveKit terminates group-call media at the SFU.
- TURN, LiveKit, transactional email and push delivery are **not** verified in this workspace; they need the owner's service credentials (see [docs/CALLING_SETUP.md](docs/CALLING_SETUP.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).
- No automated RLS or browser end-to-end tests, and no independent accessibility or security audit.
- Deleting a message hides attachments but does not delete the underlying Storage bytes; cancelled uploads can leave orphaned objects.
