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

## Formularios

Los formularios de Contact Form 7 (fichas de vino y artículos del blog) se envían con
[extras/assets/js/formularios.js](extras/assets/js/formularios.js): valida en el navegador y llama
a la Cloud Function `contactoWeb` del proyecto Firebase `grupodelgado-prod` (la misma que usa
delgadoseleccion.com), protegida con App Check + reCAPTCHA Enterprise.

- Los ficheros de `extras/` se copian a `site/`, y el `<script>` se añade a las páginas con formulario
  mediante `python tools/mirror.py site --post` (también se hace al regenerar).
- La clave de reCAPTCHA Enterprise debe tener `cepasconhistoria.com` en su lista de dominios permitidos.
- Si se deja vacía `recaptchaSiteKey`, el formulario abre el correo del visitante dirigido a info@cepasconhistoria.com.

El popup de newsletter es de Mailchimp (script externo) y no depende de esta web.

## Limitaciones

El buscador de Divi (`?s=`) necesita PHP y no funciona en estático.
