# ChatSpace design system

ChatSpace uses an original editorial, geometric messaging identity: warm paper surfaces, a subtle square grid, confident charcoal typography, yellow for primary actions, rounded charcoal navigation and restrained pink/mint accents. It deliberately borrows the *character* of the supplied reference without copying its content, layout or branding.

The reference image (`reference/design-reference.png`) was **not present** in the workspace during implementation or final QA. The visual direction below is based on the written design brief and is applied consistently in code.

Source of truth: `src/styles/tokens.css` for global tokens, `src/styles/global.css` for resets/utilities, and one CSS Module per component. Do not hardcode hex colours, arbitrary radii or one-off spacing in feature code.

---

## 1. Colour

### Base palette

| Token | Value | Use |
|---|---|---|
| `--c-ivory` | `#FAF9F0` | app background, light theme |
| `--c-charcoal` | `#1D1D1D` | primary text, dark surfaces, call UI |
| `--c-yellow` | `#FFD000` | primary actions, selected states, highlights |
| `--c-pink` | `#F0B5D0` | rare decorative/illustration accent |
| `--c-mint` | `#39C988` | online presence, recording/audio accent |
| `--c-white` | `#FFFFFF` | selected surfaces, incoming message bubbles |

### Semantic tokens (light theme)
`--bg`, `--surface`, `--surface-2`, `--surface-raised`, `--chat-canvas`, `--text`, `--text-muted`, `--border`, `--border-strong`, `--grid-line`, `--accent`, `--accent-soft`, `--on-accent`, `--inverse`, `--on-inverse`, `--rail-bg`, `--rail-text`, `--rail-muted`, `--rail-active`, `--bubble-in`, `--bubble-out`, `--r-bubble`, `--r-bubble-tail`, `--pink-soft`, `--mint-soft`, `--success`, `--warning`, `--error`, `--info`, `--online`, `--focus`, `--hover`, `--pressed`, `--disabled-bg`, `--disabled-text`, `--overlay`, `--bubble-shadow`.

Semantic statuses are never communicated by colour alone:
- sent/read uses a check glyph plus the word “Seen” on the latest own message;
- online presence pairs a dot with text in the header and `aria-label`s on list rows;
- unread badges always carry a numeric value and accessible label;
- errors are text (`role="alert"`), not only red;
- muted/archived/pinned add a Lucide icon, not just a tint.

### Dark theme
`data-theme="dark"` on `<html>` swaps the complete token set (`#141411` background, layered warm-charcoal surfaces, softened bubbles, dark-aware status colours). It is **not** a CSS inversion. Rail, dialogs, composers, inputs, bubbles, calls, notifications, settings and illustration accents each have dark values. The inline script in `index.html` applies the saved/system theme before first paint to avoid a flash.

### Rules
- Yellow appears on the primary action, selected navigation, unread counts and highlight moments — not on every control.
- Charcoal is used for strong brand surfaces (rail, auth aside, call controls) and text.
- Pink and mint are small contextual accents; they never become the dominant surface in a working screen.
- Link previews and signed media retain neutral surfaces so message text remains the focus.

---

## 2. The signature grid

`.grid-surface` draws a 28px grid with two CSS `linear-gradient`s (`--grid-line`), no background images. `.grid-surface--large` uses 44px cells for the welcome/auth backdrop.

Used on:
- welcome page background;
- auth page background;
- empty conversation canvas;
- empty inbox illustration areas (through the illustration/empty-state surfaces).

Never used behind message lists, composers, forms or dense settings panels. It is always low contrast and scrolls with the page (no fixed/parallax layer).

---

## 3. Typography

