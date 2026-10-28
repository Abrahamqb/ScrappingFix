import * as cheerio from "cheerio";
import { CHIBI_CATALOG_TTL, CHIBI_TOOL_URL, USER_AGENT } from "./config.js";
import { ApiError, shortError } from "./errors.js";

let cache = { at: 0, items: null };

function titleCase(name) {
  return name
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// Lista de animaciones publicadas en la web (nombre interno + etiqueta visible).
export async function fetchAnimationCatalog() {
  if (cache.items && Date.now() - cache.at < CHIBI_CATALOG_TTL) {
    return cache.items;
  }

  let html;
  try {
    const response = await fetch(CHIBI_TOOL_URL, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    html = await response.text();
  } catch (error) {
    throw new ApiError(
      502,
      `No se pudo leer la lista de GIFs de nogard.dev: ${shortError(error)}`
    );
  }

  const $ = cheerio.load(html);
  const items = [];

  $("#animPresets [data-anim]").each((_, element) => {
    const name = ($(element).attr("data-anim") || "").trim();
    if (!name || name === "none") return;
    const label = $(element).find(".vp-anim-label").first().text().trim();
    items.push({ name, label: label || titleCase(name) });
  });

  if (!items.length) {
    throw new ApiError(502, "No se encontraron animaciones en nogard.dev.");
  }

  cache = { at: Date.now(), items };
  return items;
}
