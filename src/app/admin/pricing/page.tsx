import type { Metadata } from "next";
import { PricingRulesForm } from "@/components/admin/pricing-rules-form";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { getPricingRules } from "@/services/pricing";

export const metadata: Metadata = { title: "Pricing rules" };
export const dynamic = "force-dynamic";

export default async function AdminPricingPage() {
  await requireRole(["admin"]);
  const pricingRules = await getPricingRules();
  return (
    <>
      <PageHeader title="Pricing rules" description="Configure the service fees and taxes that shape every new customer quote." />
      <PricingRulesForm pricingRules={pricingRules} />
    </>
  );
}
