# ChatSpace deployment and operations

Everything in this document is configuration the owner must supply. None of the external services are pre-provisioned, and no credentials belong in the repository.

## 1. Prerequisites

- Node.js 20+ and npm.
- A Supabase project (Postgres, Auth, Realtime, Storage).
- Optional: a TURN server or hosted TURN, a LiveKit project, VAPID keys for web push.
- A static host with HTTPS for the Vite build (`dist/`).

## 2. Local setup

```bash
npm install
cp .env.example .env
# edit .env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run dev
```

Open `http://localhost:5173`. Vite reads `.env` at start/build time; restart after changing it. If npm reports peer dependency conflicts, `npm install --legacy-peer-deps` is the supported fallback (the optional peer range of `@hookform/resolvers` is the usual cause).

### Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## 3. Database

For a development project, the quickest reliable option is one paste: run `npm run db:setup`, open [supabase/setup-all.sql](../supabase/setup-all.sql) and run the whole file in the SQL Editor. It drops the `public` schema and re-installs every object, so it also recovers a half-applied database; it deletes all app data, and it re-creates `profiles`/`user_settings` rows for existing accounts at the end.

To apply them incrementally instead, use the Supabase CLI:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

or by pasting each file into Supabase → SQL Editor:

| File | Creates |
|---|---|
| `0001_profiles_chat_core.sql` | Profiles trigger on signup, conversations/members/messages, direct-chat RPC, avatars bucket |
| `0002_message_actions_and_organization.sql` | Edit/delete RPCs and triggers, unread counts, message search, member pin/archive/mute preferences |
| `0003_attachments_and_voice.sql` | Attachments table, private `chat-media` bucket, per-user quota, signed-access helpers |
| `0004_calls.sql` | 1:1 call state, signals, RLS and locked call RPCs |
| `0005_privacy_social_message_actions.sql` | Settings, contacts, blocks, reports, privacy helpers, receipts, reactions, pins, stars, typing, presence |
| `0006_groups_notifications_calls.sql` | Groups and roles, group calls, notifications, push subscriptions, call history |
| `0007_fix_push_subscription_rpc.sql` | Fixes `column reference "endpoint" is ambiguous` in `save_push_subscription` (web push could never register a device without it) |

Migrations create the storage buckets and add tables to the `supabase_realtime` publication. Do not create the buckets manually; their names are:

- `avatars` — private, 2 MB, JPEG/PNG/WebP
- `chat-media` — private, 25 MB, explicit MIME allowlist
- `group-photos` — private, 2 MB, JPEG/PNG/WebP

If a migration fails because an older object already exists, inspect the actual database state rather than blindly re-running a partial file. Migrations are the source of truth; do not hand-edit policies in production without adding a new migration.

The SQL Editor executes a pasted file as several statements, so a file that fails half-way can leave the schema partially applied and impossible to re-run. On a development project with no data you want to keep:

1. Run [`supabase/reset-dev.sql`](../supabase/reset-dev.sql) — destructive, drops the `public` schema only (auth users and storage objects survive).
2. Apply `0001` → `0007` again in order.
3. Run [`supabase/backfill-profiles.sql`](../supabase/backfill-profiles.sql) so accounts that existed before the reset get their `profiles` and `user_settings` rows back, or sign up again with a fresh account.

`supabase db push` wraps each migration in a transaction and records it in `supabase_migrations.schema_migrations`, so prefer it over pasting files when you can link the CLI.

### Verify the schema
After applying migrations:

1. Sign up a test user. A `profiles` row and `user_settings` row must be created automatically.
2. Confirm `select * from storage.buckets;` lists all three buckets.
3. Confirm `select tablename from pg_publication_tables where pubname = 'supabase_realtime';` includes messages, reactions, receipts, typing, calls, group calls and notifications.
4. Use two accounts to create a chat and send one message before building on top of it.

## 4. Authentication

Supabase → Authentication → URL Configuration:

- **Site URL:** `https://your-app.example.com` (use `http://localhost:5173` while developing).
- **Additional Redirect URLs:** `https://your-app.example.com/**` (and `http://localhost:5173/**` locally).

Supabase uses these for:

- signup confirmation (`emailRedirectTo` → `/login`)
- password recovery (`redirectTo` → `/reset-password`)
- email change confirmation (both old and new address)

Enable **Confirm email** for production. Customize the confirmation, recovery and email-change templates in the Supabase dashboard; the default links work, but the copy should match your brand. Configure a custom SMTP provider for production; the shared mailer is rate-limited and not intended for real traffic.

### Google OAuth
Google sign-in is **not implemented** in the current UI. The app supports email/password only. Adding it later requires `signInWithOAuth({ provider: 'google' })`, enabling the provider in Supabase, and adding the callback URL; do not show a Google button before that works.