- Family: **Outfit Variable**, bundled via `@fontsource-variable/outfit` (no network font dependency).
- Display: `--fs-display: clamp(2.75rem, 7vw, 5.25rem)`, weight 800, tracking -0.04em, line-height 1.02. Used on the welcome headline.
- H1: `--fs-h1: clamp(1.75rem, 4vw, 2.75rem)` — page and auth titles.
- H2: `1.375rem` — panel and group names.
- H3: `1.0625rem` — conversation names, subheads.
- Body: `0.9375rem`, line-height 1.5 — message text.
- Small: `0.8125rem` — previews, hints, list metadata.
- Meta: `0.75rem` — timestamps, eyebrows, keyboard hints.

Rules:
- Message text is never bold by default; sender names and primary actions carry weight.
- Timestamps are muted and smaller than message content.
- Long words and URLs use `overflow-wrap: anywhere`; conversation names and previews ellipsize.
- Mobile keeps at least 15px body/message text and at least 12px metadata.

---

## 4. Spacing, radii, sizing and motion

- Spacing scale: `--s-1` 4px → `--s-8` 72px. Layouts use the scale rather than magic numbers.
- Radii: `--r-xs` 6px, `--r-sm` 8px, `--r-md` 14px, `--r-lg` 22px, `--r-xl` 32px, `--r-pill` 999px.
- Borders: `--bw: 1.5px`; strong borders for inputs, secondary buttons and call controls.
- Controls: `--h-control` 44px, `--h-control-lg` 52px, `--h-control-sm` 36px, `--hit` 44px minimum.
- Layout: rail `--rail-w` 5.5rem; conversation list `--list-w` 23.5rem; message column max 56rem; settings max 72rem.
- Motion: `--dur-fast` 120ms and `--dur` 200ms with `cubic-bezier(.2,0,0,1)`. Only opacity/transform/background/height transitions. No parallax, no background animation, no decorative blur layers.
- `prefers-reduced-motion` and the saved `reduced_motion` preference both collapse animation/transition durations and disable smooth scrolling.

---

## 5. Components

### Buttons
- Primary: yellow fill, charcoal text, 1.5px charcoal border, pill radius, 44px height.
- Secondary: surface fill, strong border.
- Dark: charcoal/ivory inverse, used on yellow or light surfaces.
- Danger: error fill for destructive confirmation.
- Ghost: text/icon actions with hover surface.
- Loading buttons keep width, disable duplicate submission and show a spinner; disabled uses the disabled tokens.
- All have hover, active (1px press), focus-visible ring and disabled states.

### Icon buttons
44×44px circular/rounded hit area, Lucide icon at 17–21px, `aria-label` required, active state for toggles.

### Inputs and forms
`TextField` and `SelectField` use the shared surface, strong border, `--r-md`, visible label, optional hint and inline error with `aria-invalid`/`aria-describedby`. Inputs use the page font, never browser defaults. Forms are React Hook Form + Zod, disable double submits and show both field-level and form-level errors.

### Cards and panels
Settings use bordered panels with a header divider and 20px internal padding. No drop shadow on ordinary panels; elevation is reserved for menus, dialogs and the welcome product card.

### Dialogs and menus
Native `<dialog>`-based `Dialog` with a title, optional description, capped `max-height`, internal scrolling, close control, focus handling and Escape. Sheets are used for message actions on mobile. Confirmation dialogs are explicit about destructive scope and use a danger button.

### Avatars
Circular, 24–72px, signed private URLs with initials fallback, optional presence dot. Group avatars use a slightly different tint/ring. Presence dots are `aria-hidden` where an adjacent text label exists.

### Message bubbles
- Shape: `--r-bubble` (18px) with a 5px `--r-bubble-tail` corner on the sender’s side. No outline — separation comes from the soft `--bubble-shadow`, so a screen of bubbles stays calm instead of reading as a grid of boxes.
- Incoming: `--bubble-in` (white; `#23231E` in dark). Outgoing: warm yellow-cream `--bubble-out` (`#3A3315` in dark).
- Max width 84% (86% mobile) inside a 54rem message column; the composer uses the same 54rem column so the input lines up with the bubbles.
- A single photo or video without a caption is rendered edge to edge (`mediaOnly`): no padding, no frame, the media itself is the bubble and takes the bubble radius. Its timestamp becomes a translucent blurred pill over the media, bottom-right — top-right for video so it never covers the native controls.
- Meta row carries time, pending/failed state, Seen/receipt text and the actions trigger. The actions trigger is always visible on touch and on hover/focus for pointer devices.
- Replies, attachments, link previews, reactions, star/pin flags, edited/deleted states and highlighted search jumps use shared patterns.
- Deleted messages show italic text, not an empty bubble.

