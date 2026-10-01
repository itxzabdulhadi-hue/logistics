import { NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { logger } from "@/lib/logger";

/** Error that maps directly onto an HTTP response. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const errors = {
  badRequest: (message = "Bad request", details?: unknown) =>
    new ApiError(400, "BAD_REQUEST", message, details),
  unauthorized: (message = "Authentication required") =>
    new ApiError(401, "UNAUTHORIZED", message),
  forbidden: (message = "You do not have permission to do that") =>
    new ApiError(403, "FORBIDDEN", message),
  notFound: (message = "Not found") => new ApiError(404, "NOT_FOUND", message),
  conflict: (message: string, code = "CONFLICT") => new ApiError(409, code, message),
  validation: (details: unknown, message = "Validation failed") =>
    new ApiError(422, "VALIDATION_ERROR", message, details),
};

export type RouteCtx<P = Record<string, string>> = { params: Promise<P> };
type Handler<P> = (req: NextRequest, ctx: RouteCtx<P>) => Promise<Response>;

function formatZodError(err: ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return Response.json({ error: { code, message, details } }, { status });
}

/**
 * Wraps a route handler with consistent error handling + request logging.
 * Any thrown ApiError / ZodError becomes a well-formed JSON error response.
 */
export function handle<P = Record<string, string>>(fn: Handler<P>): Handler<P> {
  return async (req, ctx) => {
    const started = Date.now();
    const path = new URL(req.url).pathname;
    try {
      const res = await fn(req, ctx);
      logger.info("api.request", {
        method: req.method,
        path,
        status: res.status,
        durationMs: Date.now() - started,
      });
      return res;
    } catch (err) {
      const durationMs = Date.now() - started;
      if (err instanceof ApiError) {
        logger.warn("api.error", {
          method: req.method,
          path,
          status: err.status,
          code: err.code,
          message: err.message,
          durationMs,
        });
        return errorResponse(err.status, err.code, err.message, err.details);
      }
      if (err instanceof ZodError) {
        logger.warn("api.validation", { method: req.method, path, durationMs });
        return errorResponse(422, "VALIDATION_ERROR", "Validation failed", formatZodError(err));
      }
      logger.error("api.unhandled", { method: req.method, path, durationMs, error: err });
      return errorResponse(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
    }
  };
}

/** Parse + validate a JSON body. Throws 400 for malformed JSON, 422 for schema errors. */
export async function parseJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw errors.badRequest("Request body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw errors.validation(formatZodError(result.error));
  return result.data;
}

/** Validate URL search params against a schema (strings in, typed out). */
export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  const obj: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    if (v !== "") obj[k] = v;
  });
  const result = schema.safeParse(obj);
  if (!result.success) throw errors.validation(formatZodError(result.error));
  return result.data;
}

export function parseId(value: string | undefined, label = "id"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw errors.badRequest(`Invalid ${label}`);
  return n;
}

export function json<T>(data: T, init?: ResponseInit) {
  return Response.json(data, init);
}
