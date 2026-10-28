import { Readable } from "node:stream";
import * as cheerio from "cheerio";
import { USER_AGENT } from "./config.js";
import { ApiError, shortError } from "./errors.js";

const FIX_BASE = "https://uploads.online-fix.me:2053/uploads";
const SITE_URL = "https://online-fix.me/";
const ARCHIVE_RE = /\.(rar|zip|7z|iso|tar|gz|bz2)$/i;

function upstreamHeaders() {
  const headers = { "User-Agent": USER_AGENT, Referer: SITE_URL };
  const cookies = [];
  if (process.env.DLE_USER_ID) cookies.push(`dle_user_id=${process.env.DLE_USER_ID}`);
  if (process.env.DLE_PASSWORD) cookies.push(`dle_password=${process.env.DLE_PASSWORD}`);
  if (cookies.length) headers.Cookie = cookies.join("; ");
  return headers;
}

function pickFileUrl(html, baseUrl) {
  const $ = cheerio.load(html);
  const candidates = [];

  $("a[href]").each((_, element) => {
    const href = ($(element).attr("href") || "").trim();
    if (!href || href === "../" || href.startsWith("?") || href.startsWith("#")) return;
    if (href.startsWith("/") || href.startsWith("http")) return;
    if (href.endsWith("/")) return;
    candidates.push(new URL(href, baseUrl).toString());
  });

  return candidates.find((url) => ARCHIVE_RE.test(url)) || candidates[0] || null;
}

export function registerDownload(app) {
  app.get("/download", async (req, res) => {
    const rawGame = req.query.game;
    if (typeof rawGame !== "string" || !rawGame.trim()) {
      throw new ApiError(400, "Debes indicar el nombre del juego (?game=).");
    }

    const game = rawGame.trim();
    const dirUrl = `${FIX_BASE}/${encodeURIComponent(game)}/Fix%20Repair/`;
    const headers = upstreamHeaders();

    // Handshake inicial (como en la versión Python).
    await fetch(SITE_URL, {
      headers,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});

    let listing;
    try {
      listing = await fetch(dirUrl, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new ApiError(
        502,
        `No se pudo consultar el listado de fixes: ${shortError(error)}`
      );
    }

    if (listing.status === 404) throw new ApiError(404, "Directory not found");
    if (listing.status === 401 || listing.status === 403) {
      throw new ApiError(
        502,
        `El servidor de fixes rechazó la petición (${listing.status}). ` +
          "Revisa DLE_USER_ID y DLE_PASSWORD."
      );
    }
    if (!listing.ok) {
      throw new ApiError(502, `El listado respondió con estado ${listing.status}.`);
    }

    const fileUrl = pickFileUrl(await listing.text(), dirUrl);
    if (!fileUrl) throw new ApiError(404, "No RAR/ZIP file found");

    const fileName = decodeURIComponent(fileUrl.split("/").pop() || "fix.rar");

    // Tamaño total por HEAD (lo necesita el cliente C# para no cortar la conexión).
    let totalSize = null;
    try {
      const head = await fetch(fileUrl, {
        method: "HEAD",
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      if (head.ok) totalSize = head.headers.get("content-length");
    } catch {
      totalSize = null;
    }

    let upstream;
    try {
      upstream = await fetch(fileUrl, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(600_000),
      });
    } catch (error) {
      throw new ApiError(502, `No se pudo descargar el fix: ${shortError(error)}`);
    }

    if (!upstream.ok || !upstream.body) {
      throw new ApiError(502, `La descarga respondió con estado ${upstream.status}.`);
    }

    res.status(200);
    res.set("Content-Type", "application/octet-stream");
    res.set("Content-Disposition", `attachment; filename=${fileName}`);
    res.set("Accept-Ranges", "bytes");
    if (totalSize) res.set("Content-Length", totalSize);

    // Si el cliente corta, se cancela también la descarga al origen.
    res.on("close", () => {
      upstream.body?.cancel().catch(() => {});
    });

    Readable.fromWeb(upstream.body).pipe(res);
  });
}
