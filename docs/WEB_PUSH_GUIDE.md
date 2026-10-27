# Web push, step by step

Follow the parts **in order**. Each part ends with a check so you know it worked before moving on.

## How it works (30 seconds)

```
Someone sends you a message
   → a database trigger inserts a row in `notifications`
   → a Database Webhook calls the `send-push` Edge Function
   → `send-push` looks up your devices in `push_subscriptions`
   → it sends an encrypted push to Apple / Google / Mozilla
   → your phone or browser wakes `push-sw.js`, which shows the notification
```

Every arrow must work. If any one is missing, you get no notification. The parts below set up each arrow.

| Part | What it fixes |
|---|---|
| 1 | Deploy the new code (route fix + push fixes) |
| 2 | Database: fixes `column reference "endpoint" is ambiguous` |
| 3 | VAPID keys (the "ID card" that lets your server push) |
| 4 | Deploy the `send-push` function with its secrets |
| 5 | Database Webhook (the arrow from database → function) |
| 6 | Test on desktop |
| 7 | Test on iPhone |

---

## Part 1 — Deploy the code

1. Copy the new project files over your project (keep your own `.env`).
2. In the project folder run:
   ```bash
   npm install
   npm run build
   ```
   (`npm install`, not `npm ci`; the lock file is now in sync.)
3. Commit and push to GitHub. Vercel deploys automatically.
4. In **Vercel → your project → Settings → Environment Variables**, make sure these exist for *Production* (the app is built on Vercel, and `.env` is not uploaded):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_VAPID_PUBLIC_KEY` ← from Part 3
   
   If you add or change one, **Redeploy** (Deployments → ⋯ → Redeploy), because Vite bakes these into the build.

✅ **Check:** open `https://chatspace-alyas.vercel.app/app/settings` directly in a new tab. You should see the sign-in page (signed out) or Settings (signed in). You must **never** see Vercel's "404: NOT_FOUND". The new `vercel.json` makes that work.

---

## Part 2 — Fix the database function (this is the error in your screenshot)

> ⚠️ Run **only** `0007_fix_push_subscription_rpc.sql`. Do **not** run `setup-all.sql` on your live database: it deletes all data.

1. Supabase dashboard → **SQL Editor** → **New query**.
2. Open `supabase/migrations/0007_fix_push_subscription_rpc.sql`, copy everything, paste, press **Run**. It should say "Success".

✅ **Check:** run this; the text it returns must contain `ps.endpoint`:
```sql
select pg_get_functiondef('public.save_push_subscription(text,text,text,text)'::regprocedure);
```

---

## Part 3 — VAPID keys

VAPID keys are a pair: a **public** key (goes in the app) and a **private** key (stays secret on the server).

1. Generate a pair (once):
   ```bash
   npx web-push generate-vapid-keys
   ```
2. **Public key** → Vercel env var `VITE_VAPID_PUBLIC_KEY` (and your local `.env`).
3. **Both keys** → Supabase secrets (Part 4).
4. The private key must **never** be in `.env`, Vercel `VITE_*` variables, or Git. (Your current `.env` has a placeholder `VAPID_PRIVATE_KEY=YOUR_A…` line. Delete that line.)

> The public key in Vercel and the public key in Supabase **must be identical**, or push services answer `403`. If you ever generate new keys, update both places and have users turn notifications off and on again.

---

## Part 4 — Deploy `send-push`

From the project folder (Windows PowerShell is fine):

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
```
`<project-ref>` is the first part of your Supabase URL: `https://<project-ref>.supabase.co`.

Set the secrets (use your real values):
```bash
npx supabase secrets set VAPID_PUBLIC_KEY="<public key>" VAPID_PRIVATE_KEY="<private key>" VAPID_SUBJECT="mailto:you@your-real-email.com" PUSH_WEBHOOK_SECRET="<a long random string you invent>"
```
- `VAPID_SUBJECT` must be a **real** `mailto:` address or an `https://` URL. Apple rejects placeholders such as `example.com`.
- `PUSH_WEBHOOK_SECRET` is any long random text. You will paste the same text in Part 5.

Deploy **with JWT verification off** (the webhook proves who it is with the secret instead):
```bash
npx supabase functions deploy send-push --no-verify-jwt
```

✅ **Check:** this must answer `{"error":"unauthorized"}` (not 404, not "Invalid JWT"):
```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/send-push
```

---

## Part 5 — Database Webhook

Supabase dashboard → **Database → Webhooks → Create a new hook** (menu names can shift slightly between dashboard versions):

