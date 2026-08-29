# DrinkMinot owner bundles

Print-ready sales bundles handed to prospective bars. Each **packet is 3 pages**:

1. **`onepager`** — the sales sheet: zero tracking, the 3-punch deal, opening offer,
   the ratings mechanic, measurable-return strip with the $59-vs-return payback,
   hotel-QR roadmap, Founding Five, three QR taps, and the wallet badge.
2. **`comparison`** — the punch-card vs. two-quarters-in-a-shot-glass argument.
3. **`bestpractices`** — the owner playbook for getting results.

## Rebuild

```sh
pip install segno pymupdf
python marketing/build.py
# -> marketing/out/<Bar>_Packet.pdf
```

PDF rendering shells out to headless Chrome/Chromium. If it isn't found, set
`CHROME=/path/to/chrome`; with no Chrome at all, the filled-in `.html` files are still
written to `marketing/out/` — open and print them from any browser.

## Editing

- **Copy / design:** edit the files in `marketing/templates/`. They use plain
  placeholders — `MASCOT_DATA_URI`, `{{BARNAME}}`, and the QR slots
  (`{{QR_LISTING}}`, `{{QR_SETUP}}`, `{{QR_LOGIN}}` on the one-pager; `QR_SVG` on the
  comparison). `build.py` fills them in.
- **Bars:** edit the `BARS` list at the top of `build.py`. Each entry's `id` is the
  venue's frozen id in `store.js` / `api/_lib.js` — that's what the QR codes point at
  (`/?r=<id>` for the public page, `/?owner=<id>` first-run setup, `/?login=<id>` admin).
- **Mascot:** `marketing/assets/mascot.png`.

## The three QR taps

| Tile | URL | What it does |
|------|-----|--------------|
| Live page | `/?r=<id>` | Opens the bar's listing to tap & rate |
| First-time setup | `/?owner=<id>` | One-time, no-password owner setup (sets their password) |
| Owner login | `/?login=<id>` | Password-protected admin, for daily use |

## Pricing shown

$59/month founding rate (struck-through $79), **locked for a year, cancel anytime**;
standard price $79 after. Starter hardware: **four NFC tags/QRs + two cards**, with
table stickers available **at cost** (recommended — every table = more taps).
