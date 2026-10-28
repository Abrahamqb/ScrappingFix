# Fix Scraper API

API en Node.js/Express que hace lo mismo que la antigua versión FastAPI:

- `GET /download?game=...` → descarga el fix (RAR/ZIP) alojado en `uploads.online-fix.me`.
- `GET /chibimc/{jugador}` → ZIP con todos los GIFs chibi de esa skin.
- `GET /chibimc/{jugador}/gif/{gif}` → un único GIF.
- Listados de resoluciones y de GIFs disponibles.

Todo está pensado para funcionar tanto en local como en **Vercel** (funciones serverless).

---

## Requisitos

- Node.js **22.17+** (o 24).
- En local: Chrome o Edge instalados (no hace falta descargar nada).
- Opcional: `npx playwright install chromium` si no tienes ninguno de los dos.

## Arrancar en local

```bash
npm install
npm run dev
```

La API queda en `http://127.0.0.1:3000`.

Variables de entorno opcionales (archivo `.env` en la raíz, se carga solo):

| Variable | Para qué sirve |
| --- | --- |
| `DLE_USER_ID` | Cookie `dle_user_id` para `/download` (el host responde 401 sin ella). |
| `DLE_PASSWORD` | Cookie `dle_password` para `/download`. |
| `BLOB_READ_WRITE_TOKEN` | Token de Vercel Blob. Si está, las respuestas > 4.2 MB se suben a Blob y se devuelve un 302. |
| `CHIBI_MAX_CONCURRENT` | Navegadores simultáneos (por defecto `2`). |
| `PORT` | Puerto local (por defecto `3000`). |

---

## Endpoints

### `GET /download?game=Nombre Del Juego`

Descarga el primer archivo del directorio `Fix Repair` del juego. Devuelve el binario con
`Content-Disposition: attachment` y `Accept-Ranges: bytes`.

- Sin `game` → `400 {"detail": "Debes indicar el nombre del juego (?game=)."}`
- Directorio inexistente → `404 {"detail": "Directory not found"}`
- Sin cookies válidas → `502` indicando que revises `DLE_USER_ID` / `DLE_PASSWORD`.

### `GET /chibimc/{jugador}`

ZIP con **todas** las animaciones chibi de la skin del jugador, a la resolución indicada.
Sin `?size` se usa la resolución nativa (`1`).

```
GET /chibimc/Notch          → Notch.zip
GET /chibimc/Notch?size=8   → Notch-x8.zip
```

### `GET /chibimc/{jugador}?size=`

Con `?size=` **vacío** devuelve las resoluciones disponibles:

```json
{
  "player": "Notch",
  "default": 1,
  "sizes": [
    { "size": 1, "label": "native", "url": "/chibimc/Notch?size=1" },
    { "size": 2, "label": "x2", "url": "/chibimc/Notch?size=2" }
  ]
}
```

Resoluciones válidas: `1, 2, 4, 8, 16`. La `32` está desactivada a propósito
(ver notas de Vercel).

### `GET /chibimc/{jugador}/gif/`

Lista todos los GIFs válidos (nombre interno, etiqueta, nombre de archivo y URL).

### `GET /chibimc/{jugador}/gif/{gif}`

Devuelve ese GIF tal cual lo genera la web. Acepta varias formas del nombre:

```
/chibimc/Notch/gif/idle
/chibimc/Notch/gif/idle.gif
/chibimc/Notch/gif/chibi-Notch-x8-totem.gif?size=8
```

`?size=` vacío en cualquiera de las dos rutas de GIF devuelve el JSON de resoluciones.

Todos los errores mantienen el formato de FastAPI: `{"detail": "..."}`.

---

## Desplegar en Vercel

```bash
npm i -g vercel
vercel
```

`vercel.json` ya configura la función (`index.js`) con `maxDuration: 300`, `memory: 2048`
y los binarios de `@sparticuz/chromium` incluidos. Añade las variables de entorno en el
dashboard (**Settings → Environment Variables**).

### Notas importantes

- **Chromium**: en Vercel se usa `@sparticuz/chromium@153.0.0` con
  `playwright-core@1.63.0`. Esa pareja está fijada a propósito: Playwright 1.63 espera
  Chromium 153 y 1.64 ya espera 156. **No actualices una sin la otra.**
- **Límite de 4.5 MB**: Vercel corta cualquier respuesta mayor. Con el máximo actual
  (`size=16`, ZIP de ~3.6 MB) se queda por debajo, así que no debería hacer falta nada
  extra. `size=32` está desactivado (ZIP de ~8.6 MB); si algún día lo reactivas en
  `src/config.js`, necesitarás `BLOB_READ_WRITE_TOKEN` para subirlo a Blob y responder
  con un 302. Sin token, esa descarga fallará en Vercel (en local funcionaría).
- **Tiempo**: generar el ZIP completo tarda ~25-30 s con cualquier resolución hasta
  `x16`. El máximo de la función es 300 s.
- **Concurrencia**: cada petición abre su propio navegador. `CHIBI_MAX_CONCURRENT`
  limita cuántos hay a la vez dentro de una misma instancia.

---

## Estructura

```
index.js            App Express, rutas y manejo de errores
src/config.js       Constantes (resoluciones, URLs, límites)
src/download.js     /download (cheerio + streaming)
src/chibi.js        Lógica de /chibimc/* (ZIP, GIFs, validaciones)
src/js.js           Funciones que se ejecutan dentro de nogard.dev
src/browser.js      Lanza Chrome/Edge en local o Chromium de Lambda en Vercel
src/catalog.js      Lista de animaciones (cache 1 h)
src/send.js         Envío inline o vía Vercel Blob si supera 4.2 MB
src/errors.js       ApiError y utilidades
legacy-python/      Versión FastAPI original (excluida del deploy)
```
