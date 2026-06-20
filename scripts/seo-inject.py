#!/usr/bin/env python3
# Idempotent SEO/quality injector for all *.html in the repo root.
# Adds: favicon, theme-color, Open Graph/Twitter tags, canonical; JSON-LD TravelAgency on index.html.
# Safe to re-run (guards by marker). Run: python3 scripts/seo-inject.py
import os, re, glob

BASE = 'https://iillyyaa1997.github.io/voyage-travel-preview'
OG_IMG = f'{BASE}/anex-logo.png'
MARK = '<!-- seo-inject -->'

PER_PAGE_OG = {
    'index.html':       ('Анекс Тур — турагентство в Нижнекамске', 'Подберём и оформим тур из Нижнекамска по лучшей цене. Турция, Египет, ОАЭ, Таиланд и др. Бесплатный подбор, официальный франчайзинговый офис Анекс. 4.9★ на Яндексе.'),
    'nizhnekamsk.html': ('Туры из Нижнекамска — Анекс Тур', 'Подбор и бронирование туров из Нижнекамска по лучшей цене. Любые направления, бесплатный подбор.'),
    'about.html':       ('О нас — Анекс Тур Нижнекамск', 'Официальный франчайзинговый офис Анекс в Нижнекамске. 4.9★ на Яндексе, бесплатный подбор туров.'),
    'contacts.html':    ('Контакты — Анекс Тур Нижнекамск', 'ТЦ «Панорама», ул. Шинников 42. Ежедневно 10:00–19:00. +7 (917) 878-37-58.'),
}

def og_title_desc(fn):
    if fn in PER_PAGE_OG:
        return PER_PAGE_OG[fn]
    # destination pages: derive from <title>
    return None

JSONLD = '''<script type="application/ld+json">
{"@context":"https://schema.org","@type":"TravelAgency","name":"Анекс Тур Нижнекамск","image":"%s","url":"%s/","telephone":"+7 917 878-37-58","priceRange":"₽₽","address":{"@type":"PostalAddress","streetAddress":"ул. Шинников, 42, ТЦ Панорама, 1 этаж","addressLocality":"Нижнекамск","addressCountry":"RU"},"openingHours":"Mo-Su 10:00-19:00","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.9","reviewCount":"21"},"sameAs":["https://vk.com/anexnk","https://yandex.ru/maps/org/anex/166654221318/","https://2gis.ru/nizhnekamsk/firm/70000001036243323"]}
</script>'''  % (OG_IMG, BASE)

def head_block(fn, title, desc):
    url = f'{BASE}/{"" if fn=="index.html" else fn}'
    b = [MARK,
         '<link rel="icon" href="favicon.svg" type="image/svg+xml">',
         '<meta name="theme-color" content="#e30613">',
         f'<link rel="canonical" href="{url}">',
         '<meta property="og:type" content="website">',
         f'<meta property="og:title" content="{title}">',
         f'<meta property="og:description" content="{desc}">',
         f'<meta property="og:image" content="{OG_IMG}">',
         f'<meta property="og:url" content="{url}">',
         '<meta property="og:site_name" content="Анекс Тур Нижнекамск">',
         '<meta name="twitter:card" content="summary_large_image">']
    if fn == 'index.html':
        b.append(JSONLD)
    return '\n'.join(b) + '\n'

def get_title(html):
    m = re.search(r'<title>(.*?)</title>', html, re.S)
    return (m.group(1).strip() if m else 'Анекс Тур Нижнекамск')

def get_desc(html):
    m = re.search(r'<meta name="description" content="(.*?)"', html, re.S)
    return (m.group(1).strip() if m else 'Подбор туров — Анекс Тур, Нижнекамск.')

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
changed = 0
for path in sorted(glob.glob(os.path.join(root, '*.html'))):
    fn = os.path.basename(path)
    html = open(path, encoding='utf-8').read()
    if MARK in html:
        continue
    td = og_title_desc(fn)
    title = (td[0] if td else get_title(html)).replace('"', '&quot;')
    desc = (td[1] if td else get_desc(html)).replace('"', '&quot;')
    blk = head_block(fn, title, desc)
    # insert right after <title>…</title> (or after charset)
    if '</title>' in html:
        html = html.replace('</title>', '</title>\n' + blk, 1)
    else:
        html = re.sub(r'(<meta charset=[^>]*>)', r'\1\n' + blk, html, count=1)
    open(path, 'w', encoding='utf-8').write(html)
    changed += 1
    print('seo+', fn)
print(f'done: {changed} file(s) updated')
