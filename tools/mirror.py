"""Crea una copia estatica de https://www.cepasconhistoria.com en ./site

Uso:  python tools/mirror.py [directorio_salida]          (rastrear + postproceso)
      python tools/mirror.py [directorio_salida] --post   (solo postproceso)

- Rastrea todas las paginas HTML internas (siguiendo enlaces + sitemap).
- Descarga todos los recursos del dominio (CSS, JS, imagenes, fuentes, video).
- Reescribe las URLs absolutas del dominio a rutas relativas a la raiz (/...).
"""
import html
import re
import sys
import time
from collections import deque
from pathlib import Path
from urllib.parse import urljoin, urlsplit, unquote

import requests
from bs4 import BeautifulSoup

BASE = "https://www.cepasconhistoria.com"
HOSTS = {"www.cepasconhistoria.com", "cepasconhistoria.com"}
_args = [a for a in sys.argv[1:] if not a.startswith("--")]
OUT = Path(_args[0] if _args else "site").resolve()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) static-mirror"

SKIP = re.compile(
    r"^/(wp-admin|wp-login|wp-json|xmlrpc\.php|wp-cron\.php|cgi-bin)"
    r"|/feed/?$|/embed/?$|/trackback/?$"
    r"|^/(?!\d{4}/|page/)[^/]+/\d+/?$"  # /slug/123/ = paginacion interna falsa de WP
)
ABS_RE = re.compile(
    r"(?:https?:)?(?:\\?/){2}(?:www\.)?cepasconhistoria\.com((?:\\?/)[^\s\"'<>()\\]*(?:\\/[^\s\"'<>()\\]*)*)?"
)
CSS_URL_RE = re.compile(r"url\(\s*['\"]?([^'\")]+?)['\"]?\s*\)|@import\s+['\"]([^'\"]+)['\"]")

session = requests.Session()
session.headers["User-Agent"] = UA

pages_q, assets_q = deque(), deque()
seen = set()
saved = {}  # url -> local path
errors = []


def norm(url, base=BASE + "/"):
    """Devuelve URL absoluta normalizada si es del dominio, si no None."""
    if not url:
        return None
    url = html.unescape(url.strip()).replace("\\/", "/")
    if url.startswith(("data:", "mailto:", "tel:", "javascript:", "#")):
        return None
    url = urljoin(base, url)
    p = urlsplit(url)
    if p.hostname not in HOSTS or p.scheme not in ("http", "https"):
        return None
    path = p.path or "/"
    if SKIP.search(path):
        return None
    if p.query and not re.search(r"\.\w{2,5}$", path) and not re.search(r"/page/\d+/?$", path):
        return None  # URLs dinamicas (?s=, ?replytocom=, ?p=) no se reflejan
    return f"https://www.cepasconhistoria.com{path}"  # query descartada en assets


def is_asset(url):
    last = urlsplit(url).path.rsplit("/", 1)[-1]
    return "." in last and not last.endswith((".php", ".html", ".htm"))


def enqueue(url):
    if url and url not in seen:
        seen.add(url)
        (assets_q if is_asset(url) else pages_q).append(url)


def local_path(url, is_html):
    path = unquote(urlsplit(url).path)
    if is_html:
        if not path.endswith("/") and not path.endswith((".html", ".htm")):
            path += "/"
        if path.endswith("/"):
            path += "index.html"
    return OUT / path.lstrip("/")


def fetch(url):
    for attempt in range(3):
        try:
            r = session.get(url, timeout=60)
            time.sleep(0.15)
            return r
        except requests.RequestException as e:
            if attempt == 2:
                errors.append(f"{url}: {e}")
            time.sleep(2)
    return None


def scan_text_for_abs(text):
    for m in ABS_RE.finditer(text):
        enqueue(norm(m.group(0)))


def scan_css(text, css_url):
    for m in CSS_URL_RE.finditer(text):
        enqueue(norm(m.group(1) or m.group(2), css_url))


def handle_page(url):
    r = fetch(url)
    if r is None:
        return
    final = norm(r.url) or url
    if r.status_code != 200:
        errors.append(f"{url}: HTTP {r.status_code}")
        return
    if "text/html" not in r.headers.get("Content-Type", ""):
        save_bytes(url, r.content, False)
        return
    if final != url:  # redireccion interna -> asegurar destino
        enqueue(final)
    text = r.text
    soup = BeautifulSoup(text, "html.parser")
    for tag in soup.find_all(True):
        for attr, val in tag.attrs.items():
            if isinstance(val, list):
                val = " ".join(val)
            if attr in ("href", "src", "poster", "action"):
                enqueue(norm(val, url))
            elif (attr == "content" or attr.startswith("data-")) and val.strip().startswith(("http", "//", "/")):
                enqueue(norm(val, url))
            elif attr in ("srcset", "data-srcset", "imagesrcset"):
                for part in val.split(","):
                    enqueue(norm(part.strip().split(" ")[0], url))
            elif attr == "style":
                scan_css(val, url)
    for st in soup.find_all("style"):
        scan_css(st.get_text(), url)
    scan_text_for_abs(text)
    save_bytes(url, r.content, True)
    print(f"[page]  {url}")


def handle_asset(url):
    r = fetch(url)
    if r is None:
        return
    if r.status_code != 200:
        errors.append(f"{url}: HTTP {r.status_code}")
        return
    if "text/html" in r.headers.get("Content-Type", "") and not url.endswith((".html", ".htm")):
        # p.ej. /algo.php-like o rutas con punto que son paginas
        pages_q.append(url)
        return
    if url.endswith(".css"):
        scan_css(r.text, url)
        scan_text_for_abs(r.text)
    elif url.endswith((".js", ".json", ".svg")):
        scan_text_for_abs(r.text)
    save_bytes(url, r.content, False)