| Field | Value |
|---|---|
| Name | `send-push` |
| Table | `public.notifications` |
| Events | **Insert** only |
| Type | HTTP Request |
| Method | `POST` |
| URL | `https://<project-ref>.supabase.co/functions/v1/send-push` |
| Headers | `Content-Type: application/json` and `x-webhook-secret: <same PUSH_WEBHOOK_SECRET as Part 4>` |

Save it.

---

## Part 6 — Test on desktop (Chrome / Edge)

1. Open `https://chatspace-alyas.vercel.app`, sign in.
2. Hard-reload once (Ctrl+Shift+R). If a "new version is ready" bar appears, click **Reload**.
3. Click **Enable** on the notification banner (or Settings → Notifications → Enable notifications). Click **Allow**.
   - No error should appear now.
4. Confirm the device was saved. In Supabase SQL Editor:
   ```sql
   select user_id, left(endpoint, 40) as endpoint, user_agent, created_at from public.push_subscriptions;
   ```
   You should see one row with your browser's user agent.
5. Now the real test: sign in as a **second** account in another browser (or a private window) and send a message to the first account. Put the first account's tab in the background or minimise the browser. A system notification should appear. Click it: ChatSpace opens at that chat.

### If nothing arrives
1. **Did the notification row get created?**
   `select id, kind, title, pushed_at from public.notifications order by created_at desc limit 5;`
   - No row → the message trigger didn't fire (check that the chat isn't muted and the sender isn't blocked).
   - `pushed_at` stays empty → the webhook never reached the function (Part 5).
   - `pushed_at` filled → the function ran. Look at its log.
2. **Function log:** Dashboard → Edge Functions → `send-push` → **Logs**. The function now logs exactly why a delivery failed:

| You see | Meaning | Fix |
|---|---|---|
| `401` / `unauthorized` in the webhook log | Header secret doesn't match | Make `x-webhook-secret` equal `PUSH_WEBHOOK_SECRET` |
| `invalid VAPID configuration` | Bad `VAPID_SUBJECT` or keys | Use `mailto:real@email`; re-set the secrets |
| delivery failed … `403` / `401` | Public key in the app ≠ keys in Supabase | Make both public keys identical, redeploy Vercel, turn notifications off and on |
| `410` / `404` (silent: row removed) | The device unsubscribed or reinstalled | Turn notifications on again |
| `sent: 0` and no failures | No row in `push_subscriptions` for that user | Redo step 3–4 on the *receiving* account |

3. **Re-send an old notification by hand** (replace both placeholders):
   ```sql
   update public.notifications set pushed_at = null where id = '<notification id>';
   ```
   ```bash
   curl -X POST https://<project-ref>.supabase.co/functions/v1/send-push -H "Content-Type: application/json" -H "x-webhook-secret: <PUSH_WEBHOOK_SECRET>" -d '{"record":{"id":"<notification id>"}}'
   ```
   The answer tells you `sent`, `failed` and the reason.

---

## Part 7 — Test on iPhone / iPad

Requirements: **iOS/iPadOS 16.4 or newer**, and ChatSpace must be **installed on the Home Screen**. Web push does not work in a normal Safari tab, and in Chrome-on-iPhone you must still use Share → Add to Home Screen.

1. **Remove any old ChatSpace icon** (press and hold → Remove App → Delete). The old one remembered the old start page, and iOS only re-reads the settings when you add it again.
2. In **Safari**, open `https://chatspace-alyas.vercel.app`.
3. Tap **Share** → **Add to Home Screen** → **Add**. The icon now opens `https://chatspace-alyas.vercel.app/`.
4. **Close Safari.** Open ChatSpace from the new Home Screen icon and sign in.
   - Signed in: you land in your chats. Signed out: you see the welcome page. No "page not found".
5. Settings → Notifications → **Enable notifications** → tap **Allow** on the iOS prompt.
6. Send a message to this account from another account. Lock the phone or switch to another app: the notification should appear.

If you tapped **Don't Allow** by mistake, iOS won't ask again. Remove the icon and add it again (step 1–3), or go to iPhone Settings → Notifications → ChatSpace.

Other iOS notes:
- iPhone Settings → Notifications → **ChatSpace** must be on, and a Focus / Do Not Disturb mode can hide them.

---

## Why the Home Screen address was `/app/chats`

iOS stores the app's **start URL** from the web manifest when you add it. Yours said `/app/chats`, and Vercel had no rule for deep links, so opening it fresh could return Vercel's 404. Both are fixed:

- The manifest now starts at `/`.
- `vercel.json` sends every non-file URL to the app, which then redirects: signed in → `/app/chats`, signed out → welcome page (or `/login` for private pages, then back to the page you wanted).
