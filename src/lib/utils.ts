export function formatMoney(cents: number | null | undefined, currency = "AUD") {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Sydney",
  }).format(d);
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeZone: "Australia/Sydney",
  }).format(d);
}

export function formatRelative(value: Date | string) {
  const d = typeof value === "string" ? new Date(value) : value;
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en-AU", { numeric: "auto" });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), "second");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

export function formatKm(km: number | null | undefined) {
  if (km === null || km === undefined) return "—";
  return `${km.toFixed(1)} km`;
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${minutes} min`;
  return remainder === 0 ? `${hours} hr` : `${hours} hr ${remainder} min`;
}

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Convert a Date to the value expected by <input type="datetime-local"> (local time). */
export function toDateTimeLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