def save_bytes(url, data, is_html):
    p = local_path(url, is_html)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    saved[url] = p


# ---- Reescritura de URLs ---------------------------------------------------
REWRITES = [
    (re.compile(r"https?:\\/\\/(?:www\.)?cepasconhistoria\.com(?=\\/|[\"'])"), ""),
    (re.compile(r"(?:https?:)?//(?:www\.)?cepasconhistoria\.com(?=/|[\"'\s<)?#])"), ""),
]
STRIP_HEAD = [
    re.compile(r"<link[^>]+rel=['\"](?:EditURI|wlwmanifest|pingback|shortlink|https://api\.w\.org/)['\"][^>]*>\s*", re.I),
    re.compile(r"<link[^>]+type=['\"]application/(?:rss|atom)\+xml['\"][^>]*>\s*", re.I),
    re.compile(r"<link[^>]+type=['\"](?:application/json\+oembed|text/xml\+oembed)['\"][^>]*>\s*", re.I),
    re.compile(r"<link[^>]+rel=['\"]alternate['\"][^>]+/wp-json/[^>]*>\s*", re.I),
]


# Zonas que deben seguir con URL absoluta (SEO): canonical, Open Graph/Twitter y JSON-LD
PROTECT = re.compile(
    r"<link[^>]+rel=['\"]canonical['\"][^>]*>"
    r"|<meta[^>]+(?:property|name)=['\"](?:og:|twitter:)[^>]*>"
    r"|<script[^>]+application/ld\+json[^>]*>.*?</script>",
    re.S | re.I,
)


def rewrite(text, is_html):
    if is_html:
        for rx in STRIP_HEAD:
            text = rx.sub("", text)
        out, pos = [], 0
        for m in PROTECT.finditer(text):
            out.append(rewrite_urls(text[pos:m.start()], True))
            out.append(m.group(0).replace("http://www.cepasconhistoria.com", BASE))
            pos = m.end()
        out.append(rewrite_urls(text[pos:], True))
        return "".join(out)
    return rewrite_urls(text, False)


def rewrite_urls(text, is_html):
    for rx, rep in REWRITES:
        text = rx.sub(rep, text)
    if is_html:
        # enlace a la raiz que quedo vacio: href="" -> href="/" (solo atributos
        # HTML reales, no concatenaciones JS tipo '<a href="'+url)
        text = re.sub(r'(\s(?:href|action)=)(["\'])\2(?=[\s>/])', r"\1\2/\2", text)
    return text


def write_hosting_files():
    """Ficheros para GitHub Pages: dominio, sin Jekyll, robots y sitemap."""
    (OUT / "CNAME").write_text("www.cepasconhistoria.com\n", encoding="utf-8")
    (OUT / ".nojekyll").write_text("", encoding="utf-8")
    (OUT / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n", encoding="utf-8"
    )
    urls = sorted(
        "/" + p.parent.relative_to(OUT).as_posix() + "/"
        for p in OUT.rglob("index.html")
    )
    urls = [u.replace("/./", "/") for u in urls]
    urls = [u for u in urls if not re.search(r"/page/\d+/|^/author/|^/\d{4}/", u)]
    body = "".join(f"  <url><loc>{BASE}{u}</loc></url>\n" for u in urls)
    (OUT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{body}</urlset>\n",
        encoding="utf-8",
    )


EXTRAS = Path(__file__).resolve().parent.parent / "extras"
FORM_TAG = '<script src="/assets/js/formularios.js" defer></script>'


def postprocess():
    """Anade lo propio de la version estatica: ficheros de extras/ y el script
    de formularios (Firebase) en las paginas con Contact Form 7."""
    import shutil

    if EXTRAS.is_dir():
        shutil.copytree(EXTRAS, OUT, dirs_exist_ok=True)
    n = 0
    for p in OUT.rglob("*.html"):
        t = p.read_text(encoding="utf-8")
        if "wpcf7-form" in t and FORM_TAG not in t:
            t = t.replace("</body>", FORM_TAG + "\n</body>", 1)
            p.write_text(t, encoding="utf-8", newline="")
            n += 1
    write_hosting_files()
    print(f"Postproceso: script de formularios anadido a {n} paginas")


def main():
    if "--post" in sys.argv:  # solo postproceso, sin rastrear
        postprocess()
        return
    OUT.mkdir(parents=True, exist_ok=True)
    enqueue(BASE + "/")
    for sm in ("page-sitemap.xml", "post-sitemap.xml", "category-sitemap.xml"):
        r = fetch(f"{BASE}/{sm}")
        if r is not None and r.status_code == 200:
            for loc in re.findall(r"<loc>([^<]+)</loc>", r.text):
                enqueue(norm(loc))
    while pages_q or assets_q:
        if pages_q:
            handle_page(pages_q.popleft())
        else:
            handle_asset(assets_q.popleft())

    # 404 personalizada
    r = fetch(f"{BASE}/__pagina-inexistente-mirror__/")
    if r is not None and "text/html" in r.headers.get("Content-Type", ""):
        (OUT / "404.html").write_bytes(r.content)
        saved["404"] = OUT / "404.html"

    for url, p in saved.items():
        if p.suffix in (".html", ".htm", ".css", ".js", ".json", ".xml", ".svg", ".txt"):
            try:
                t = p.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            p.write_text(rewrite(t, p.suffix in (".html", ".htm")), encoding="utf-8", newline="")

    postprocess()
    pages = sum(1 for p in saved.values() if p.suffix == ".html")
    print(f"\nPaginas: {pages}  Recursos: {len(saved) - pages}  Errores: {len(errors)}")
    for e in errors:
        print("  ERR", e)


if __name__ == "__main__":
    main()
