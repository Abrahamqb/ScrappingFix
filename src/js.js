// ---------------------------------------------------------------------------
// Funciones que se ejecutan DENTRO de la página de nogard.dev.
// Se ataca directamente a window.__csm (la instancia de la herramienta):
// es mucho más rápido y estable que hacer clic en la interfaz.
//
// Ojo: Playwright serializa estas funciones y las ejecuta en el navegador, así
// que NO pueden referenciar nada de este módulo (solo sus argumentos).
// ---------------------------------------------------------------------------

// Carga la skin escribiendo el nombre en el input de la web.
export async function loadSkin(username) {
  const app = window.__csm;
  if (!app) throw new Error("La herramienta no se ha inicializado.");
  app._afterExport = () => {}; // evita el modal de "apoya el proyecto" entre GIFs
  app.usernameInput.value = username;
  await app.loadSkinFromUsername();
  const error = document.getElementById("skinError");
  if (error && !error.hidden && error.textContent.trim()) {
    throw new Error(error.textContent.trim());
  }
  if (!app.currentSkinImage) throw new Error("La skin no se pudo cargar.");
  return document.getElementById("skinStatusText").textContent;
}

export function listAnimations() {
  return [...document.querySelectorAll("#animPresets [data-anim]")]
    .map((element) => element.dataset.anim)
    .filter((name) => name && name !== "none");
}

export function availableSizes() {
  const app = window.__csm;
  if (!app) throw new Error("La herramienta no se ha inicializado.");
  const { quick, more } = app._exportSizes();
  return [...quick, ...more].sort((a, b) => a - b);
}

export function setSize(size) {
  const app = window.__csm;
  app.setExportSize(size);
  app._populateExportSizes();
  if (app.exportSize !== size) {
    throw new Error(`La resolución ${size} no está disponible.`);
  }
  return app.exportSize;
}

// Selecciona la animación, termina de hornear sus frames y exporta el GIF
// (la propia web crea el Blob con el encoder gifenc).
export async function exportAnimation(anim) {
  const app = window.__csm;
  if (!app) throw new Error("La herramienta no se ha inicializado.");
  window.__csmLastExport = null;
  window.__csmBlobs = [];
  app.setAnim(anim);
  app._finishPendingBake();
  if (!app._animFrames || !app._animFrames.length) {
    throw new Error("La animación no generó frames.");
  }
  const frames = app._animFrames.length;
  await app.exportGIF();
  return frames;
}

// Intercepta la "descarga" del GIF: en vez de dejar que Chromium escriba un
// archivo (frágil en serverless), guardamos el Blob y lo devolvemos en base64.
// Así no dependemos de eventos de descarga ni del sistema de archivos.
export function installCapture() {
  if (window.__csmCaptureInstalled) return;
  window.__csmCaptureInstalled = true;
  window.__csmBlobs = [];
  window.__csmLastExport = null;

  const createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    const url = createObjectURL(blob);
    try {
      window.__csmBlobs.push({ url, blob });
    } catch {
      /* noop */
    }
    return url;
  };
  // No revocar: necesitamos leer el Blob después de exportar.
  URL.revokeObjectURL = () => {};

  const record = (anchor) => {
    if (!anchor) return false;
    const href = String(anchor.href || "");
    if (!href.startsWith("blob:")) return false;
    window.__csmLastExport = { name: anchor.download || "", url: href };
    return true;
  };

  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (record(this)) return;
    return click.call(this);
  };

  const dispatchEvent = HTMLAnchorElement.prototype.dispatchEvent;
  HTMLAnchorElement.prototype.dispatchEvent = function (event) {
    if (event && event.type === "click" && record(this)) return true;
    return dispatchEvent.call(this, event);
  };
}

export async function readLastExport() {
  const last = window.__csmLastExport;
  if (!last) return null;

  let blob = (window.__csmBlobs.find((entry) => entry.url === last.url) || {}).blob;
  if (!blob) {
    const response = await fetch(last.url);
    blob = await response.blob();
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
  }
  return { name: last.name, base64: btoa(binary) };
}
