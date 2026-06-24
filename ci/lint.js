// Layout linter: loads each page at mobile/tablet/desktop widths in headless Chrome,
// reports horizontal overflow (the "вёрстка уехала вправо" bug), off-viewport elements, broken images.
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');


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


function checkDeadCta(html){
  const errs=[];
  // <button> with no onclick/type=submit (static site → does nothing)
  (html.match(/<button(?![^>]*onclick)[^>]*>/gi)||[]).forEach(m=>errs.push('dead <button> (no link/onclick): '+m.slice(0,60)));
  // CTA-styled divs that look like buttons but aren't <a>
  ['btn1','btn2','qcta','sub','b2'].forEach(c=>{
    const re=new RegExp('<div class="'+c+'"[^>]*>','g'); let m;
    while((m=re.exec(html))) errs.push('CTA <div class="'+c+'"> is not a link (<a>) → click does nothing');
  });
  return errs.slice(0,8);
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
  // vertical overlap of top-level stacked blocks (catches negative-margin "наезд")
  const sig = el => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
  const blocks = [...document.body.children].filter(el => {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    return r.height > 20 && cs.position !== 'absolute' && cs.position !== 'fixed' && el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT';
  }).map(el => ({ el, r: el.getBoundingClientRect() })).sort((a, b) => a.r.top - b.r.top);
  const overlaps = [];
  for (let i = 1; i < blocks.length; i++) {
    const ov = Math.round(blocks[i - 1].r.bottom - blocks[i].r.top);
    if (ov > 8) overlaps.push(`${sig(blocks[i-1].el)} ↕ ${sig(blocks[i].el)} overlap ${ov}px`);
  }
  return { docW, innerW, overflow, offenders: offenders.slice(0, 6), broken, overlaps: overlaps.slice(0, 5) };
};

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
  let problems = 0;
  for (const f of files) {
    const url = 'file://' + path.join(DIR, f);
    const _html = fs.readFileSync(path.join(DIR, f), 'utf8');
    const nestErrs = checkNesting(_html);
    const ctaErrs = checkDeadCta(_html);
    if (ctaErrs.length){ problems++; console.log(`\n✗ ${f}  DEAD CTA:`); ctaErrs.forEach(e=>console.log('    → '+e)); }
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
      if (res.overlaps && res.overlaps.length) flags.push(`OVERLAP: ${res.overlaps.join(' ; ')}`);
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
