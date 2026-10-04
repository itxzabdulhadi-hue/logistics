import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import type { WebSocket } from "ws";
import type { SafeUser } from "@/lib/auth";
import { logger } from "@/lib/logger";
import type { TrackingServerEvent, TrackingSocketMessage } from "@/lib/tracking-types";
import { listAuthorizedTrackingIds } from "@/services/tracking";

const CHANNEL = "loadline:tracking:events:v1";
const MAX_SUBSCRIPTIONS = 100;
const MAX_CLIENT_MESSAGE_LENGTH = 8_192;
const INSTANCE_ID = randomUUID();

type Connection = { user: SafeUser; bookingIds: Set<number> };
type RedisEnvelope = { origin: string; event: TrackingServerEvent };

type ClientMessage =
  | { type: "ping" }
  | { type: "subscribe"; bookingIds: number[] };

const connections = new Map<WebSocket, Connection>();
let publisher: Redis | null | undefined;
let subscriber: Redis | null | undefined;
let subscriberReady: Promise<void> | null = null;

function redisUrl() {
  return process.env.REDIS_URL?.trim() || null;
}

export function isTrackingRealtimeConfigured() {
  return redisUrl() !== null;
}

function getPublisher() {
  if (publisher !== undefined) return publisher;
  const url = redisUrl();
  if (!url) return (publisher = null);
  publisher = new Redis(url, {
    connectTimeout: 5_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });
  publisher.on("error", (error) => logger.warn("tracking.redis.publisher.error", { error }));
  return publisher;
}

function sendPayload(socket: WebSocket, payload: string, bookingId: number) {
  if (socket.readyState !== 1) return;
  try {
    socket.send(payload);
  } catch (error) {
    logger.debug("tracking.websocket.send.failed", { bookingId, error });
  }
}

function dispatchToLocalSubscribers(event: TrackingServerEvent) {
  const payload = JSON.stringify(event);
  for (const [socket, connection] of connections) {
    if (!connection.bookingIds.has(event.bookingId) || socket.readyState !== 1) continue;

    // A driver may be reassigned while a socket is open. Recheck ownership before
    // every event so a former assignee cannot keep receiving the new driver's GPS.
    if (connection.user.role === "driver") {
      void listAuthorizedTrackingIds([event.bookingId], connection.user)
        .then((authorizedIds) => {
          const current = connections.get(socket);
          if (current !== connection || !current.bookingIds.has(event.bookingId)) return;
          if (authorizedIds.length === 0) {
            current.bookingIds.delete(event.bookingId);
            send(socket, { type: "error", message: "Tracking access for this booking has changed." });
            return;
          }
          sendPayload(socket, payload, event.bookingId);
        })
        .catch((error) => logger.warn("tracking.websocket.authorization.failed", {
          bookingId: event.bookingId,
          userId: connection.user.id,
          error,
        }));
      continue;
    }

    sendPayload(socket, payload, event.bookingId);
  }
}

function handleRedisMessage(_channel: string, raw: string) {
  try {
    const envelope = JSON.parse(raw) as RedisEnvelope;
    if (!envelope || envelope.origin === INSTANCE_ID || !envelope.event) return;
    dispatchToLocalSubscribers(envelope.event);
  } catch (error) {
    logger.warn("tracking.redis.message.invalid", { error });
  }
}

async function ensureSubscriber() {
  if (!subscriber) {
    const url = redisUrl();
    if (!url) throw new Error("REDIS_URL is not configured");
    subscriber = new Redis(url, {
      connectTimeout: 5_000,
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
    });
    subscriber.on("message", handleRedisMessage);
    subscriber.on("error", (error) => logger.warn("tracking.redis.subscriber.error", { error }));
  }

  if (!subscriberReady) {
    subscriberReady = subscriber.subscribe(CHANNEL).then(() => undefined).catch((error: unknown) => {
      subscriberReady = null;
      throw error;
    });
  }
  await subscriberReady;
}

function send(socket: WebSocket, message: TrackingSocketMessage) {
  if (socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify(message));
  } catch (error) {
    logger.debug("tracking.websocket.send.failed", { error });
  }
}

function dataToText(data: unknown) {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data) && data.every((part) => Buffer.isBuffer(part))) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return String(data);
}

function parseClientMessage(data: unknown): ClientMessage | null {
  const text = dataToText(data);
  if (text.length > MAX_CLIENT_MESSAGE_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (message.type === "ping") return { type: "ping" };
  if (message.type !== "subscribe" || !Array.isArray(message.bookingIds)) return null;
  const ids = [...new Set(message.bookingIds)];
  if (
    ids.length === 0 ||
    ids.length > MAX_SUBSCRIPTIONS ||
    ids.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)
  ) {
    return null;
  }
  return { type: "subscribe", bookingIds: ids as number[] };
}

async function handleClientMessage(socket: WebSocket, raw: unknown) {
  const connection = connections.get(socket);
  if (!connection) return;
  const message = parseClientMessage(raw);
  if (!message) {
    send(socket, { type: "error", message: "Invalid tracking message." });
    return;
  }
  if (message.type === "ping") {
    send(socket, { type: "pong" });
    return;
  }

  try {
    const authorizedIds = await listAuthorizedTrackingIds(message.bookingIds, connection.user);
    if (authorizedIds.length !== message.bookingIds.length) {
      send(socket, { type: "error", message: "You cannot subscribe to one or more of these bookings." });
      return;
    }
    connection.bookingIds = new Set(authorizedIds);
    send(socket, { type: "subscribed", bookingIds: authorizedIds });
  } catch (error) {
    logger.warn("tracking.websocket.subscribe.failed", { userId: connection.user.id, error });
    send(socket, { type: "error", message: "Unable to subscribe to live tracking right now." });
  }
}

/** Register a Vercel WebSocket and attach authorization, subscription and cleanup hooks. */
export function registerTrackingSocket(socket: WebSocket, user: SafeUser) {
  connections.set(socket, { user, bookingIds: new Set() });

  // Attach listeners synchronously before the client can send its first subscribe frame.
  socket.on("message", (data) => void handleClientMessage(socket, data));
  const cleanup = () => connections.delete(socket);
  socket.on("close", cleanup);
  socket.on("error", cleanup);

  void ensureSubscriber()
    .then(() => send(socket, { type: "ready", crossInstance: true }))
    .catch((error) => {
      logger.warn("tracking.websocket.redis.unavailable", { error });
      send(socket, { type: "error", message: "Live updates are temporarily unavailable." });
      if (socket.readyState === 1) socket.close(1013, "Live tracking unavailable");
      cleanup();
    });
}

/** Persisted state is authoritative; Redis Pub/Sub delivers immediate cross-instance updates. */
export async function publishTrackingEvent(event: TrackingServerEvent) {
  dispatchToLocalSubscribers(event);
  if (!redisUrl()) {
    logger.debug("tracking.realtime.not_configured", { type: event.type, bookingId: event.bookingId });
    return false;
  }

  try {
    const client = getPublisher();
    if (!client) return false;
    const envelope: RedisEnvelope = { origin: INSTANCE_ID, event };
    await client.publish(CHANNEL, JSON.stringify(envelope));
    return true;
  } catch (error) {
    logger.warn("tracking.realtime.publish.failed", { type: event.type, bookingId: event.bookingId, error });
    return false;
  }
}
