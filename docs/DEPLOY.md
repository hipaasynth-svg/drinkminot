# Deploying and operating DrinkMinot

Everything needed to run, configure and operate the site. The [README](../README.md) covers
what the product is and what is live; this is the plumbing.

**Verified live configuration as of 2026-09-23** (read from the Vercel project, names only
— no values were decrypted):

| Variable | State | Effect |
|---|---|---|
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` / `KV_URL` / `REDIS_URL` | **set** | Shared mode is on; Upstash Redis attached (a separate store from EatMinot's) |
| `DRINK_SESSION_SECRET` | **set** | Owner session tokens are unforgeable |
| `DRINK_ADMIN_PASSWORD` | **set** (production) | Admin console is not on a default password |
| `STRIPE_SECRET_KEY` | **set** | Checkout is live |
| `STRIPE_WEBHOOK_SECRET` | **set** | Cancellations sync automatically |
| `STRIPE_PRICE_ID` | **not set** | Good — the inline `STANDARD_PRICE_CENTS` ($79) is authoritative. See the warning below before ever setting it. |
| `DRINK_TAG_SECRET` | **set** | Signed tag URLs are being issued |
| `DRINK_REQUIRE_TAG_SIG` | **not set** | ⚠️ Unsigned ratings are still **accepted** — presence is not enforced |
| `GOOGLE_WALLET_ISSUER_ID` / `GOOGLE_WALLET_SA_JSON_BASE64` | **set** | Google Wallet punch-card passes work |
| Apple Wallet vars (all five) | **not set** | Apple Add-to-Wallet button stays hidden |
| `MINOT_AGENT_URL` / `MINOT_AGENT_SERVICE_KEY` | **not set** | AI Assistant stays invisible |

---

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

66 seeded Minot venues, of which **29 are currently live** — the rest are held back via the
`REMOVED` id-map pending a photo (see "Notes & remaining for later"). Grouped &
alphabetized by category at render time:

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
| `admin.html` | Operator admin (upload photos, toggle Claimed/Paid/Featured, hide/show, hand out setup codes) |
| `store.js`   | Shared data model, seed list, persistence, helpers |

Open `index.html` for the customer experience; `admin.html` for the operator console.

### Owner onboarding (no default passwords)
There is deliberately **no formula that turns a venue's name into its credential**, and no
password is seeded for any listing. A venue is onboarded like this:

1. The admin console shows that listing's **setup code** — a random 8-character code,
   generated once per venue and stored on its profile. Hand it over with the tags (the
   "Copy setup link" button gives you `/?owner=<id>&c=<code>` for the packet QR).
2. The owner opens that link, enters the setup code, and picks their own password. That
   claims the listing, and the code is spent.
3. After that, only their password works. A listing nobody has claimed cannot be logged
   into at all — there is no password on it to guess.

If an owner loses their password, an admin generates a new random one from the console
(shown once — only the salted hash is stored). If a setup card goes astray before the
listing is claimed, "New code" issues a fresh code and invalidates the old one. Owners
can email `cody@drinkminot.com`.

> An earlier version seeded every listing with its name + `26`, this file published the
> formula, and the login screen itself suggested it — so any listing could be logged into
> by anyone who could read its name. `tests/auth.test.js` covers that case specifically so
> it cannot come back.

- **Admin password:** set `DRINK_ADMIN_PASSWORD` in Vercel. There is a development fallback
  in `api/_lib.js` for local use; **treat any deployment without that variable set as an
  open admin console** and set it before going live.

## Verified presence and single-use rewards

Mirrors EatMinot. The three things that make "verified word-of-mouth" true are enforced on
the server, not in the customer's browser:

1. **A rating needs a signed tag** — `/?r=<id>&t=<sig>`, an HMAC of the venue id under
   `DRINK_TAG_SECRET`. Deterministic, so a printed tag never goes stale. Copy each venue's
   current URL from the admin console.
2. **One rating per device per venue per 24h**, a Redis claim on the anonymous `dev_…`
   token rather than a localStorage timestamp.
3. **Punches are counted server-side** and rewards are server records. `/api/device` is
   read-only; its old `put` action answers `410`.

Rollout: tags already in venues carry no signature, so enforcement is **off** until
`DRINK_REQUIRE_TAG_SIG=1`. Set `DRINK_TAG_SECRET`, redeploy, reprogram the tags from the
signed links in admin (the banner there tells you which phase you're in), then set the flag.

### Rewards

A filled card mints a server-side coupon (code, venue, reward, expiry, `redeemedAt`).
Customers can **Add reward to Google Wallet** — a separate Google *Offer* pass beside the
punch card, whose QR opens `/redeem?c=<code>`.

**Any staff member redeems from their own phone:** scan that QR (or open the "Staff:
redeem" link on the customer's screen), see the venue and reward, enter the venue's
**6-digit staff PIN**. No app, no venue login, no shared device — and because the PIN is
the authorisation, a passer-by who scans the same QR cannot spend someone else's reward.
On success the coupon is burned and the Wallet pass is PATCHed to `COMPLETED`, so it greys
out in the customer's own Wallet.

The owner sets and rotates the PIN in their dashboard; it is hashed and never readable
back. **A venue with no PIN cannot redeem at all**, rather than falling back to something
guessable. Failed PINs are rate-limited per coupon, per venue and per IP. Admin shows the
per-venue **issued vs redeemed** line.

### Rolling out signed tags

Tags printed before signing carry a bare `/?r=<id>`, so enforcement is **off by default** —
and as of 2026-09-23 it is still off here. `api/rate.js` accepts an unsigned rating whenever
`DRINK_REQUIRE_TAG_SIG` is not `1`, so presence is currently the design and not the
guarantee.

1. Set `DRINK_TAG_SECRET` in Vercel to a long random string and redeploy. **Done** — signed
   URLs are being issued; unsigned ratings are still accepted.
2. Reprint or reprogram each tag from the admin console (each row shows its signed link with
   a copy button). The admin banner tells you which phase you are in.
3. Once every tag is updated, set `DRINK_REQUIRE_TAG_SIG=1`. Unsigned ratings are now
   refused. Any tag still carrying a bare link stops working — that is the point.

Step 3 is what makes "verified presence" true rather than intended. Do not skip it, and do
not flip it before step 2 is finished or you will break live tags in venues.

> Rotating `DRINK_TAG_SECRET` invalidates every printed tag at once. Only do it if a secret
> leaks, and reprogram everything in the same sitting.

## Shared database (attached — Upstash Redis)

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

### How it was set up (already done — for reference or a second environment)
1. Open your project → **Storage → Create Database → Upstash for Redis** (Marketplace) →
   connect it to this project. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   automatically.
2. **Redeploy** (Deployments → ⋯ → Redeploy) so the functions pick up the new env vars.
3. Done — the app flips to shared mode on the next load. (Optional: set
   `DRINK_ADMIN_PASSWORD` — required before going live; see "Owner onboarding" above.)

Photos are stored under separate Redis keys and downscaled client-side to keep them small.

### API surface (`/api`)
- `GET  /api/state` → public venues (+ `persistent` flag), no passwords
- `POST /api/rate` `{id, t, deviceId, stars, upvote}` → verifies the tag signature and the
  once-per-day claim, updates the shared counters, advances the server-held punch card,
  and mints a coupon when it fills
- `POST /api/coupon` `{action:'peek'|'redeem'|'mine'|'walletLink', …}` → staff-facing
  lookup, single-use PIN redemption, a device's own rewards, the Add-to-Wallet link
- `POST /api/owner` `{action:'login'|'update'|'photo', id, password, …}` → owner controls
- `POST /api/admin` `{password, action, …}` → photos, Claimed/Paid flags, list, reset
- `GET  /api/photo?id=` → a venue's photo
- `api/device.js` is gone. Its one read-only action is now
  `POST /api/coupon {action:'deviceGet', deviceId}`, because Vercel's Hobby plan caps a
  deployment at **12 Serverless Functions** and a whole file for one read spent one of
  them. Nothing writes punch state except a real rating.
- `GET  /api/pass` → `{google, apple}` (which wallet buttons the server can issue)
- `GET  /api/pass?provider=apple&dev=&venueId=&done=&total=` → the signed `.pkpass` file
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

The admin console never shows password hashes, and there is no default password to show.
For an unclaimed listing it shows that venue's **setup code**; for a claimed one it shows
only whether a password has been set, with a **Generate new password** action that returns
a fresh random password once.

## Billing — two tiers (Stripe)

| Tier | Price | Trial | How a venue gets it |
|------|-------|-------|---------------------|
| **Standard** | **$79/mo** | none — billed immediately | Any claimed owner clicks "Upgrade — $79/mo" |
| **Founding Three** | **$59/mo** | **10 weeks free**, then $59/mo | An admin grants it in the console — 3 slots on this site, ever |

Both amounts live in exactly one place: `STANDARD_PRICE_CENTS` and `FOUNDING_PRICE_CENTS`
in `api/_lib.js`. That is what Stripe is actually charged. The `PRICING` object near the top
of `index.html`'s owner-dashboard script holds the matching owner-facing *labels* — change a
rate in both, and nowhere else. `tests/founding.test.js` asserts the table above and fails
if the founding rate ever stops being cheaper than standard, which is the bug it exists to
prevent: the offer shipped priced *above* standard and stayed that way while it was being
sold.

The upgrade button opens **Stripe Checkout** (subscription). On return, the app confirms the
session and flips the listing to **Paid** (unlocking photo changes + the House Picks
billboard). A webhook keeps status in sync on cancellation.

### Founding Three
Exactly **3 venues on this site** can ever hold the offer. An admin grants it with the
**Founding** chip in the console. The cap is enforced twice — at grant time
(`api/admin.js` `setFlag`, which returns `409 founding_full`) and again at checkout
(`api/checkout.js`) — so two granted venues checking out at the same moment cannot both
take the last slot.

Only the first checkout that actually redeems the offer gets the free trial. Once it
completes, `founding` is set permanently, so a venue that later cancels and resubscribes
keeps the $59 rate but does **not** get a second trial.

**On "locked for a year":** `foundingLockUntil` is written (one year out) but **nothing
reads it**, and no owner-facing copy promises a locked rate — deliberately. If you want to
advertise a locked rate, add the guard that enforces it *first*. A pricing promise no code
can keep is a liability, not a feature.

Implemented with Stripe's REST API directly (no SDK): `api/checkout.js`,
`api/upgrade-confirm.js`, `api/stripe-webhook.js`.

### Setup in Vercel
1. Add environment variables:
   - `STRIPE_SECRET_KEY` — from your Stripe dashboard (test or live).
   - `STRIPE_WEBHOOK_SECRET` — from the webhook you create in step 2 (optional but
     recommended; without it, upgrades still work via return-confirmation, but automatic
     downgrade-on-cancel won't).
   - `STRIPE_PRICE_ID` — *optional*, **standard tier only**. If unset, checkout creates the
     $79/mo line inline. Founding checkouts ignore it — they always need their own dynamic
     price so the 10-week trial can be attached.

     > ⚠️ **Verified 2026-09-23: this is NOT set, which is the correct state.** Leave it that
     > way. If it is ever set, it overrides `STANDARD_PRICE_CENTS` and decides what the
     > standard tier is actually charged — and the amount lives in Stripe, not in this repo,
     > so nothing here (not `tests/founding.test.js`, not the constants, not the drift guard)
     > can detect a mismatch. A Price object created back when standard was $59 would keep
     > charging $59 while every document said $79.
2. In Stripe → Developers → **Webhooks**, add an endpoint
   `https://drinkminot.com/api/stripe-webhook` for events `checkout.session.completed`,
   `customer.subscription.deleted`, `customer.subscription.updated`. Copy its signing secret
   into `STRIPE_WEBHOOK_SECRET`.
