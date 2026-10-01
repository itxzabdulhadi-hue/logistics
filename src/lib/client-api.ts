/** Browser-side helper for calling the REST API with consistent error handling. */
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function api<T>(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    const details =
      err?.details && typeof err.details === "object" && !Array.isArray(err.details)
        ? (err.details as Record<string, string>)
        : {};
    throw new ApiClientError(res.status, err?.code ?? "ERROR", err?.message ?? "Request failed", details);
  }
  return data as T;
}

export function errorMessage(err: unknown, fallback = "Something went wrong") {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiClientError ? err.fieldErrors : {};
}
