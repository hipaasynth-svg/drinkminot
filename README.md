# DrinkMinot

Local bar, bottle-shop, coffee & café ratings for Minot, ND — by locals, for locals.

**Tap. Rate. Earn. Zero tracking. Period.**

DrinkMinot is the **twin of [EatMinot](https://github.com/hipaasynth-svg/EatMinot.com)** —
same app, same "verified word-of-mouth" model, but for everywhere you grab a *drink*:
liquor stores, bars & lounges, casinos, breweries, coffee shops, bakeries, juice bars and
more. Ratings are only possible after a physical presence check (NFC tap or QR scan of a
unique in-store tag), one per device per venue every 24 hours. No accounts, no email/text
collection, no personal tracking.

## What's different from EatMinot

Everything below is the same architecture as EatMinot, plus two twin-specific features:

- **21+ sticker.** Every bar / alcohol establishment (liquor stores, bars & lounges,
  casinos, breweries, clubs, saloons, lounges) carries a small round **21+** sticker in a
  dedicated "thumbnail spot" on its card — a quick visual flag that you must be 21 to
  enter/buy. Coffee shops, bakeries, juice bars, hotels and family restaurants don't get
  it. The flag lives in the frozen seed list (`over21`, column 5 of `RAW`) so it's stable
  per venue id.
- **"Also on EatMinot" cross-listing tag.** Some places appear on *both* sites (they serve
  food and drink). Those are tagged with an orange **🍔 Also on EatMinot** pill so people
  know where else to find — and rate — them. The flag is `alsoOnEat` (column 6 of `RAW`).
  Currently cross-listed: Arny's 2.0 / Off the Vine, Ebeneezer's Eatery & Irish Pub,
  Badlands Grill House & Saloon, ND Asia Restaurant & Lounge, Spicy Pie, Taco Feliz,
  Basecamp Indian Kitchen, Bones BBQ, Prairie Sky Breads, Broadway Bean and Bagel,
  Charlie's Main Street Café, and Minot's Daily Bread.

## Categories

62 seeded Minot venues, grouped & alphabetized by category at render time:

| Category | 21+? | Examples |
|----------|:----:|----------|
| Liquor & Bottle Shops | ✅ | Broadway Liquor, Cash Wise Liquor, MP Wine & Spirits, Walmart Liquor |
| Bars & Lounges | ✅ | Capri Bar, Blue Rider, The Pour Farm, Ranger Lounge, Ben's Tavern, 19th Hole |
| Casinos & Gaming | ✅ | Aces Lounge & Casino |
| Breweries & Taprooms | ✅ | Trestle Tap House |
| Clubs & Lodges | ✅ | Moose Lodge, VFW |
| Restaurants | mixed | Applebee's, Olive Garden, Buffalo Wild Wings, Badlands Grill House & Saloon* |
| Hotels | — | The Grand Hotel, Hampton Inn, Hyatt House, Comfort Suites |
| Golf Clubs | — | Vardon Golf Club |
| Cafés & Coffee | — | Caribou Coffee, Starbucks, Tim Hortons, 7 Brew, With Room Coffee |
| Bakeries | — | Bearscat Bakehouse, Cookies For You, Prairie Sky Breads, Minot's Daily Bread |
| Juice & Nutrition | — | Blissful Bee Juicery, Superior Nutrition Minot, Minot Nutrition Addiction |

\* Restaurants with a full bar/saloon/lounge component (Badlands, ND Asia) are flagged 21+;
family restaurants that merely serve alcohol are not.

## Live app (static, deploys to Vercel with zero config)

| File | Purpose |
|------|---------|
| `index.html` | Public app + owner login + owner dashboard |
| `guide.html` | "Minot's Most Wanted" — a curated, hand-picked landing page (optional `?hotel=` co-brand) |
| `admin.html` | Operator admin (upload photos, toggle Claimed/Paid/Featured, hide/show, see owner passwords) |
| `store.js`   | Shared data model, seed list, persistence, helpers |

Open `index.html` for the customer experience; `admin.html` for the operator console.

### What works today
- **Rating is tag-only.** The only way to rate a venue is to tap its physical NFC tag or
  scan its QR code (`/?r=<id>`, shown per-venue in the admin console with a copy button),
  which opens straight to that venue's full detail page. A **"Rate this visit"** button
  appears there only when reached via a real tag; once rated it's replaced by a "✓ Rated"
  confirmation. "Browse all →" leaves for the normal app.
- **Two views of each venue, split by purpose:**
  - The **Rolodex** (home carousel) is a lean teaser — name, hours, the happy-hour cue,
    verified-rating count, the 21+ sticker, and any cross-listing tag. Smooth momentum drag
    with a click-vibration on each turn (arrow keys / edge buttons on desktop).
  - The **tag/QR detail page** carries everything else: address, the House Picks billboard,
    happy-hour special text, punch-card progress, and any earned coupon.
- **Two-tap rating** — thumbs-up then a star. Because there is **no thumbs-down**, a
  "Submit stars only — no upvote" option lets people rate quality after a bad experience
  without upvoting. Brief "PUNCHED" starburst on submit; one rating per device per venue / 24h.
- **Punch card** — an owner-set number of punches (2–5) earns a venue-set reward, then it
  resets and issues a short redemption code (`DRK-…`) with an expiry.
- **Wallet passes + card backup** — progress lives per-device, but in shared mode it is also
  mirrored to the backend under the device's random token (no name/email/account), so a
  reload or wiped cache can restore it. Customers can **Add card to Google Wallet**; the pass
  carries the punch balance and a QR that reopens the card (`?dev=<token>`), and its balance
  **auto-updates** after each punch. Google is env-gated (see below); Apple is wired through
  and lights up once its certs are set. With no wallet env, the buttons simply don't render.
- **Threshold ratings** — a star average is hidden until a venue has 3+ real (tap/QR-verified)
  reviews; below that it shows "✨ New — be the first to rate" instead of a number, so a
  single early rating can't masquerade as a settled score.
- **Minot's Most Wanted** (`guide.html`) — a curated landing page with up to **3 Spotlight
  spots**, each carrying an exclusive DrinkMinot offer and "show your phone before you order"
  redemption instructions, backfilled with top-rated favorites. Spotlight = the admin
  **Featured** toggle; the owner fills the offer in from their dashboard. Optional per-hotel
  co-brand via `?hotel=`.
- **Neon "Happy Hour Now"** indicator that switches on/off by the clock from the owner's
  schedule (day + start/end + special).
- **Owner dashboard** (password-gated) — House Picks billboard (top 3 picks), happy-hour
  selector, punch-card reward + punches-needed (2–5), the exclusive Most Wanted offer, note,
  website, password change. A "forgot password" line points owners to `cody@drinkminot.com`.
- **Paid gate** — changing the photo and publishing the billboard require the $59/mo tier;
  free claimed owners can edit the rest.
- **Admin console** — upload a photo for any venue, toggle Claimed/Paid, add to **Minot's
  Most Wanted** (Featured), **hide/show a venue** (pulls it from the public list, tag page,
  Most Wanted and rating while keeping it in the admin panel to restore), view/hand out owner
  passwords (or reset one to default), copy each venue's tag URL, reset demo data. The 21+ and
  cross-listing flags are shown per venue. No admin action writes to a vote counter — those
  only move via a real rating.

### Default credentials
- **Owner login:** pick your venue, password = its name (letters only) + `26`
  (e.g. `capribar26`). Changeable in the dashboard; each password is listed in the admin
  console. Owners who lose it can email `cody@drinkminot.com`.
- **Admin:** `drink-admin` (changeable inside the admin console / `DRINK_ADMIN_PASSWORD`).

## Shared database (turn on cross-device sync)

The app runs in two modes automatically:

- **Local mode** (default before setup): data lives in each browser's `localStorage`.
  The site fully works, but owner edits/photos/ratings are per-device.
- **Shared mode**: once a Redis store is attached, `GET /api/state` reports
  `persistent:true` and the app reads/writes the shared database — every visitor sees the
  same ratings, photos, and owner content.

The backend is plain Vercel serverless functions in `api/` (no npm dependencies). They talk
to an Upstash Redis store using either `UPSTASH_REDIS_REST_URL`/`_TOKEN` (Vercel's
Marketplace "Upstash for Redis" integration) or the legacy `KV_REST_API_URL`/`_TOKEN` —
whichever Vercel injects when you attach the store.

**Storage is per-venue, not one shared blob.** Each venue has its own profile key
(`drinkminot:r:<id>`) and its own vote-counter hash (`drinkminot:v:<id>`). Votes move only
via Redis `HINCRBY` — an atomic, race-free increment — so many simultaneous ratings for the
same venue can't lose an update. `GET /api/state` fetches every venue in a single round trip
via Upstash's pipeline endpoint.

> Use a **separate** Redis store from EatMinot's — the two sites use different key prefixes
> (`drinkminot:` vs `eatminot:`), so they can even share one store safely, but separate
> stores keep the two datasets cleanly independent.

### One-time setup in Vercel (~2 min)
1. Open your project → **Storage → Create Database → Upstash for Redis** (Marketplace) →
   connect it to this project. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   automatically.
2. **Redeploy** (Deployments → ⋯ → Redeploy) so the functions pick up the new env vars.
3. Done — the app flips to shared mode on the next load. (Optional: set
   `DRINK_ADMIN_PASSWORD` to change the admin password from the `drink-admin` default.)

Photos are stored under separate Redis keys and downscaled client-side to keep them small.

### API surface (`/api`)
- `GET  /api/state` → public venues (+ `persistent` flag), no passwords
- `POST /api/rate` `{id, stars, upvote}` → updates shared upvotes / verified ratings / stars
- `POST /api/owner` `{action:'login'|'update'|'photo', id, password, …}` → owner controls
- `POST /api/admin` `{password, action, …}` → photos, Claimed/Paid flags, list, reset
- `GET  /api/photo?id=` → a venue's photo
- `POST /api/device` `{action:'get'|'put', deviceId, perRest}` → anonymous punch-card backup
  (keyed only by the random `dev_…` token; sanitized to punch/coupon fields; no identity)
- `GET  /api/pass` → `{google, apple}` (which wallet buttons the server can issue)
- `POST /api/pass` `{provider, dev, venueId, done, total, action?}` → an Add-to-Wallet save
  link; `action:'patch'` just refreshes the balance on a card the customer already added
- `GET  /api/events` → curated upcoming Minot events (public JSON, upcoming only)
- `POST /api/events` `{password, action:'add'|'update'|'remove'|'list', event}` → admin-gated event editing

## Minot events feed (`/api/events`)

A curated "what's happening in Minot" feed — the local events endpoint that
doesn't exist cleanly anywhere else, so DrinkMinot hosts it. It powers the
Down Under marketing agent (which reads it to plan busy nights) and can later
back a public "what's on" section on the site.

- **Public read:** `GET /api/events` → `{ ok, events: [...] }`, upcoming only
  (`date >= today`), soonest first. No auth, no passwords.
- **Admin editing** (reuses the admin password, exactly like `/api/admin`):
  `POST /api/events` with `{ password, action, ... }`:
  - `add` `{ event: { title, date, time?, venue?, category?, url?, note? } }`
    — `title` and `date` (`YYYY-MM-DD`) are required; `id` is auto-assigned;
    `source` defaults to `manual`.
  - `update` `{ event: { id, ...fields } }` — merges into an existing event.
  - `remove` `{ id }` — deletes by id.
  - `list` — returns ALL events including past ones (the admin view).
  - `sync` `{ source, events: [...] }` — idempotent auto-feed: **replaces all
    events of that `source`** (e.g. `predicthq`) with the provided set, leaving
    every other source untouched. This is how an automated pull (PredictHQ,
    Ticketmaster, …) keeps the feed current without ever clobbering the events
    you added by hand (`source: manual`).

Each event carries a `source` so hand-curated and auto-synced events coexist
safely. Point an automated sync at the `sync` action and curate the local
one-offs by hand with `add`.

Events are stored under one Redis key (`drinkminot:events`) via the shared
storage adapter, so they persist in shared mode and fall back to in-memory
locally. The feed starts empty; add events with the admin `add` action, e.g.:

```bash
curl -s -X POST https://drinkminot.com/api/events \
  -H 'Content-Type: application/json' \
  -d '{"password":"<admin>","action":"add","event":{
        "title":"NDSU Bison watch party","date":"2026-09-05","time":"18:00",
        "venue":"Down Under Bar","category":"Sports"}}'
```

## Owner auth (server-side)

In shared mode, owner passwords are **salted-SHA-256 hashed** in the database (no plaintext
at rest). Logging in returns a **signed HMAC session token** (12h), which is what subsequent
owner edits/photo uploads send. Set `DRINK_SESSION_SECRET` in Vercel to a long random string
so tokens can't be forged. If it's ever left unset, the code signs with a random secret
generated fresh per cold start instead of a fixed fallback — an unset secret just logs owners
out on redeploy, never a silent hole.

The admin console never shows password hashes: it shows each owner's **default** password
(name + `26`) and flags any that an owner has changed, with a one-click **Reset to default**.

## Billing — $59/mo Claimed tier (Stripe)

The "Upgrade — $59/mo" button opens **Stripe Checkout** (subscription). On return, the app
confirms the session and flips the listing to **Paid** (unlocking photo changes + the House
Picks billboard). A webhook keeps status in sync on cancellation.

Implemented with Stripe's REST API directly (no SDK): `api/checkout.js`,
`api/upgrade-confirm.js`, `api/stripe-webhook.js`.

### Setup in Vercel
1. Add environment variables:
   - `STRIPE_SECRET_KEY` — from your Stripe dashboard (test or live).
   - `STRIPE_WEBHOOK_SECRET` — from the webhook you create in step 2 (optional but
     recommended; without it, upgrades still work via return-confirmation, but automatic
     downgrade-on-cancel won't).
   - `STRIPE_PRICE_ID` — *optional*. If unset, checkout creates the $59/mo line inline; set
     it to a fixed Price ID if you'd rather manage the product in Stripe.
2. In Stripe → Developers → **Webhooks**, add an endpoint
   `https://drinkminot.com/api/stripe-webhook` for events `checkout.session.completed`,
   `customer.subscription.deleted`, `customer.subscription.updated`. Copy its signing secret
   into `STRIPE_WEBHOOK_SECRET`.
3. Redeploy. Until `STRIPE_SECRET_KEY` is set, the upgrade button reports "billing not set
   up" and you can still grant Paid manually from the admin console.

## Environment variables (all optional; features light up when present)

| Var | Enables |
|-----|---------|
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Shared database (auto-added by Vercel's Upstash Redis) |
| `DRINK_SESSION_SECRET` | Unforgeable owner session tokens |
| `DRINK_ADMIN_PASSWORD` | Overrides the `drink-admin` admin default |
| `STRIPE_SECRET_KEY` | Live $59/mo Stripe checkout |
| `STRIPE_WEBHOOK_SECRET` | Auto status sync (cancellations) |
| `STRIPE_PRICE_ID` | Use a fixed Stripe Price instead of the inline $59/mo |
| `GOOGLE_WALLET_ISSUER_ID` | Google Wallet punch-card passes (with the SA key below) |
| `GOOGLE_WALLET_SA_JSON_BASE64` | Google service-account JSON key, base64-encoded |
| `APPLE_PASS_TYPE_ID` / `APPLE_TEAM_ID` / `APPLE_PASS_CERT_P12_BASE64` / `APPLE_PASS_CERT_PASSWORD` / `APPLE_WWDR_CERT_BASE64` | Apple Wallet passes (all five required; button hidden until then) |

### Notes & remaining for later
- Addresses/hours are placeholders (`Minot, ND` / `Verify hours`) for venues where they
  weren't confirmed — verify and fill them into `RAW` (in both `store.js` and `api/_lib.js`,
  which are kept in lock-step) as they're confirmed. Never reorder or delete rows — ids are
  frozen and printed on the in-store tags; only append.
- **Domain**: add `drinkminot.com` in the project's Domains tab and point DNS to Vercel.

## Public repo — nothing sensitive lives here

All secrets (`STRIPE_SECRET_KEY`, `DRINK_SESSION_SECRET`, `DRINK_ADMIN_PASSWORD`, the Upstash
Redis credentials) are Vercel environment variables — never committed.
