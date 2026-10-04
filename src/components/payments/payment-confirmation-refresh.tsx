"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function PaymentConfirmationRefresh({ shouldRefresh }: { shouldRefresh: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!shouldRefresh) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      router.refresh();
      if (attempts >= 12) window.clearInterval(timer);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [router, shouldRefresh]);

  return null;
}
