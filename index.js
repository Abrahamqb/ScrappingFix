import express from "express";
import { registerDownload } from "./src/download.js";
import { registerChibi } from "./src/chibi.js";
import { CHIBI_SIZES, DEFAULT_CHIBI_SIZE } from "./src/config.js";
import { ApiError, shortError } from "./src/errors.js";

// .env opcional en local (en Vercel las variables vienen del dashboard).
try {
  process.loadEnvFile?.();
} catch {
  // sin .env: se usan solo las variables del entorno
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

app.get("/", (_req, res) => {
  res.json({
    name: "Fix Scraper API",
    endpoints: {
      download: "/download?game=Nombre%20Del%20Juego",
      chibi: "/chibimc/{jugador}",
      chibi_sizes: "/chibimc/{jugador}?size=",
      chibi_gif_list: "/chibimc/{jugador}/gif/",
      chibi_gif: "/chibimc/{jugador}/gif/{nombre}",
    },
    chibi: { sizes: CHIBI_SIZES, default_size: DEFAULT_CHIBI_SIZE },
  });
});

registerDownload(app);
registerChibi(app);

app.use((_req, res) => {
  res.status(404).json({ detail: "Not Found" });
});

// Manejador de errores: mismo formato que tenías en FastAPI.
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof ApiError) {
    return res.status(error.status).json({ detail: error.detail });
  }
  console.error("[api]", error);
  return res.status(500).json({ detail: shortError(error) });
});

const port = Number(process.env.PORT || 3000);
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`API escuchando en http://127.0.0.1:${port}`);
  });
}

export default app;
