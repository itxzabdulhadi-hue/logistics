import { experimental_upgradeWebSocket } from "@vercel/functions";
import { getCurrentUser } from "@/lib/auth";
import { isTrackingRealtimeConfigured, registerTrackingSocket } from "@/lib/tracking-realtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// All Vercel plans support at least five minutes; clients reconnect and resubscribe after expiry.
export const maxDuration = 300;

export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return Response.json({ error: "An Origin header is required for tracking connections." }, { status: 403 });

  let sameOrigin = false;
  try {
    sameOrigin = new URL(origin).origin === new URL(request.url).origin;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) return Response.json({ error: "Cross-origin tracking connections are not allowed." }, { status: 403 });

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (process.env.VERCEL !== "1") {
    return Response.json({ error: "Vercel WebSockets are unavailable in next dev; polling will keep tracking current." }, { status: 426 });
  }
  if (!isTrackingRealtimeConfigured()) {
    return Response.json({ error: "Configure REDIS_URL to enable cross-instance live tracking." }, { status: 503 });
  }

  return experimental_upgradeWebSocket((socket) => {
    registerTrackingSocket(socket, user);
  }, { maxPayload: 8_192 });
}
