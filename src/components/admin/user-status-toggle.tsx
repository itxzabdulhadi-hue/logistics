"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";

export function UserStatusToggle({ userId, status, canManage }: { userId: number; status: "active" | "suspended"; canManage: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canManage) return null;
  const next = status === "active" ? "suspended" : "active";
  return (
    <div className="flex flex-col items-end gap-2">
      {error && <Alert tone="error">{error}</Alert>}
      <Button
        variant={status === "active" ? "danger" : "primary"}
        loading={loading}
        onClick={async () => {
          if (status === "active" && !confirm("Suspend this customer? They will be signed out and unable to log in.")) return;
          setLoading(true);
          setError(null);
          try {
            await api(`/api/admin/customers/${userId}`, { method: "PATCH", body: { status: next } });
            router.refresh();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setLoading(false);
          }
        }}
      >
        {status === "active" ? "Suspend account" : "Reactivate account"}
      </Button>
    </div>
  );
}
