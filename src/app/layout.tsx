import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Loadline — On-demand truck booking", template: "%s · Loadline" },
  description:
    "Book utes, vans, pantechs and semis in minutes. Instant quotes, live job status, and a dispatch console for operations.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
