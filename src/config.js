// ---------------------------------------------------------------------------
// Configuración compartida
// ---------------------------------------------------------------------------

export const MC_API_PROFILE_URL = (name) =>
  `https://mc-api.io/profile/${encodeURIComponent(name)}/JAVA`;

export const CHIBI_TOOL_URL = "https://nogard.dev/tools/minecraft-chibi-skin-maker";

// Resoluciones que ofrece la web en modo "Pixel art" (app._exportSizes()):
// el GIF se escala por números enteros sobre el sprite nativo, sin remuestreo.
// x32 queda desactivado porque el ZIP supera los 8 MB y Vercel corta cualquier
// respuesta por encima de 4.5 MB (el resto de resoluciones caben de sobra).
export const CHIBI_SIZES = [
  1,
  2,
  4,
  8,
  16,
  // 32,
];
export const DEFAULT_CHIBI_SIZE = 1;

// Caché en memoria del catálogo de animaciones (nombre interno + etiqueta).
export const CHIBI_CATALOG_TTL = 3600 * 1000;

export const CHIBI_MAX_CONCURRENT = Math.max(
  1,
  Number.parseInt(process.env.CHIBI_MAX_CONCURRENT || "2", 10) || 2
);

// Por encima de este tamaño se intenta subir a Vercel Blob (límite duro de
// Vercel: 4.5 MB por respuesta).
export const MAX_INLINE_BYTES = 4.2 * 1024 * 1024;

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
