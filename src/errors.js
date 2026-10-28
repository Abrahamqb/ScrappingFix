// Error controlado: se traduce a {"detail": "..."} con su código HTTP.
export class ApiError extends Error {
  constructor(status, detail) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

// Mensaje compacto de un error (para no devolver stacks gigantes).
export function shortError(error, limit = 300) {
  const text = error && error.message ? error.message : String(error);
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function isTimeout(error) {
  return Boolean(
    error && (error.name === "TimeoutError" || /timeout|timed out/i.test(error.message || ""))
  );
}