3. Redeploy. Until `STRIPE_SECRET_KEY` is set, the upgrade button reports "billing not set
   up" and you can still grant Paid manually from the admin console.

## Keeping the two sites in sync

EatMinot and DrinkMinot are twins: near-identical code sold as one offer at one price. Every
fix has to be ported twice, and when a port is missed nobody notices until a customer does.
That has already happened three ways — the founding tier priced *above* standard while the
pamphlets sold it as a discount, a one-pager selling "Founding Five" against a cap of 3, and
`store.js` silently dropping an admin flag so a console toggle did nothing.

`scripts/drift-guard.js` is the guard against a fourth. Run it locally:

```sh
npm test         # the regression suites
npm run drift    # self-consistency + comparison against the twin checkout
```

A byte diff between the twins is useless (they legitimately differ by hundreds of lines), so
the guard checks **invariants** instead:

- the founding rate always **undercuts** standard — the invariant that actually broke
- `api/checkout.js` carries no bare rate literal; both amounts come from the constants
- `index.html`'s `PRICING` labels match `STANDARD_PRICE_CENTS` / `FOUNDING_PRICE_CENTS`, and
  its trial label matches `FOUNDING_TRIAL_DAYS`
- every rate stated in owner-facing HTML is one of the two current rates, and every
  "Only N spots" / "Founding <Word>" claim matches `FOUNDING_LIMIT`
