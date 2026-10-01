import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookingForm } from "@/components/booking-form";
import { PageHeader } from "@/components/ui";
import { isStaff, requireUser } from "@/lib/auth";
import { listVehicleTypes } from "@/services/fleet";

export const metadata: Metadata = { title: "Book a truck" };
export const dynamic = "force-dynamic";

export default async function NewBookingPage() {
  const user = await requireUser();
  if (isStaff(user.role)) redirect("/admin/bookings");
  const vehicleTypes = await listVehicleTypes({ activeOnly: true });

  return (
    <>
      <PageHeader title="Book a truck" description="Get an instant fixed price. A dispatcher confirms your job and allocates a driver." />
      <BookingForm
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
