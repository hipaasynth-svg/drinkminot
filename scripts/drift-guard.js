'use strict';
/* Drift guard — EatMinot / DrinkMinot twins. Plain Node, no npm dependencies:
     node scripts/drift-guard.js                 # self-consistency only
     node scripts/drift-guard.js ../drinkminot   # + cross-repo comparison

   WHY THIS EXISTS
   Two near-identical sites are maintained by hand, and every fix has to be ported
   twice. When a port is missed, nobody notices until a customer does. That has already
   happened three separate ways:

     - The founding tier shipped priced ABOVE the standard tier ($79 founding vs $59
       standard) while the pamphlets sold it as a discount. The rate lived as a bare
       '5900' literal three lines from a named FOUNDING_PRICE_CENTS constant, and nothing
       asserted the relationship between them.
     - DrinkMinot's one-pager sold "Founding Five / Only 5 spots" against a cap of 3, so
       bars 4 and 5 would have been sold a slot checkout refuses.
     - store.js adminSetFlag silently dropped agentEnabled, making an admin toggle a
       no-op. The same defect was fixed in one twin and never ported to the other.

   A byte-level diff between the twins is useless here: they legitimately differ by
   hundreds of lines (venue data, env prefixes, theme, per-site features). So this checks
   INVARIANTS instead — the handful of facts that must hold within a repo, and the
   smaller handful that must be identical across both.

   This file is deliberately byte-identical in both repos, and the cross-repo pass
   verifies that. Otherwise the guard becomes the next thing that drifts. */

var fs = require('fs');
var path = require('path');

var pass = 0, fail = 0;
function ok(cond, what) {
  if (cond) { pass++; console.log('  ok   ' + what); }
  else { fail++; console.log('  FAIL ' + what); }
}
function read(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}
function num(src, re) {
  var m = src && src.match(re);
  return m ? parseInt(m[1], 10) : null;
}
// Every .html a venue owner or prospect could actually be shown or handed, plus the
// admin console. Deliberately NOT the .md files: README.md and docs/AUDIT.md both discuss
// the banned "locked for a year" phrasing on purpose — one explaining why we don't promise
// it, one quoting the historical mistake — and a guard that can't tell a rule from a
// quotation of the rule is a guard people switch off.
function facingFiles(root) {
  var out = [];
  [['.'], ['docs'], ['marketing', 'templates']].forEach(function (parts) {
    var dir = path.join.apply(path, [root].concat(parts));
    var names;
    try { names = fs.readdirSync(dir); } catch (e) { return; }
    names.forEach(function (n) {
      if (n.slice(-5) === '.html') out.push(path.join(dir, n));
    });
  });
  return out;
}

/* ---------- the contract: the facts that must match across both twins ---------- */
function contract(root) {
  var lib = read(path.join(root, 'api', '_lib.js'));
  if (lib == null) return null;
  return {
    standardCents: num(lib, /var STANDARD_PRICE_CENTS\s*=\s*(\d+)\s*;/),
    foundingCents: num(lib, /FOUNDING_PRICE_CENTS\s*=\s*(\d+)/),
    foundingLimit: num(lib, /FOUNDING_LIMIT\s*=\s*(\d+)/),
    trialDays: num(lib, /FOUNDING_TRIAL_DAYS\s*=\s*(\d+)/)
  };
}