### Composer
Sticky at the bottom of the conversation, safe-area aware. Rounded textarea that grows to 9rem, attachment and voice buttons, emoji/mention assistance, reply bar, upload queue with progress/cancel/retry, voice recording bar with timer/live waveform/pause/cancel/preview. Icon buttons are quiet (no outline) and only the send action carries the yellow shape; the mention button is hidden outside group chats. The bar itself is capped to the message column. Enter-to-send is a saved preference; Ctrl/⌘+Enter always sends. Mobile padding respects the virtual keyboard and safe-area inset.

### Voice notes
Mint accent reserved for recording/audio. Waveform from real amplitude data, seekable progress, duration, playback speed, pause/resume and accessible labels. Permission/unsupported errors are explicit.

### Calls
- 1:1 overlay: charcoal full-screen surface, remote video/audio, PiP local preview, timer, mute/camera/device/hang-up controls, ringing/connecting/connected/reconnecting/ended states, clear permission and TURN notices.
- Incoming call card: caller identity, voice/video label, accept/decline.
- Group call: LiveKit participant grid, active speaker emphasis, participant count, mic/camera controls, host end-call, reconnecting state and audio-unlock control.
- Destructive hang-up is visually distinct; muted/off devices have both icon state and text labels.

### Navigation
Desktop: fixed charcoal rail with yellow active pill, icon + 10px label, numeric badges, profile shortcut at the bottom, skip link. Mobile: bottom navigation with safe-area padding, active inverse pill, 52px+ touch targets, no rail logo/profile.

### Conversation list
Search field, All/Unread/Archived tabs, notification permission banner, avatars with presence, last-message preview, relative time, pin/mute icons, unread badges and an active-row yellow marker. Empty, loading skeleton and error/retry states are designed.

### Notifications
In-app toast stack (top-right desktop, safe mobile), bell badges, per-category preferences, mute durations, push permission callout and a dedicated notifications page. Toasts use text + icon; they do not rely on colour. Push payloads respect preferences and are deduplicated server-side.

### Search
Global search results sit below the conversation list with a compact conversation name/message/time hierarchy. In-chat search reveals a result list, jumps to the message, highlights it temporarily and loads older pages up to a bounded number of attempts.

### Settings
Sticky section nav (horizontal scroll on mobile), grouped panels, switches/selects with descriptions, dirty-state save buttons, success/error status, blocked-user list, storage meter, session controls, account deletion with typed confirmation, install guide and shortcut reference.

### Empty, loading, error and offline states
Original black-line stamp illustrations (yellow/pink/mint fills) on welcome, empty inbox, no results, no contacts, no media, lock/unavailable, saved, offline and call states. Skeletons mirror final layouts. Errors are actionable sentences with retry, never blank screens. Offline and update banners sit above content without blocking the composer.

---

## 6. Responsive system

Breakpoints:
- `60rem` — settings nav collapses to horizontal pills; conversation list narrows.
- `62rem` — welcome/auth switch from two columns to a tighter split.
- `47.99rem` — true mobile layout.

Desktop:
- rail + conversation list + conversation canvas (plus dialogs/panels);
- message column capped at 56rem for readable line length;
- contextual search/media/profile panels overlay the canvas rather than shrinking it below usable width.

Tablet:
- narrower conversation list, settings single column, auth aside reduced (bullets hidden below 62rem).

