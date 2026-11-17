# cepasconhistoria.com

Copia estática de la web de Cepas con Historia (antes en WordPress + Divi), publicada con GitHub Pages en https://www.cepasconhistoria.com.

## Estructura

- `site/`: la web publicada (HTML, CSS, JS e imágenes). Incluye `CNAME`, `robots.txt`, `sitemap.xml` y `404.html`.
- `tools/mirror.py`: regenera `site/` rastreando la WordPress original.
- `tools/serve.py`: servidor local para previsualizar (admite Range, necesario para los vídeos MP4).
- `.github/workflows/pages.yml`: publica `site/` en GitHub Pages en cada push a `main`.

## Uso

```sh
python tools/serve.py 8000          # previsualizar en http://127.0.0.1:8000/
python tools/mirror.py site         # regenerar desde la WordPress (si sigue en línea)
```

Las rutas son relativas a la raíz (`/wp-content/...`), así que la web debe servirse en la raíz del dominio.

## DNS para GitHub Pages

- `www` → registro CNAME a `elswork.github.io`
- `cepasconhistoria.com` (apex) → registros A: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`

## Limitaciones

Los formularios de Contact Form 7 (contacto y newsletter) y el buscador de Divi necesitan PHP y no funcionan en estático.
