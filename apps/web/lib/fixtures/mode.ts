// Dev-only fixture switch (?fixture=1). Compiled out of production builds: every entry point checks NODE_ENV first.
export function isFixtureMode(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search).get("fixture");
    if (q === "1") window.sessionStorage.setItem("oiko.fixture", "1");
    if (q === "0") window.sessionStorage.removeItem("oiko.fixture");
    return window.sessionStorage.getItem("oiko.fixture") === "1";
  } catch {
    return false;
  }
}

export async function fixtureFetch<T>(path: string, method: string, body?: unknown): Promise<T> {
  if (process.env.NODE_ENV !== "production") {
    const m = await import("./data");
    return m.handle(path, method, body) as Promise<T>;
  }
  throw new Error("fixtures are not available in production");
}

export async function fixtureAction(name: string, args: unknown[]): Promise<{ txHash: string; ok: boolean; value?: unknown; logs: string[] }> {
  if (process.env.NODE_ENV !== "production") {
    const m = await import("./data");
    return m.act(name, args);
  }
  throw new Error("fixtures are not available in production");
}
