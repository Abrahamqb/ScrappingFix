import { MAX_INLINE_BYTES } from "./config.js";
import { shortError } from "./errors.js";

// Vercel corta cualquier respuesta > 4.5 MB. Si el archivo es más grande y hay
// un Blob configurado, se sube y se responde con un 302 a su URL.
async function uploadToBlob(buffer, filename, contentType) {
  const { put } = await import("@vercel/blob");
  return put(`chibimc/${filename}`, buffer, {
    access: "public",
    contentType,
    addRandomSuffix: true,
  });
}

export async function sendFile(res, buffer, { filename, contentType, headers = {} }) {
  res.set(headers);

  if (buffer.length > MAX_INLINE_BYTES && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const blob = await uploadToBlob(buffer, filename, contentType);
      res.set("X-Chibi-Delivery", "blob");
      return res.redirect(302, blob.url);
    } catch (error) {
      // Si Blob falla, se intenta la descarga directa (en Vercel dará 413 si
      // supera 4.5 MB, pero en local o en otro host funciona).
      console.warn(`[chibimc] Blob no disponible: ${shortError(error)}`);
    }
  }

  res.set("Content-Type", contentType);
  res.set("Content-Disposition", `attachment; filename="${filename}"`);
  res.set("Content-Length", String(buffer.length));
  return res.status(200).send(buffer);
}
