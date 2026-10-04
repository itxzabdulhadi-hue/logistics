import { Badge } from "@/components/ui";
import { titleCase } from "@/lib/utils";

const STATUS_TONES: Record<string, "amber" | "blue" | "green" | "emerald" | "red" | "slate" | "violet"> = {
  pending: "amber",
  outstanding: "amber",
  partially_paid: "blue",
  succeeded: "green",
  paid: "green",
  failed: "red",
  partially_refunded: "violet",
  refunded: "slate",
  cancelled: "slate",
};

export function PaymentStatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "slate"}>{titleCase(status)}</Badge>;
}
