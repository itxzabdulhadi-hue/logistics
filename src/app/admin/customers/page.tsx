import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, EmptyState, Input, LinkButton, PageHeader, Pagination } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/utils";
import { listCustomers } from "@/services/users";

export const metadata: Metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requireRole(["admin", "dispatcher"]);
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const result = await listCustomers({ q, page, pageSize: 20 });

  return (
    <>
      <PageHeader title="Customers" description={`${result.total} customer account${result.total === 1 ? "" : "s"}.`} />
      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-4" method="get">
          <div className="w-full sm:w-80"><Input name="q" defaultValue={q} placeholder="Search name, email or company" /></div>
          <Button type="submit" variant="secondary">Search</Button>
          {q && <LinkButton href="/admin/customers" variant="ghost">Clear</LinkButton>}
        </form>
        {result.customers.length === 0 ? (
          <EmptyState title="No customers found" description={q ? "Try a different search." : "Customers appear here once they register."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Contact</th><th className="px-5 py-3 text-right">Bookings</th><th className="px-5 py-3 text-right">Active</th><th className="px-5 py-3 text-right">Lifetime spend</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Joined</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.customers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3">
                      <Link href={`/admin/customers/${c.id}`} className="font-semibold text-slate-900 hover:text-orange-600">{c.name}</Link>
                      {c.companyName && <div className="text-xs text-slate-500">{c.companyName}</div>}
                    </td>
                    <td className="px-5 py-3 text-slate-700">{c.email}{c.phone && <div className="text-xs text-slate-500">{c.phone}</div>}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{c.bookingCount}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{c.activeJobs}</td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-900">{formatMoney(c.spendCents)}</td>
                    <td className="px-5 py-3">{c.status === "active" ? <Badge tone="green">Active</Badge> : <Badge tone="red">Suspended</Badge>}</td>
                    <td className="px-5 py-3 text-slate-700">{formatDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result.total > 0 && <Pagination page={result.page} totalPages={result.totalPages} total={result.total} basePath="/admin/customers" params={{ q }} />}
      </Card>
    </>
  );
}
