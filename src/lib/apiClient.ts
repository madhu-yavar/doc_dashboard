import { API_BASE } from "@/lib/backendConfig";

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

type ApiFetchInit = RequestInit & {
  skipUnauthorizedRedirect?: boolean;
};

function dispatchUnauthorized() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("auth:unauthorized"));
  }
}

function mergeHeaders(headers?: HeadersInit, body?: BodyInit | null) {
  const normalized = new Headers(headers || {});
  if (body && !(body instanceof FormData) && !normalized.has("Content-Type")) {
    normalized.set("Content-Type", "application/json");
  }
  return normalized;
}

export async function apiFetch(input: RequestInfo | URL, init: ApiFetchInit = {}) {
  const { skipUnauthorizedRedirect = false, headers, body, ...rest } = init;
  const response = await fetch(input, {
    credentials: "include",
    ...rest,
    body,
    headers: mergeHeaders(headers, body),
  });

  if (response.status === 401 && !skipUnauthorizedRedirect) {
    dispatchUnauthorized();
  }

  return response;
}

export async function parseApiPayload(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function expectApiJson<T>(
  response: Response,
  fallbackMessage: string,
) {
  const payload = await parseApiPayload(response);
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : typeof payload === "string" && payload
          ? payload
          : fallbackMessage;
    throw new ApiError(message, response.status, payload);
  }
  return payload as T;
}

export function createAuthenticatedEventSource(url: string) {
  return new EventSource(url, { withCredentials: true });
}

export { API_BASE };