Mobile:
- single screen at a time: list **or** conversation, driven by `data-thread`;
- bottom navigation replaces the rail;
- back button in the conversation header;
- 44px+ touch targets, safe-area top/bottom/left/right insets;
- composer sits above the bottom nav/keyboard and never hides behind it;
- no horizontal overflow; message text wraps; dialogs become bottom sheets where appropriate;
- welcome and auth hide the decorative aside so the form is the focus.

Keyboard and focus:
- skip-to-content link;
- logical tab order; native dialog focus trap;
- visible 3px focus ring;
- Escape closes menus/dialogs;
- focus returns to the trigger on close where implemented;
- arrow-key/radio semantics for the theme control.

---

## 7. Accessibility and performance rules

- Semantic landmarks: `main`, `nav`, `aside`, labelled sections, one `h1` per screen.
- Every icon-only action has an accessible name; decorative SVGs are `aria-hidden`.
- Live regions announce toasts, typing and upload progress; errors use `role="alert"`.
- Contrast targets WCAG AA; muted text is checked against its actual surface. The dark theme is independently tuned.
- No important status relies on colour alone.
- Images have empty alt when decorative (avatars are accompanied by names); videos have controls; audio has a labelled seek slider and speed control.
- Message lists use virtualization-free incremental pagination with stable keys; realtime events are idempotent and do not re-render the composer.
- Animations respect reduced motion; no expensive filters or blur behind scrolling content.
- The service worker caches only the static shell and never private API responses, messages or media.

---

## 8. Implementation map

| Area | Files |
|---|---|
| Tokens / themes / grid | `src/styles/tokens.css`, `src/styles/global.css` |
| Primitives | `src/components/{Button,TextField,SelectField,Switch,Dialog,ConfirmDialog,IconButton,Avatar,Skeleton,EmptyState,ThemeToggle}` |
| Shell & navigation | `src/features/shell/AppShell.*` |
| Chats | `src/features/chat/ChatsPage.*`, `ThreadView.*`, `MessageBubble.*`, `Composer.*`, `MessageActions.*`, `GroupInfoDialog.*`, `media/*` |
| Calls | `src/features/calls/CallOverlay.*`, `GroupCallOverlay.*`, `Call*Page.*` |
| Settings | `src/features/settings/*` |
| Auth / welcome | `src/features/{welcome,auth}/*` |
| Notifications / PWA | `src/features/{notifications,pwa}/*` |

## 9. Visual QA status

Updated 2026-10-26.

- Verified by build/typecheck/lint/unit tests: component compilation, token usage, no TypeScript or lint failures.
- Welcome page inspected at 1440×900 in both themes: the banner, headline highlight, feature strip, sticker composition and phone mockup hold together; `scrollWidth === clientWidth` (no horizontal overflow). The “3 new” sticker was ivory-on-yellow and clipped at the visual edge — corrected to charcoal text and re-anchored to the phone card.
- Auth pages inspected at mobile width in the dark theme (brand, theme radiogroup, fields, focus ring, loading/disabled button, links).
- Signed-in shell inspected at 1440×900 in light and dark: charcoal rail with yellow active pill, conversation column, bordered panels, grid canvas, empty and error panels. No horizontal overflow. Landmarks corrected during this pass (single `main`, labelled conversation section).
- Chats, People and Settings error states inspected with the live session. Blocked-people on People previously had no error branch and stayed on “Loading…”; it now shows an alert with Retry.
- **Not verified:** data-filled conversations, message bubbles, media, voice notes, call overlays, populated settings panels and the mobile workspace with real data. The configured Supabase schema is incomplete (missing RPCs), so these cannot be reached until migrations `0001` → `0006` are applied.
- Screenshot tooling is unreliable here: captures are scaled/cropped relative to the CSS viewport and fail while the window is covered. Layout conclusions above come from DOM measurements as well as images.
- Dark theme tokens were checked on every screen that could be rendered, but not on data-filled message/call screens.
- An independent contrast/assistive-technology audit has not been performed.
