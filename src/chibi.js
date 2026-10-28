import { zipSync } from "fflate";
import {
  CHIBI_MAX_CONCURRENT,
  CHIBI_SIZES,
  CHIBI_TOOL_URL,
  DEFAULT_CHIBI_SIZE,
  MC_API_PROFILE_URL,
  USER_AGENT,
} from "./config.js";
import { fetchAnimationCatalog } from "./catalog.js";
import { launchBrowser } from "./browser.js";
import { ApiError, isTimeout, shortError } from "./errors.js";
import { sendFile } from "./send.js";
import {
  availableSizes,
  exportAnimation,
  installCapture,
  listAnimations,
  loadSkinFromBase64,
  readLastExport,
  setSize,
} from "./js.js";

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const safeFilename = (name) =>
  String(name || "").replace(/[^A-Za-z0-9_.-]/g, "_") || "player";

const cleanName = (name) => String(name || "").trim();

class Semaphore {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    const next = this.queue.shift();
    if (next) next();
    else this.active -= 1;
  }
}

const slots = new Semaphore(CHIBI_MAX_CONCURRENT);

async function withSlot(callback) {
  await slots.acquire();
  try {
    return await callback();
  } finally {
    slots.release();
  }
}

function withTimeout(promise, ms, detail) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ApiError(504, detail)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// Validaciones / payloads
// ---------------------------------------------------------------------------

// Comprueba en mc-api.io que el jugador existe y devuelve su nombre canónico.
export async function checkPlayer(nombre) {
  let response;
  try {
    response = await fetch(MC_API_PROFILE_URL(nombre), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new ApiError(502, `No se pudo consultar mc-api.io: ${shortError(error)}`);
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (response.status === 404) {
    throw new ApiError(404, `El jugador '${nombre}' no existe en Minecraft Java.`);
  }
  if (response.status === 400) {
    throw new ApiError(400, payload.message || "Nombre de jugador no válido.");
  }
  if (response.status !== 200) {
    throw new ApiError(502, `mc-api.io respondió con estado ${response.status}.`);
  }

  const skinUrl =
    payload.decodedTexture?.textures?.SKIN?.url ||
    payload.decodedTexture?.textures?.skin?.url ||
    null;

  return {
    name: payload.name || nombre,
    skinUrl: skinUrl ? skinUrl.replace(/^http:\/\//i, "https://") : null,
  };
}

// ---------------------------------------------------------------------------
// Descarga de la skin
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = "89504e470d0a1a0a";

const isPng = (buffer) =>
  buffer.length > 100 && buffer.subarray(0, 8).toString("hex") === PNG_SIGNATURE;

async function downloadSkin(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "image/png,image/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!isPng(buffer)) throw new Error("la respuesta no es un PNG");
  return buffer;
}

// La skin se descarga desde el servidor, no desde el navegador: dentro de
// nogard.dev el fetch a mc-heads.net falla de forma intermitente (sobre todo en
// Vercel) y la web aborta con "Could not load skin. Check the username.".
// Primero se usa la textura oficial que ya devuelve mc-api.io y, si no hay,
// mc-heads.net como respaldo.
async function fetchSkinPng(username, skinUrl = null) {
  const sources = [
    skinUrl,
    `https://mc-heads.net/skin/${encodeURIComponent(username)}`,
  ].filter(Boolean);

  let lastError = null;
  for (const url of sources) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await downloadSkin(url);
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        }
      }
    }
  }

  throw new ApiError(
    502,
    `No se pudo descargar la skin de '${username}': ${shortError(lastError)}`
  );
}

// Acepta 'idle', 'idle.gif' o 'chibi-Notch-x8-idle.gif' y devuelve el nombre interno.
export function resolveAnimation(raw, items, username) {
  let value = String(raw || "").trim();
  if (value.toLowerCase().endsWith(".gif")) value = value.slice(0, -4);

  const dropSize = (candidate) =>
    candidate
      .replace(/(?:^|-)x\d+(?=-|$)/gi, "")
      .replace(/^-+|-+$/g, "");

  const variants = [value, dropSize(value)];
  if (value.toLowerCase().startsWith("chibi-")) {
    let rest = value.slice(6);
    if (rest.toLowerCase().startsWith(`${username.toLowerCase()}-`)) {
      rest = rest.slice(username.length + 1);
    }
    variants.push(rest, dropSize(rest));
  }

  const lookup = new Map(items.map((item) => [item.name.toLowerCase(), item.name]));
  for (const candidate of variants) {
    const match = lookup.get(candidate.toLowerCase());
    if (match) return match;
  }

  const available = items.map((item) => item.name).join(", ");
  throw new ApiError(
    404,
    `El GIF '${raw}' no existe. Nombres disponibles: ${available}.`
  );
}

