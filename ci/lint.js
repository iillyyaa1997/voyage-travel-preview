// Layout linter: loads each page at mobile/tablet/desktop widths in headless Chrome,
// reports horizontal overflow (the "вёрстка уехала вправо" bug), off-viewport elements, broken images.
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const CHROME = null;
const DIR = process.argv[2] || require('path').resolve(__dirname, '..');
const WIDTHS = [390, 768, 1440];
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.html')).sort();

// Raw-HTML tag-nesting validator — catches improper nesting (e.g. </a></div> where </div></a> expected)
// that browsers silently auto-correct (so DOM-based checks miss it) but which breaks layout.
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
function checkNesting(html) {
  // strip comments/scripts/styles to avoid false positives
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let m; const stack = []; const errs = [];
  while ((m = re.exec(html))) {
    const closing = m[1] === '/', tag = m[2].toLowerCase(), self = m[3] === '/' || VOID.has(tag);
    if (tag === 'html' || tag === 'body' || tag === 'head' || tag === 'meta') continue;
    if (closing) {
      if (!stack.length) { errs.push(`stray </${tag}>`); continue; }
      const top = stack[stack.length - 1];
      if (top.tag === tag) stack.pop();
      else {
        const back = [...stack].reverse().findIndex(x => x.tag === tag);
        const ctx = html.slice(Math.max(0, m.index - 40), m.index + 8).replace(/\s+/g, ' ');
        errs.push(`</${tag}> but <${top.tag}> still open — bad nesting near "…${ctx}"`);
        if (back >= 0) stack.length = stack.length - 1 - back;
      }
    } else if (!self) stack.push({ tag, index: m.index });
  }
  return errs.slice(0, 6);
}

const probe = (innerW) => {
  const docW = document.documentElement.scrollWidth;
  const overflow = docW - innerW;
  const offenders = [];
  if (overflow > 1) {
    const seen = new Set();
    [...document.querySelectorAll('body *')].forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > innerW + 2 || r.left < -2) {
        const sig = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
        const key = sig + '|' + Math.round(r.right);
        if (seen.has(sig)) return; seen.add(sig);
        offenders.push({ sig, right: Math.round(r.right), left: Math.round(r.left), w: Math.round(r.width), text: (el.textContent || '').trim().slice(0, 30) });
      }
    });
    offenders.sort((a, b) => b.right - a.right);
  }
  const broken = [...document.images].filter(im => !im.complete || im.naturalWidth === 0).map(im => im.getAttribute('src'));
  return { docW, innerW, overflow, offenders: offenders.slice(0, 6), broken };
};

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
  let problems = 0;
  for (const f of files) {
    const url = 'file://' + path.join(DIR, f);
    const nestErrs = checkNesting(fs.readFileSync(path.join(DIR, f), 'utf8'));
    if (nestErrs.length) {
      problems++;
      console.log(`\n✗ ${f}  HTML NESTING:`);
      nestErrs.forEach(e => console.log(`    → ${e}`));
    }
    for (const w of WIDTHS) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
      await page.goto(url, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 250));
      const res = await page.evaluate(probe, w);
      await page.close();
      const flags = [];
      if (res.overflow > 1) flags.push(`OVERFLOW +${res.overflow}px (doc ${res.docW} > vp ${w})`);
      const realBroken = res.broken.filter(s => s && !/^https?:/.test(s)); // ignore external (sandbox) imgs
      if (realBroken.length) flags.push(`BROKEN IMG: ${realBroken.join(', ')}`);
      if (flags.length) {
        problems++;
        console.log(`\n✗ ${f} @${w}px  ${flags.join(' | ')}`);
        res.offenders.forEach(o => console.log(`    → ${o.sig}  right=${o.right} w=${o.w}  "${o.text}"`));
      }
    }
  }
  await browser.close();
  console.log(problems ? `\n=== ${problems} issue(s) found ===` : '\n=== OK: no overflow / broken images ===');
  process.exit(problems ? 1 : 0);
})();
