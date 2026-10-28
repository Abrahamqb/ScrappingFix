import { chromium } from "playwright-core";
import { ApiError, shortError } from "./errors.js";

// En local se usan Chrome/Edge ya instalados (no descarga nada).
// En Vercel/Lambda se usa el Chromium empaquetado de @sparticuz/chromium,
// que trae sus propias librerías del sistema.
const LOCAL_ATTEMPTS = [{ channel: "chrome" }, { channel: "msedge" }, {}];

const isServerless = () =>
  Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

export async function launchBrowser() {
  if (isServerless()) {
    const { default: sparticuz } = await import("@sparticuz/chromium");
    return chromium.launch({
      args: sparticuz.args,
      executablePath: await sparticuz.executablePath(),
      headless: true,
    });
  }

  let lastError = null;
  for (const options of LOCAL_ATTEMPTS) {
    try {
      return await chromium.launch({ headless: true, ...options });
    } catch (error) {
      lastError = error;
    }
  }

  throw new ApiError(
    503,
    "No se pudo iniciar un navegador. Instala Chrome/Edge o ejecuta " +
      `'npx playwright install chromium'. Detalle: ${shortError(lastError)}`
  );
}