// undefined = sin query (usa la default); '' = '?size=' vacío (resoluciones).
// Devuelve: número de tamaño, null para la lista, o lanza 400.
export function parseChibiSize(raw) {
  if (raw === undefined) return DEFAULT_CHIBI_SIZE;
  const text = String(raw).trim();
  if (text === "") return null;

  const size = Number(text);
  if (!Number.isInteger(size)) {
    throw new ApiError(
      400,
      `El tamaño '${raw}' no es válido. Resoluciones disponibles: ${CHIBI_SIZES.join(", ")}.`
    );
  }
  if (!CHIBI_SIZES.includes(size)) {
    throw new ApiError(
      400,
      `El tamaño ${size} no está disponible. Resoluciones disponibles: ${CHIBI_SIZES.join(", ")}.`
    );
  }
  return size;
}

export function sizesPayload(player, baseUrl = null) {
  return {
    player,
    default: DEFAULT_CHIBI_SIZE,
    sizes: CHIBI_SIZES.map((size) => ({
      size,
      label: size === 1 ? "native" : `x${size}`,
      ...(baseUrl ? { url: `${baseUrl}?size=${size}` } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// Scraping de nogard.dev
// ---------------------------------------------------------------------------

async function openToolPage(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  try {
    await page.goto(CHIBI_TOOL_URL, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.waitForFunction(
      () =>
        window.__csm &&
        document.getElementById("viewerLoading") &&
        document.getElementById("viewerLoading").hidden,
      undefined,
      { timeout: 120_000 }
    );
  } catch (error) {
    await context.close().catch(() => {});
    if (isTimeout(error)) {
      throw new ApiError(
        504,
        "La herramienta de nogard.dev tardó demasiado en cargar."
      );
    }
    throw new ApiError(502, `No se pudo abrir nogard.dev: ${shortError(error)}`);
  }

  return { context, page };
}

async function exportGif(page, anim) {
  let frames;
  try {
    frames = await withTimeout(
      page.evaluate(exportAnimation, anim),
      180_000,
      `La animación '${anim}' tardó demasiado en exportarse.`
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      502,
      `Fallo al exportar la animación '${anim}': ${shortError(error)}`
    );
  }

  // El GIF se captura del Blob; si aún no está, se espera un poco.
  let captured = await page.evaluate(readLastExport);
  if (!captured) {
    await page
      .waitForFunction(() => window.__csmLastExport !== null, undefined, {
        timeout: 15_000,
      })
      .catch(() => {});
    captured = await page.evaluate(readLastExport);
  }

  if (!captured) {
    throw new ApiError(
      502,
      `La animación '${anim}' no generó ningún archivo (${frames} frames).`
    );
  }

  const buffer = Buffer.from(captured.base64, "base64");
  if (!buffer.length) {
    throw new ApiError(502, `La animación '${anim}' devolvió un GIF vacío.`);
  }

  return { name: captured.name, buffer };
}

// Descarga un GIF por animación (o solo la indicada).
export async function exportChibiGifs(
  username,
  size,
  onlyAnimation = null,
  skinUrl = null
) {
  // Se descarga antes de abrir el navegador: si falla, no se gasta un Chromium.
  const skin = await fetchSkinPng(username, skinUrl);

  const browser = await launchBrowser();
  let context = null;

  try {
    const opened = await openToolPage(browser);
    context = opened.context;
    const { page } = opened;

    await page.evaluate(installCapture);

    try {
      await page.evaluate(loadSkinFromBase64, {
        base64: skin.toString("base64"),
        filename: `${username}.png`,
      });
    } catch (error) {
      throw new ApiError(
        502,
        `No se pudo cargar la skin de '${username}' en nogard.dev: ${shortError(error)}`
      );
    }

    let animations = await page.evaluate(listAnimations);
    if (!Array.isArray(animations) || !animations.length) {
      throw new ApiError(502, "No se encontraron animaciones en nogard.dev.");
    }

    // La web es la fuente de verdad de las resoluciones disponibles.
    let siteSizes;
    try {
      siteSizes = await page.evaluate(availableSizes);
      if (!siteSizes.includes(size)) {
        throw new ApiError(
          400,
          `El tamaño ${size} no está disponible en nogard.dev. ` +
            `Resoluciones disponibles: ${siteSizes.join(", ")}.`
        );
      }
      await page.evaluate(setSize, size);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        502,
        `No se pudo aplicar la resolución ${size}: ${shortError(error)}`
      );
    }

    if (onlyAnimation) {
      if (!animations.includes(onlyAnimation)) {
        throw new ApiError(
          404,
          `La animación '${onlyAnimation}' no está disponible.`
        );
      }
      animations = [onlyAnimation];
    }

    const gifs = [];
    for (const anim of animations) {
      const gif = await exportGif(page, anim);
      const suffix = size === DEFAULT_CHIBI_SIZE ? "" : `x${size}-`;
      gifs.push({
        name: safeFilename(gif.name || `chibi-${username}-${suffix}${anim}.gif`),
        buffer: gif.buffer,
      });
    }

    if (!gifs.length) throw new ApiError(502, "No se pudo exportar ningún GIF.");
    return gifs;
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Construcción de la respuesta
// ---------------------------------------------------------------------------

export async function buildChibiZip(username, size, skinUrl = null) {
  return withSlot(async () => {
    const gifs = await exportChibiGifs(username, size, null, skinUrl);
    const files = {};
    for (const gif of gifs) files[gif.name] = gif.buffer;

    const zipped = zipSync(files, { level: 6 });
    const suffix = size === DEFAULT_CHIBI_SIZE ? "" : `-x${size}`;
    return {
      buffer: Buffer.from(zipped),
      filename: `${safeFilename(username)}${suffix}.zip`,
      count: gifs.length,
    };
  });
}

export async function buildChibiGif(username, size, animation, skinUrl = null) {
  return withSlot(async () => {
    const gifs = await exportChibiGifs(username, size, animation, skinUrl);
    return { buffer: gifs[0].buffer, filename: gifs[0].name };
  });
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

export function registerChibi(app) {
  app.get("/chibimc/:nombre", async (req, res) => {
    const nombre = cleanName(req.params.nombre);
    if (!nombre) {
      throw new ApiError(400, "Debes indicar un nombre de jugador.");
    }

    // 1) ¿Existe el jugador en Minecraft Java (mc-api.io)?
    const player = await checkPlayer(nombre);
    const canonical = player.name;

    // 2) ¿?size= vacío? -> JSON con las resoluciones disponibles.
    const size = parseChibiSize(req.query.size);
    if (size === null) {
      return res.json(
        sizesPayload(canonical, `/chibimc/${encodeURIComponent(canonical)}`)
      );
    }

    // 3) Scraping: una skin, todas las animaciones en GIF.
    const zip = await buildChibiZip(canonical, size, player.skinUrl);

    return sendFile(res, zip.buffer, {
      filename: zip.filename,
      contentType: "application/zip",
      headers: {
        "X-Minecraft-Player": canonical,
        "X-Chibi-Animations": String(zip.count),
        "X-Chibi-Size": String(size),
      },
    });
  });

  // /chibimc/{nombre}/gif  y  /chibimc/{nombre}/gif/
  app.get("/chibimc/:nombre/gif", async (req, res) => {
    const nombre = cleanName(req.params.nombre);
    if (!nombre) {
      throw new ApiError(400, "Debes indicar un nombre de jugador.");
    }

    const canonical = (await checkPlayer(nombre)).name;

    // ?size= vacío -> resoluciones disponibles.
    if (req.query.size !== undefined && String(req.query.size).trim() === "") {
      return res.json(sizesPayload(canonical));
    }

    if (req.query.size !== undefined) {
      throw new ApiError(
        400,
        "Indica el GIF que quieres: " +
          `/chibimc/${canonical}/gif/{nombre}?size=${req.query.size}`
      );
    }

    const items = await fetchAnimationCatalog();
    return res.json({
      player: canonical,
      default_size: DEFAULT_CHIBI_SIZE,
      sizes: [...CHIBI_SIZES],
      gifs: items.map((item) => ({
        name: item.name,
        label: item.label,
        filename: `chibi-${canonical}-${item.name}.gif`,
        url: `/chibimc/${canonical}/gif/${item.name}`,
      })),
    });
  });

  app.get("/chibimc/:nombre/gif/:archivo", async (req, res) => {
    const nombre = cleanName(req.params.nombre);
    if (!nombre) {
      throw new ApiError(400, "Debes indicar un nombre de jugador.");
    }

    const archivo = cleanName(req.params.archivo);
    const player = await checkPlayer(nombre);
    const canonical = player.name;

    const size = parseChibiSize(req.query.size);
    if (size === null) {
      return res.json(
        sizesPayload(
          canonical,
          `/chibimc/${encodeURIComponent(canonical)}/gif/${encodeURIComponent(archivo)}`
        )
      );
    }

    const items = await fetchAnimationCatalog();
    const animation = resolveAnimation(archivo, items, canonical);
    const gif = await buildChibiGif(canonical, size, animation, player.skinUrl);

    return sendFile(res, gif.buffer, {
      filename: gif.filename,
      contentType: "image/gif",
      headers: {
        "X-Minecraft-Player": canonical,
        "X-Chibi-Animation": animation,
        "X-Chibi-Size": String(size),
      },
    });
  });
}