- no owner-facing page promises a locked rate, since nothing in the code enforces one
- every boolean flag `api/admin.js` `setFlag` accepts is actually forwarded by `store.js`
  `adminSetFlag` — the no-op-toggle bug class
- the four shared constants are **identical** in both repos, and the two copies of the guard
  are byte-identical, so the guard cannot itself drift

`.github/workflows/ci.yml` runs the suites and the guard on every PR. It clones the twin at
the *same branch name* when one exists, falling back to `main`, so a change that correctly
updates a shared invariant in both repos verifies against its counterpart instead of failing
until one side merges.

The banned-phrase check is matched literally and does not try to detect negation, so
owner-facing copy should avoid "locked for a year" even to deny it. The reasoning for not
promising a lock lives here and in `docs/AUDIT.md`, which the guard does not scan.

## Environment variables (full reference)

| Var | Enables |
|-----|---------|
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Shared database (auto-added by Vercel's Upstash Redis) |
| `DRINK_SESSION_SECRET` | Unforgeable owner session tokens |
| `DRINK_ADMIN_PASSWORD` | The admin-console password. **Set this before going live.** |
| `STRIPE_SECRET_KEY` | Live Stripe checkout (both tiers) |
| `STRIPE_WEBHOOK_SECRET` | Auto status sync (cancellations) |
| `STRIPE_PRICE_ID` | Use a fixed Stripe Price for the **standard** tier instead of the inline $79/mo (founding checkouts always use the dynamic price + trial) |
| `GOOGLE_WALLET_ISSUER_ID` | Google Wallet punch-card passes (with the SA key below) |
| `GOOGLE_WALLET_SA_JSON_BASE64` | Google service-account JSON key, base64-encoded |
| `APPLE_PASS_TYPE_ID` / `APPLE_TEAM_ID` / `APPLE_PASS_CERT_P12_BASE64` / `APPLE_PASS_CERT_PASSWORD` / `APPLE_WWDR_CERT_BASE64` | Apple Wallet passes (all five required; button hidden until then) |
| `DRINK_TAG_SECRET` | Signed tag URLs (`/?r=<id>&t=<sig>`). **Set this** — without it, presence can't be proven or enforced. |
| `DRINK_REQUIRE_TAG_SIG` | Set to `1` to **refuse** ratings without a valid tag signature. Reprogram every tag first. |
| `MINOT_AGENT_URL` / `MINOT_AGENT_SERVICE_KEY` | AI Assistant (beta) — proxies `api/agent.js` to the self-hosted [`minot-agent`](https://github.com/hipaasynth-svg/hipaasynth-svg-minot-agent) service. Also requires an admin to flip a venue's `agentEnabled` flag in the admin console; without either, the feature stays invisible. |

### AI Assistant (beta)
An experimental, admin-gated "AI co-pilot" per venue — writes and runs Python in a
kernel-sandboxed worker (no network access from generated code) to help fill seats
and turn ratings into reviews. Lives entirely in a separate service
([`minot-agent`](https://github.com/hipaasynth-svg/hipaasynth-svg-minot-agent)) this site only
talks to over HTTP via `api/agent.js`; this repo holds no agent code, no LLM
credentials, and no operator data beyond the one venue's own public listing. Off
by default — a super admin turns it on per venue (`admin.html` → "AI Assistant"
chip) once `minot-agent` is deployed and its URL/key are set above.

### Notes & remaining for later
- Addresses/hours are placeholders (`Minot, ND` / `Verify hours`) for venues where they
  weren't confirmed — verify and fill them into `RAW` (in both `store.js` and `api/_lib.js`,
  which are kept in lock-step) as they're confirmed. Never reorder or delete rows — ids are
  frozen and printed on the in-store tags; only append.
- **Domain**: add `drinkminot.com` in the project's Domains tab and point DNS to Vercel.