### Account deletion and email change
- Email change uses `supabase.auth.updateUser({ email })` and requires both confirmations.
- Account deletion calls the `delete-account` Edge Function, which verifies the authenticated user, hands over or deletes groups with no other admin, removes storage objects, then deletes the auth user with the service role.
- Deploy it before exposing the delete-account screen:

```bash
supabase functions deploy delete-account
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are normally injected into Edge Functions. If your project does not inject them, set them as function secrets; never put them in `.env` or the browser.

## 5. Edge Functions

| Function | Purpose | Secrets |
|---|---|---|
| `ice-servers` | Mints time-limited coturn credentials | `TURN_URLS`, `TURN_SECRET` |
| `livekit-token` | Authorises and mints a LiveKit room JWT | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, possibly `SUPABASE_ANON_KEY` |
| `link-preview` | Server-side link preview fetcher with SSRF/DNS safeguards | none |
| `send-push` | Sends one web push message for a notification row | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_WEBHOOK_SECRET`, plus service role access |
| `delete-account` | Deletes the caller’s data and auth account | platform service role |

Deploy after the database is ready:

```bash
supabase functions deploy ice-servers
supabase functions deploy livekit-token
supabase functions deploy link-preview
supabase functions deploy send-push
supabase functions deploy delete-account
```

Edge Functions use `verify_jwt` for user-invoked functions. `send-push` is called by the database webhook, which authenticates with the `x-webhook-secret` header (`PUSH_WEBHOOK_SECRET`) rather than a user JWT. Deploy it with `supabase functions deploy send-push --no-verify-jwt`: projects on the newer `sb_publishable_…` keys have no JWT to send, so the gateway would otherwise reject every webhook call.

Link previews fail closed if the function is not deployed; the message still sends and the link remains clickable.

## 6. Web push notifications

> **Beginner-friendly walk-through with checks and troubleshooting: [WEB_PUSH_GUIDE.md](./WEB_PUSH_GUIDE.md).** The summary below is the reference.

1. Generate VAPID keys:
   ```bash
   npx web-push generate-vapid-keys
   ```
2. Put the **public** key in `.env` as `VITE_VAPID_PUBLIC_KEY` and rebuild/restart.
3. Set the function secrets:
   ```bash
   supabase secrets set \
     VAPID_PUBLIC_KEY="<public>" \
     VAPID_PRIVATE_KEY="<private>" \
     VAPID_SUBJECT="mailto:you@example.com" \
     PUSH_WEBHOOK_SECRET="<long random string>"
   ```
4. Deploy `send-push` with `--no-verify-jwt` (see above). `VAPID_SUBJECT` must be a real `mailto:` address or `https://` URL; Apple's push service rejects placeholders.
5. Supabase → Database → Webhooks → create a webhook:
   - table: `public.notifications`
   - event: `INSERT`
   - type: HTTP request
   - URL: `https://<project-ref>.supabase.co/functions/v1/send-push`
   - method: POST
   - header: `x-webhook-secret: <the same PUSH_WEBHOOK_SECRET>`
   - payload: include the inserted record.

The notifications row is created and deduplicated by database triggers in `0006`. `send-push` respects `notify_messages`/`notify_calls`, marks `pushed_at`, and removes expired subscriptions (404/410). Muted chats are excluded before notifications are inserted; blocks and privacy settings are enforced in the same trigger path.

### Platform limitations
- Desktop Chrome/Edge/Firefox and Android Chrome support web push in browser tabs, but installation generally improves reliability.
- On iOS/iPadOS, web push requires iOS 16.4+ and the app **added to the Home Screen**. Safari in an ordinary tab cannot receive it. iOS reads the manifest `start_url` (now `/`) when the icon is added, so remove and re-add an icon created from an older build.
- Notification permission is requested from a clear user action, never automatically on first load.
- The service worker does not cache private messages, API responses or media.

## 7. Calls

See [`docs/CALLING_SETUP.md`](./CALLING_SETUP.md) for TURN, LiveKit, secrets and end-to-end verification. Without those secrets the UI reports that calling is not configured and never simulates a connected call.

## 8. Production build and hosting

```bash
npm run build
```

Upload **`dist/`** to any static host with HTTPS (Cloudflare Pages, Netlify, Vercel static, S3 + CDN, Nginx). Requirements:

- SPA fallback: unknown paths return `index.html` so `/app/chats/...` deep links work. On Vercel this is `vercel.json` (included): without it every deep link or Home Screen launch returns Vercel's `404: NOT_FOUND`. On Netlify/Cloudflare Pages use `/* /index.html 200` / the equivalent.
- HTTPS is mandatory for service workers, camera/microphone and WebRTC.
- Serve `.webmanifest` as `application/manifest+json` if your host does not infer it.
- Vite env vars are baked into the bundle at build time. Changing Supabase, VAPID or LiveKit public values requires a new build.
- Do not upload `.env`, source maps or Supabase service-role keys.

