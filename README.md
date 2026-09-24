# DrinkMinot

**Verified local bar, bottle shop and coffee ratings for Minot, North Dakota.** A rating is
only possible after a physical tap — NFC or QR, on a tag that lives inside the venue. No
accounts, no email capture, no tracking, no way to rate from your couch.

**29 venues live. Shared database attached. Stripe billing live. Google Wallet passes
working.**

---

## The problem this solves

Every review platform has the same hole: anyone can rate anything from anywhere. A
competitor can bury you from a laptop in another state. A bot can bury you a hundred times.
An owner can pad their own score. The number becomes noise, and everyone knows it.

DrinkMinot closes the hole at the source. **You cannot rate a bar you have not physically
walked into.** The only path to the rating screen is tapping that venue's own tag, and the
tag is signed with an HMAC key so the URL cannot be forged or shared. One rating per device
per venue per 24 hours.

For a bar, that produces something no review site can: proof that real people were actually
standing in the room and actually came back.

---

## What is live right now

Verified against the running Vercel configuration, not aspirational:

| | DrinkMinot |
|---|---|
| Venues live | **29** (of 62 seeded; the rest held back via the `REMOVED` id-map) |
| Shared database | **Attached** — Upstash Redis, every visitor sees the same data |
| Owner dashboards | **Live** — claim code → password → billboard, happy hour, reward, photo |
| Stripe billing | **Live keys + webhook**, $79/mo standard and $59/mo founding |
| **Google Wallet passes** | **Live** — punch cards go into Google Wallet |
| Apple Wallet | Not configured (needs all five Apple vars) |
| Signed tags | **Key set** — signed URLs are being issued |
| Signature enforcement | **OFF** — see the blockers below |
| AI Assistant | Built, not wired to a service |
| Tests | **96 assertions across 3 suites**, plus a 146-check drift guard, on every PR |

---

## Two blockers, stated plainly

**1. The core claim is not enforced.** `DRINK_TAG_SECRET` is set, so tags are being signed.
**`DRINK_REQUIRE_TAG_SIG` is not set**, so `api/rate.js` still accepts a rating that arrives
with no valid signature. The one sentence this product is sold on is currently the design,
not the guarantee. It is one environment variable away — but flipping it breaks every tag
already printed with a bare `/?r=<id>` link, so tags must be reprogrammed first. Sequence in
[docs/DEPLOY.md](docs/DEPLOY.md#rolling-out-signed-tags).

**2. 21 of 29 venues show unverified hours.** A local checking "is the Landing open right
now" gets "Verify hours" instead of an answer, and repeat local visits are the only thing
that makes a tag worth a monthly fee to an owner. This needs no code — just the admin hours
editor — and it is the highest-return work available on this site.

25 of 29 venues also have no street address on file, but that **no longer breaks
directions**: the Get directions button falls back to the venue name, which Google Maps
resolves as well as a street would. The card still displays "Minot, ND" where a street would
read better, which is cosmetic rather than blocking.

---

## How it works

**1. A drinker taps the tag.** The NFC tag or QR code opens straight to that venue's page —
no carousel, no other listings competing for the moment. A bouncing *"Swipe up to rate"*
prompt is waiting.

**2. Two taps and they're done.** Thumbs-up, then a star. There is deliberately **no
thumbs-down** — a "submit stars only, no upvote" option lets someone rate quality honestly
after a bad night without torching the place.

**3. They earn something real.** Every rating is a punch. Fill the card and a single-use
reward coupon is issued, redeemable only with a 6-digit staff PIN — so it cannot be
screenshotted, forwarded or claimed twice. **On Android the card goes straight into Google
Wallet**, which is live on this site.

**4. The owner runs it themselves.** A password-protected dashboard: the House Picks
billboard (their top 3), happy-hour window and special, punch count (2–5), the exclusive
Most Wanted offer, photo, note, website. Changes go live immediately.

The punch card only goes live once the venue has confirmed they'll honor the reward. The
system does not print a promise somebody else has to keep.

---

## The offer

| | Standard | Founding Three |
|---|---|---|
| **Rate** | $79/month | **$59/month** |
| **Trial** | none, billed immediately | **10 weeks free** |
| **Availability** | anyone | **3 venues, ever** |

Identical to EatMinot on purpose — a bar owner and a restaurant owner who compare notes
should hear the same thing. Both amounts live in one place, `STANDARD_PRICE_CENTS` and
`FOUNDING_PRICE_CENTS` in `api/_lib.js`, and CI fails if any template, label or page
disagrees, if the founding rate stops being the cheaper one, or if the two sites diverge.

The founding rate is **not** advertised as locked for a year. Nothing in the code enforces a
locked term, so nothing printed promises one.

**Paid unlocks** photo changes and the House Picks billboard. A free claimed owner can still
edit everything else.

Print-ready sales material lives in [`marketing/`](marketing/) — a three-page packet per
prospect. Rebuild instructions are in that folder's README.

---

## Other known gaps

- **Owners see almost no proof it worked.** Rating counts, coupons issued and coupons
  redeemed are all in Redis today, but `couponStats` is admin-only (`api/admin.js`), so the
  person paying $79 cannot see the number that justifies it. No tap counter, nothing
  time-series, so "this month vs last" is impossible. Highest-value thing left to build.
- **No failed-payment handling.** `api/stripe-webhook.js` covers cancellation but not
  `invoice.payment_failed`, so an expired card keeps every paid feature until Stripe
  eventually cancels.
- **Age gate.** This site lists alcohol. There is no age gate and no written answer yet on
  North Dakota's rules for alcohol promotions. A venue's liquor licence is not ours to
  gamble — settle this before signing a bar.
- The full standing audit is in
  [EatMinot's docs/AUDIT.md](https://github.com/hipaasynth-svg/EatMinot.com/blob/main/docs/AUDIT.md),
  which covers both sites.

---

## Run it

```sh
npm test         # 96 assertions, 3 suites, zero dependencies
npm run drift    # 146 consistency checks against the EatMinot twin
```

No install step — everything uses Node builtins only. Open `index.html` for the customer
experience, `admin.html` for the operator console, `redeem.html` for staff redemption.

**Deployment, environment variables, the API surface, the signed-tag rollout, Stripe setup
and how the twin sites are kept in sync: [docs/DEPLOY.md](docs/DEPLOY.md).**

---

## Sibling site

[**EatMinot**](https://github.com/hipaasynth-svg/EatMinot.com) is the same system for
restaurants — 47 venues, same offer at the same price. The two are kept
honest by a shared drift guard that fails CI if their pricing, trial length or slot cap ever
diverge, or if a flag one site's admin console offers is not actually wired up.

## This repo is public on purpose

Every secret — Stripe keys, session and tag secrets, the admin password, the Redis and
Google Wallet credentials — is a Vercel environment variable, never committed. There is
nothing here that needs to be private for the system to be secure. That is a deliberate
property, not an accident.
