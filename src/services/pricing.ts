import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pricingRules } from "@/db/schema";
import { DEFAULT_PRICING_RULES, type PricingRules } from "@/lib/booking-rules";

export type PricingRuleRecord = PricingRules & { id: number; updatedAt: Date };

function toPricingRules(row: typeof pricingRules.$inferSelect): PricingRuleRecord {
  return {
    id: row.id,
    additionalStopFeeCents: row.additionalStopFeeCents,
    tailgateFeeCents: row.tailgateFeeCents,
    handUnloadFeeCents: row.handUnloadFeeCents,
    asapSurchargeBasisPoints: row.asapSurchargeBasisPoints,
    gstRateBasisPoints: row.gstRateBasisPoints,
    updatedAt: row.updatedAt,
  };
}

/** Lazily creates the singleton so existing Phase 1 databases are upgraded safely. */
export async function getPricingRules(): Promise<PricingRuleRecord> {
  const [existing] = await db.select().from(pricingRules).where(eq(pricingRules.id, 1)).limit(1);
  if (existing) return toPricingRules(existing);

  await db
    .insert(pricingRules)
    .values({ id: 1, ...DEFAULT_PRICING_RULES })
    .onConflictDoNothing({ target: pricingRules.id });
  const [created] = await db.select().from(pricingRules).where(eq(pricingRules.id, 1)).limit(1);
  if (!created) throw new Error("Pricing rules could not be initialized");
  return toPricingRules(created);
}

export async function savePricingRules(input: PricingRules): Promise<PricingRuleRecord> {
  const [saved] = await db
    .insert(pricingRules)
    .values({ id: 1, ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: pricingRules.id,
      set: { ...input, updatedAt: new Date() },
    })
    .returning();
  return toPricingRules(saved);
}
