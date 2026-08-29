#!/usr/bin/env python3
"""Rebuild the DrinkMinot owner bundles (sales one-pager + comparison + best-practices)
as print-ready PDFs, one packet per bar.

Usage:
    pip install segno pymupdf          # PDF merge + QR codes
    python marketing/build.py          # writes marketing/out/<Bar>_Packet.pdf

Add or edit bars in the BARS list below — `id` is the venue's frozen id in store.js /
api/_lib.js (printed on its ?r= tags). Templates live in marketing/templates/ and use
plain placeholders, so you can edit copy without touching this script.

PDF rendering shells out to headless Chrome/Chromium. Set CHROME=/path/to/chrome if it
isn't found automatically. With no Chrome present, the filled-in .html files are still
written to marketing/out/ — open and print them from any browser.
"""
import os, re, base64, subprocess, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TPL = os.path.join(HERE, "templates")
OUT = os.path.join(HERE, "out")
SITE = "https://drinkminot.com"
CONTACT_PHONE = "701-389-5644"  # (kept in the templates; listed here for reference)

# name = shown on the sheet; id = venue id in store.js (used for ?r= / ?owner= / ?login=)
BARS = [
    {"name": "Grainhopper",        "id": 64},
    {"name": "The Down Under Bar", "id": 63},
]

def find_chrome():
    if os.environ.get("CHROME") and os.path.exists(os.environ["CHROME"]):
        return os.environ["CHROME"]
    for c in ["google-chrome", "chromium", "chromium-browser", "chrome"]:
        p = shutil.which(c)
        if p:
            return p
    for p in ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]:
        if os.path.exists(p):
            return p
    return None

def qr_svg(url):
    import segno
    q = segno.make(url, error="m")
    w, h = q.symbol_size(border=2)
    svg = q.svg_inline(dark="#15313A", light=None, border=2)
    svg = svg.replace("<svg ", '<svg viewBox="0 0 %d %d" preserveAspectRatio="xMidYMid meet" ' % (w, h), 1)
    svg = re.sub(r'\swidth="\d+"', "", svg, 1)
    svg = re.sub(r'\sheight="\d+"', "", svg, 1)
    return svg

def mascot_data_uri():
    b = base64.b64encode(open(os.path.join(HERE, "assets", "mascot.png"), "rb").read()).decode()
    return "data:image/png;base64," + b

def render_pdf(chrome, html_path, pdf_path):
    subprocess.run([chrome, "--headless", "--no-sandbox", "--disable-gpu",
                    "--no-pdf-header-footer", "--print-to-pdf=" + pdf_path,
                    "file://" + html_path], stderr=subprocess.DEVNULL, check=True)

def main():
    os.makedirs(OUT, exist_ok=True)
    mascot = mascot_data_uri()
    onep = open(os.path.join(TPL, "onepager.html"), encoding="utf-8").read()
    comp = open(os.path.join(TPL, "comparison.html"), encoding="utf-8").read()
    best = open(os.path.join(TPL, "bestpractices.html"), encoding="utf-8").read()
    chrome = find_chrome()
    if not chrome:
        print("! No Chrome/Chromium found — writing .html only (open & print them).", file=sys.stderr)

    for b in BARS:
        name, vid = b["name"], b["id"]
        listing = qr_svg("%s/?r=%d" % (SITE, vid))
        setup   = qr_svg("%s/?owner=%d" % (SITE, vid))
        login   = qr_svg("%s/?login=%d" % (SITE, vid))
        slug = name.replace("The ", "").replace(" ", "_")

        pages = []
        op = (onep.replace("MASCOT_DATA_URI", mascot).replace("{{BARNAME}}", name)
              .replace("{{QR_LISTING}}", listing).replace("{{QR_SETUP}}", setup).replace("{{QR_LOGIN}}", login))
        cm = (comp.replace("MASCOT_DATA_URI", mascot).replace("QR_SVG", listing)
              .replace(">DrinkMinot.com<", ">%s<" % name.replace("The ", "")))
        bp = best.replace("MASCOT_DATA_URI", mascot).replace("{{BARNAME}}", name)
        for tag, html in [("onepager", op), ("comparison", cm), ("bestpractices", bp)]:
            hp = os.path.join(OUT, "%s_%s.html" % (slug, tag))
            open(hp, "w", encoding="utf-8").write(html)
            pages.append(hp)

        if not chrome:
            print("%s: wrote 3 HTML pages to marketing/out/" % name)
            continue

        import pymupdf
        packet = pymupdf.open()
        for hp in pages:
            pp = hp[:-5] + ".pdf"
            render_pdf(chrome, hp, pp)
            packet.insert_pdf(pymupdf.open(pp))
        out_pdf = os.path.join(OUT, "%s_Packet.pdf" % slug)
        packet.save(out_pdf)
        print("%s -> marketing/out/%s (%d pages)" % (name, os.path.basename(out_pdf), packet.page_count))

if __name__ == "__main__":
    main()
