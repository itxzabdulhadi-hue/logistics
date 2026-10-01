import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type User, type UserRole } from "@/db/schema";
import { errors } from "@/lib/api";
import { logger } from "@/lib/logger";

const scrypt = promisify(scryptCb);

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return expected.length === derived.length && timingSafeEqual(derived, expected);
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

// ---------------------------------------------------------------------------
// JWT sessions
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "ll_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      logger.warn("auth.secret.missing", {
        hint: "Set AUTH_SECRET in the environment; falling back to an insecure default.",
      });
    }
    return new TextEncoder().encode("loadline-dev-secret-change-me-please-0001");
  }
  return new TextEncoder().encode(secret);
}

export type SessionPayload = { sub: string; role: UserRole; email: string };

export async function signSession(payload: SessionPayload) {
  return new SignJWT({ role: payload.role, email: payload.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      role: payload.role as UserRole,
      email: String(payload.email ?? ""),
    };
  } catch {
    return null;
  }
}

export async function createSession(user: Pick<User, "id" | "role" | "email">) {
  const token = await signSession({ sub: String(user.id), role: user.role, email: user.email });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

// ---------------------------------------------------------------------------
// Users / permissions
// ---------------------------------------------------------------------------

export type SafeUser = Omit<User, "passwordHash">;

export function toSafeUser(user: User): SafeUser {
  const { passwordHash: _ignored, ...rest } = user;
  void _ignored;
  return rest;
}

export type Permission =
  | "bookings:create"
  | "bookings:read:own"
  | "bookings:cancel:own"
  | "bookings:read:any"
  | "bookings:manage"
  | "bookings:read:assigned"
  | "bookings:progress"
  | "customers:read"
  | "customers:manage"
  | "fleet:read"
  | "fleet:manage"
  | "users:manage"
  | "profile:manage";

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  customer: ["bookings:create", "bookings:read:own", "bookings:cancel:own", "profile:manage"],
  dispatcher: [
    "bookings:read:any",
    "bookings:manage",
    "customers:read",
    "fleet:read",
    "fleet:manage",
    "profile:manage",
  ],
  admin: [
    "bookings:read:any",
    "bookings:manage",
    "customers:read",
    "customers:manage",
    "fleet:read",
    "fleet:manage",
    "users:manage",
    "profile:manage",
  ],
  driver: ["bookings:read:assigned", "bookings:progress", "profile:manage"],
};

export function hasPermission(role: UserRole, permission: Permission) {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function isStaff(role: UserRole) {
  return role === "admin" || role === "dispatcher";
}

export function homeForRole(role: UserRole) {
  return isStaff(role) ? "/admin" : "/dashboard";
}

/** Load the current user from the session cookie (null when signed out / suspended). */
export async function getCurrentUser(): Promise<SafeUser | null> {
  const session = await getSession();
  if (!session) return null;
  const id = Number(session.sub);
  if (!Number.isInteger(id)) return null;
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user || user.status !== "active") return null;
  return toSafeUser(user);
}

/** For server components: redirect to login when not authenticated. */
export async function requireUser(): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For server components: require one of the given roles. */
export async function requireRole(roles: UserRole[]): Promise<SafeUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(homeForRole(user.role));
  return user;
}

/** For API routes: throw 401/403 instead of redirecting. */
export async function requireApiUser(permission?: Permission): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (!user) throw errors.unauthorized();
  if (permission && !hasPermission(user.role, permission)) throw errors.forbidden();
  return user;
}
