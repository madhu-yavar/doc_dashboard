const normalizeApiRoot = (value?: string) => String(value || "").replace(/\/$/, "");

const isLocalFrontendHost = () =>
  typeof window !== "undefined"
  && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);

const configuredApiRoot = normalizeApiRoot(import.meta.env.VITE_API_URL || "");

// In local browser development, prefer same-origin requests and let Vite proxy
// them to the backend. This keeps cookie auth working on localhost.
export const API_ROOT = isLocalFrontendHost() ? "" : configuredApiRoot;
export const BACKEND_ORIGIN = API_ROOT
  || (typeof window !== "undefined" ? window.location.origin.replace(/\/$/, "") : "");
export const API_BASE = `${API_ROOT}/api`;
