import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookingForm } from "@/components/booking-form";
import { PageHeader } from "@/components/ui";
import { isStaff, requireUser } from "@/lib/auth";
import { listVehicleTypes } from "@/services/fleet";
import { getPricingRules } from "@/services/pricing";

export const metadata: Metadata = { title: "Book a truck" };
export const dynamic = "force-dynamic";

export default async function NewBookingPage() {
  const user = await requireUser();
  if (isStaff(user.role)) redirect("/admin/bookings");
  if (user.role === "driver") redirect("/driver");
  const [vehicleTypes, pricingRules] = await Promise.all([
    listVehicleTypes({ activeOnly: true }),
    getPricingRules(),
  ]);

  return (
    <>
      <PageHeader title="Book a truck" description="Map your route, choose a vehicle, and get an itemized price before submitting." />
      <BookingForm
        pricingRules={pricingRules}
        vehicleTypes={vehicleTypes.map((vt) => ({
          id: vt.id,
          name: vt.name,
          description: vt.description,
          maxWeightKg: vt.maxWeightKg,
          maxPallets: vt.maxPallets,
          baseFareCents: vt.baseFareCents,
          perKmRateCents: vt.perKmRateCents,
          minimumChargeCents: vt.minimumChargeCents,
        }))}
        defaults={{
          contactName: user.name,
          contactPhone: user.phone ?? "",
          paymentMethod: user.companyName ? "account" : "card",
        }}
      />
    </>
  );
}