A reasonable Content-Security-Policy must allow:

- `connect-src` your Supabase project (`https://*.supabase.co`, `wss://*.supabase.co`) and your LiveKit host (`wss://...`)
- `img-src 'self' data: blob: https:` for avatars, previews and uploaded private media
- `media-src 'self' blob:` for voice notes and call video
- `worker-src 'self'` for the generated service worker

### PWA
The build generates `sw.js`, the Workbox runtime and `manifest.webmanifest` with 192/512 icons plus maskable variants. The update prompt never force-reloads; drafts remain on the device. Installation produces a web app, not an IPA/APK:

- **Android Chrome:** menu → Install app / Add to Home screen.
- **iOS Safari:** Share → Add to Home Screen. Open the installed app from the new icon to allow push (16.4+). The icon opens the site root `/`; signed-in users are redirected to `/app/chats`.
- **Desktop:** install icon in the address bar or browser menu.

## 9. Backups and recovery

- Enable Supabase automated backups (and PITR on a plan that supports it). Test a restore into a staging project before you need it.
- Database backups do **not** include Storage objects. Back up the `avatars`, `chat-media` and `group-photos` buckets separately, or keep a versioned storage copy.
- Export Edge Function source and secrets from a secure password manager; secrets are not recoverable from the dashboard after deletion.
- Document retention: deleting an account removes the auth user and its storage objects; deleting a message wipes the body/attachments for everyone, but orphaned files from cancelled uploads are not yet garbage-collected.
- Rotate VAPID, TURN and LiveKit credentials if they are exposed. Rotating VAPID invalidates existing push subscriptions; users must re-enable notifications.

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| “Supabase is not configured” | `.env` missing/renamed; restart Vite or rebuild. Only `VITE_*` values reach the browser. |
| Signup succeeds but no profile | Migration `0001` not applied, or the `handle_new_user` trigger is missing. |
| “Could not check the username” | `username_available` RPC missing → apply `0001`. |
| Chats, People or Settings say the database schema is out of date; PostgREST returns `PGRST202` for `my_conversations`, `my_profile`, `presence_heartbeat` or `call_history` | Migrations are missing or only partially applied. Do not paste individual statements from the middle of a file. On a development project with no user data, reset the database and run `0001` → `0007` in order; otherwise compare the live objects with the migrations before adding a corrective migration. |
| Some tables exist but their RPCs return 404 | The schema was applied from an older/reordered version of the migrations. Rebuild it from the current files rather than mixing versions. |
| Everything loads but chats are empty | RLS is working; the user may have no conversations. Create one with a second account. |
| Messages do not arrive live | Realtime publication missing the table, or the channel is not authorised. Re-check the migration’s `alter publication` lines. |
| Uploads fail | Run `0003`; confirm the private `chat-media` bucket and the storage policies exist; check the 25 MB / 500 MB limits. |
| Avatar shows initials only | `0005` made `avatars` private. Signed URLs require the storage select policy; re-run `0005` and confirm. |
| Calls connect only on the same network | No TURN relay. Configure `ice-servers` and test again. |
| Group call says not configured | Deploy `livekit-token`, set LiveKit secrets, and confirm there is an active `group_calls` row. |
| Enabling notifications shows `column reference "endpoint" is ambiguous` | Migration `0007` is not applied. Run only `0007_fix_push_subscription_rpc.sql` in the SQL Editor. |
| Push never arrives | Follow [WEB_PUSH_GUIDE.md](./WEB_PUSH_GUIDE.md) → "If nothing arrives". Check permission, VAPID public key at build time (Vercel env + redeploy), `send-push` deployment (`--no-verify-jwt`), the webhook header, and the function logs. On iOS, install to the Home Screen. |
| Vercel shows `404: NOT_FOUND` on `/app/...` or when launching the installed app | `vercel.json` is missing from the deployed commit. |
| Service worker serves an old build | The app offers a reload prompt by design. Clear site data only if the prompt is stuck; never silently skip waiting. |
| 401/403 from an Edge Function | JWT not forwarded, or the caller is not a conversation member. Inspect function logs; do not disable RLS. |

## 11. Security notes

- RLS is enabled on every private table; storage buckets are private and object access is checked by SQL helpers.
- The client never sends a trusted user id for authorisation; policies use `auth.uid()`.
- Service-role keys, VAPID private keys, TURN secrets and LiveKit secrets stay in Supabase secrets.
- Chat content is **not** end-to-end encrypted. Supabase, its backups and the LiveKit SFU can access it. Do not claim E2EE.
- Rate limiting is provided at the database/RPC and Edge Function level where implemented; add a CDN/WAF rate limit for production abuse resistance.
- This project has not had an independent security audit. Review the RLS policies and Edge Functions before handling sensitive real-world conversations.
