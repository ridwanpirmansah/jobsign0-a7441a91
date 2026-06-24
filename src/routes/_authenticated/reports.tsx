import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, startOfMonth, endOfMonth } from "date-fns";

export const Route = createFileRoute("/_authenticated/reports")({ component: ReportsPage });

function fmtIDR(n: number) { return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0); }

function ReportsPage() {
  const { data: me } = useCurrentUser();
  const [from, setFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));

  const { data } = useQuery({
    enabled: me?.role === "owner",
    queryKey: ["reports", from, to],
    queryFn: async () => {
      const [projects, logs, payrolls] = await Promise.all([
        supabase.from("projects").select("id,code,title,status,contract_value,created_at").gte("created_at", from).lte("created_at", to + "T23:59:59"),
        supabase.from("job_logs").select("amount,status,log_date,project_id,employee_id,employee:employees(full_name)").gte("log_date", from).lte("log_date", to),
        supabase.from("payrolls").select("total,status,period_start").gte("period_start", from).lte("period_end", to),
      ]);
      return { projects: projects.data ?? [], logs: logs.data ?? [], payrolls: payrolls.data ?? [] };
    },
  });

  if (me?.role !== "owner") return <p className="text-sm text-slate-500">Hanya owner yang bisa lihat laporan.</p>;

  const omzet = (data?.projects ?? []).reduce((s, p) => s + Number(p.contract_value), 0);
  const tenagaKerja = (data?.logs ?? []).filter((l) => l.status === "approved").reduce((s, l) => s + Number(l.amount), 0);
  const payrollPaid = (data?.payrolls ?? []).filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.total), 0);

  // group per karyawan
  const perEmp = new Map<string, { name: string; total: number }>();
  (data?.logs ?? []).filter((l) => l.status === "approved").forEach((l) => {
    const key = l.employee_id;
    const cur = perEmp.get(key) ?? { name: l.employee?.full_name ?? "—", total: 0 };
    cur.total += Number(l.amount); perEmp.set(key, cur);
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div><h1 className="text-2xl font-bold text-slate-900">Laporan Keuangan</h1><p className="text-sm text-slate-500">Ringkasan periode</p></div>

      <Card>
        <CardHeader><CardTitle className="text-base">Periode</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-3 items-end">
            <div><Label>Dari</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label>Sampai</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Omzet (kontrak)</div><div className="text-2xl font-bold text-emerald-600">{fmtIDR(omzet)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Biaya tenaga kerja (approved)</div><div className="text-2xl font-bold text-amber-600">{fmtIDR(tenagaKerja)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Payroll dibayar</div><div className="text-2xl font-bold">{fmtIDR(payrollPaid)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Estimasi margin</div><div className="text-2xl font-bold text-sky-600">{fmtIDR(omzet - tenagaKerja)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Upah per Karyawan (approved)</CardTitle></CardHeader>
        <CardContent className="p-0">
          {/* Mobile: cards */}
          <div className="md:hidden space-y-2 p-3">
            {[...perEmp.values()].sort((a, b) => b.total - a.total).map((e, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <span className="font-medium text-slate-900 truncate">{e.name}</span>
                <span className="font-bold text-emerald-600 shrink-0">{fmtIDR(e.total)}</span>
              </div>
            ))}
            {!perEmp.size && <div className="text-center py-6 text-slate-500 text-sm">Tidak ada data</div>}
          </div>
          {/* Desktop: table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader><TableRow><TableHead>Karyawan</TableHead><TableHead className="text-right">Total Upah</TableHead></TableRow></TableHeader>
              <TableBody>
                {[...perEmp.values()].sort((a, b) => b.total - a.total).map((e, i) => (
                  <TableRow key={i}><TableCell>{e.name}</TableCell><TableCell className="text-right font-medium">{fmtIDR(e.total)}</TableCell></TableRow>
                ))}
                {!perEmp.size && <TableRow><TableCell colSpan={2} className="text-center py-6 text-slate-500">Tidak ada data</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
