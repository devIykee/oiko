// Small fetch wrapper for the Oiko HTTP API (docs/interfaces/http.md). Errors carry the stable code.
import { fixtureFetch, isFixtureMode } from "./fixtures/mode";

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  if (isFixtureMode()) return fixtureFetch<T>(path, init?.method ?? "GET", init?.body);
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init?.signal,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("E_RPC", "Oiko couldn't be reached.", 0);
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(err?.code ?? (res.status === 404 ? "E_NOT_FOUND" : "E_UPSTREAM"), err?.message ?? res.statusText, res.status);
  }
  return json as T;
}