var LIMIT_WORD = { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six' };
// Stated monthly rates only. "$2,300 in repeat tabs" and "$2 off drafts" are not rates,
// so a bare dollar amount is ignored unless a /mo, /month or "a month" follows it —
// optionally through one closing tag, as in `$79<span>/month</span>`.
var RATE_RE = /\$(\d+)\s*(?:<[^>]*>)?\s*(?:\/\s*mo\b|\/\s*month\b|a month\b|per month\b)/g;
var STRUCK_RE = /<s\b[^>]*>\s*\$(\d+)\s*<\/s>/g;
// Matched literally, with no attempt to detect negation: a guard that tries to tell
// "locked for a year" from "we do not promise it is locked for a year" is a guard that
// eventually gets it wrong in the expensive direction. Owner-facing copy should simply not
// use the phrase, even to deny it — the reasoning for that belongs in README.md, which this
// guard does not scan.
var BANNED = [
  { re: /locked for (?:a|the|your)\b/i, why: 'promises a locked rate' },
  { re: /held for (?:a|the|your)(?: first)? year/i, why: 'promises a locked rate' },
  { re: /rate is locked/i, why: 'promises a locked rate' },
  { re: /locked \$\d/i, why: 'promises a locked rate' },
  { re: /Founding Five/i, why: 'names a cohort size the cap does not allow' }
];

/* ---------- layer 1: is this repo internally consistent? ---------- */
function selfCheck(root, label) {
  console.log('\n' + label + ' — constants');

  var c = contract(root);
  ok(c != null, 'api/_lib.js is readable');
  if (!c) return;

  ok(c.standardCents !== null, 'STANDARD_PRICE_CENTS is declared');
  ok(c.foundingCents !== null, 'FOUNDING_PRICE_CENTS is declared');
  ok(c.foundingLimit !== null, 'FOUNDING_LIMIT is declared');
  ok(c.trialDays !== null, 'FOUNDING_TRIAL_DAYS is declared');
  if (c.standardCents === null || c.foundingCents === null) return;

  // The invariant that actually broke. A founding rate at or above standard is never
  // correct, whatever the two numbers are: the offer is sold as a discount.
  ok(c.foundingCents < c.standardCents,
     'founding (' + c.foundingCents + ') undercuts standard (' + c.standardCents + ')');

  console.log('\n' + label + ' — no bare rate literal in checkout');
  var co = read(path.join(root, 'api', 'checkout.js')) || '';
  var bare = co.match(/'(\d{4})'/g) || [];
  ok(bare.length === 0,
     'api/checkout.js prices only via the constants' + (bare.length ? ' (found ' + bare.join(', ') + ')' : ''));

  console.log('\n' + label + ' — owner-facing labels match the constants');
  var idx = read(path.join(root, 'index.html')) || '';
  var pricing = idx.match(/var PRICING\s*=\s*\{[^}]*\}/);
  ok(!!pricing, 'index.html declares a single PRICING object');
  if (pricing) {
    var block = pricing[0];
    var std = num(block, /standard:\s*'\$(\d+)/);
    var fnd = num(block, /founding:\s*'\$(\d+)/);
    var wks = num(block, /trial:\s*'(\d+)\s*weeks?/);
    ok(std !== null && std * 100 === c.standardCents,
       'PRICING.standard $' + std + ' matches STANDARD_PRICE_CENTS ' + c.standardCents);
    ok(fnd !== null && fnd * 100 === c.foundingCents,
       'PRICING.founding $' + fnd + ' matches FOUNDING_PRICE_CENTS ' + c.foundingCents);
    ok(wks !== null && wks * 7 === c.trialDays,
       'PRICING.trial ' + wks + ' weeks matches FOUNDING_TRIAL_DAYS ' + c.trialDays);
  }

  console.log('\n' + label + ' — printed material agrees with the code');
  var allowed = {};
  allowed[c.standardCents / 100] = 'standard';
  allowed[c.foundingCents / 100] = 'founding';
  var files = facingFiles(root);
  ok(files.length > 0, 'found owner-facing pages to check (' + files.length + ')');

  files.forEach(function (f) {
    var src = read(f) || '';
    var rel = path.relative(root, f);
    var m, stated = {};
    RATE_RE.lastIndex = 0;
    while ((m = RATE_RE.exec(src)) !== null) stated[parseInt(m[1], 10)] = true;
    STRUCK_RE.lastIndex = 0;
    while ((m = STRUCK_RE.exec(src)) !== null) stated[parseInt(m[1], 10)] = true;

    Object.keys(stated).forEach(function (d) {
      ok(allowed[d] !== undefined,
         rel + ' states $' + d + (allowed[d] ? ' (' + allowed[d] + ')' : ' — NOT a current rate'));
    });

    // "Only N spots" and "Founding <Word>" must both agree with FOUNDING_LIMIT.
    var spots = src.match(/Only (\d+) spots?/i);
    if (spots) {
      ok(parseInt(spots[1], 10) === c.foundingLimit,
         rel + ' says "Only ' + spots[1] + ' spots" and the cap is ' + c.foundingLimit);
    }
    var word = src.match(/Founding (One|Two|Three|Four|Five|Six)\b/);
    if (word) {
      ok(word[1] === LIMIT_WORD[c.foundingLimit],
         rel + ' says "Founding ' + word[1] + '" and the cap is ' + c.foundingLimit);
    }

    BANNED.forEach(function (b) {
      var hit = src.match(b.re);
      ok(!hit, rel + ' does not say "' + (hit ? hit[0] : b.re.source) + '" — it ' + b.why);
    });
  });

  console.log('\n' + label + ' — every admin flag actually reaches the server');
  // The no-op bug class: api/admin.js accepts a flag that store.js never sends, so the
  // admin console shows a working toggle that changes nothing.
  var adm = read(path.join(root, 'api', 'admin.js')) || '';
  var start = adm.indexOf("b.action === 'setFlag'");
  var rest = start < 0 ? '' : adm.slice(start + 1);
  var next = rest.indexOf('b.action ===');
  var setFlagBlock = next < 0 ? rest : rest.slice(0, next);
  var accepted = {}, fm;
  var FLAG_RE = /typeof b\.(\w+) === 'boolean'/g;
  while ((fm = FLAG_RE.exec(setFlagBlock)) !== null) accepted[fm[1]] = true;
  var names = Object.keys(accepted);
  ok(names.length > 0, 'api/admin.js setFlag accepts boolean flags (' + names.length + ')');

  var store = read(path.join(root, 'store.js')) || '';
  var sfStart = store.indexOf('function adminSetFlag');
  var sfBlock = sfStart < 0 ? '' : store.slice(sfStart, sfStart + 4000);
  var serverCall = sfBlock.match(/action:\s*'setFlag'[^)]*\)/);
  var sent = serverCall ? serverCall[0] : '';
  names.forEach(function (n) {
    ok(sent.indexOf(n + ':') > -1,
       'store.js adminSetFlag forwards ' + n + ' (else the toggle is a no-op)');
  });

  console.log('\n' + label + ' — the regression suite is wired up');
  var pkg = read(path.join(root, 'package.json')) || '';
  ok(/tests\/founding\.test\.js/.test(pkg), 'npm test runs tests/founding.test.js');
  ok(fs.existsSync(path.join(root, 'tests', 'founding.test.js')), 'tests/founding.test.js exists');
}

/* ---------- layer 2: do the twins still agree? ---------- */
function crossCheck(a, b, aLabel, bLabel) {
  console.log('\n' + aLabel + ' vs ' + bLabel + ' — shared contract');
  var ca = contract(a), cb = contract(b);
  ok(ca != null && cb != null, 'both repos expose a readable api/_lib.js');
  if (!ca || !cb) return;

  // Both sites sell one offer at one price. An owner on one site and an owner on the
  // other compare notes, so a divergence here is a divergence a customer can see.
  Object.keys(ca).forEach(function (k) {
    ok(ca[k] === cb[k], k + ' matches (' + aLabel + ' ' + ca[k] + ' / ' + bLabel + ' ' + cb[k] + ')');
  });

  console.log('\n' + aLabel + ' vs ' + bLabel + ' — the guard guards itself');
  var ga = read(path.join(a, 'scripts', 'drift-guard.js'));
  var gb = read(path.join(b, 'scripts', 'drift-guard.js'));
  ok(ga != null && gb != null, 'both repos carry scripts/drift-guard.js');
  ok(ga != null && gb != null && ga === gb,
     'the two copies are byte-identical (a drifted guard checks the wrong contract)');
}

/* ---------- run ---------- */
var here = path.resolve(__dirname, '..');
var sibling = process.argv[2] ? path.resolve(process.argv[2]) : null;
function nameOf(root) {
  var pkg = read(path.join(root, 'package.json'));
  try { return JSON.parse(pkg).name; } catch (e) { return path.basename(root); }
}

var hereName = nameOf(here);
console.log('\n=== drift guard: ' + hereName + ' ===');
selfCheck(here, hereName);

if (sibling) {
  var sibName = nameOf(sibling);
  if (!fs.existsSync(path.join(sibling, 'api', '_lib.js'))) {
    console.log('\n  FAIL sibling repo at ' + sibling + ' has no api/_lib.js');
    fail++;
  } else {
    console.log('\n=== drift guard: ' + sibName + ' ===');
    selfCheck(sibling, sibName);
    crossCheck(here, sibling, hereName, sibName);
  }
} else {
  console.log('\n  (no sibling path given — cross-repo checks skipped)');
  console.log('  run: node scripts/drift-guard.js ../<twin> to compare both');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
