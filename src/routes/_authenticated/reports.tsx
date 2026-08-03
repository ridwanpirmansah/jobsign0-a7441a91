import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { TrendingUp, Wallet, Receipt, DollarSign, Users, BarChart3, PieChart as PieIcon } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";

export const Route = createFileRoute("/_authenticated/reports")({ component: ReportsPage });

function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
}
function fmtIDRShort(n: number) {
  const v = Math.abs(n || 0);
  if (v >= 1_000_000_000) return `Rp ${(n/1_000_000_000).toFixed(1)}M`;
  if (v >= 1_000_000) return `Rp ${(n/1_000_000).toFixed(1)}jt`;
  if (v >= 1_000) return `Rp ${(n/1_000).toFixed(0)}rb`;
  return fmtIDR(n);
}

const PIE_COLORS = ["#0ea5e9", "#f97316", "#22c55e", "#a855f7", "#ec4899", "#eab308", "#14b8a6", "#ef4444", "#6366f1"];

function ReportsPage() {
  const { data: me } = useCurrentUser();
  const [from, setFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));

  const { data, isLoading } = useQuery({
    enabled: me?.role === "owner",
    queryKey: ["reports", from, to],
    queryFn: async () => {
      const [orders, logs, payrolls, expenses] = await Promise.all([
        supabase.from("orders").select("payment,split,status,co_date")
          .not("status", "in", "(draft,ready_stock)")
          .gte("co_date", from).lte("co_date", to),
        supabase.from("job_logs")
          .select("amount,status,log_date,employee_id,is_repair,employee:employees(full_name,type),rate:job_rates(name,unit,pricing_mode)")
          .gte("log_date", from).lte("log_date", to),
        supabase.from("payrolls").select("total,base,bonus,deductions,status,period_start,period_end,employee:employees(full_name,type)")
          .gte("period_start", from).lte("period_end", to),
        supabase.from("expenses").select("amount,category,expense_date,affects_pnl,payment_status,description,vendor")
          .gte("expense_date", from).lte("expense_date", to),
      ]);
      return {
        orders: orders.data ?? [],
        logs: logs.data ?? [],
        payrolls: payrolls.data ?? [],
        expenses: expenses.data ?? [],
      };
    },
  });

  const stats = useMemo(() => {
    const orders = data?.orders ?? [];
    const logs = data?.logs ?? [];
    const payrolls = data?.payrolls ?? [];
    const expenses = data?.expenses ?? [];

    const omzet = orders.reduce((s, o: any) => s + Number(o.payment ?? 0) + Number(o.split ?? 0), 0);
    const approvedLogs = logs.filter((l: any) => l.status === "approved");
    const tenagaKerjaBorongan = approvedLogs.reduce((s, l: any) => s + Number(l.amount), 0);
    const payrollPaid = payrolls.filter((p: any) => p.status === "approved" || p.status === "paid").reduce((s, p: any) => s + Number(p.total), 0);
    const tenagaKerja = tenagaKerjaBorongan + payrollPaid;
    const belanjaAll = expenses.reduce((s, e: any) => s + Number(e.amount || 0), 0);
    const belanjaPnl = expenses.filter((e: any) => e.affects_pnl !== false).reduce((s, e: any) => s + Number(e.amount || 0), 0);
    const belanjaHutang = expenses.filter((e: any) => e.payment_status === "unpaid" || e.payment_status === "partial").reduce((s, e: any) => s + Number(e.amount || 0), 0);
    const margin = omzet - tenagaKerja - belanjaAll;

    // Per employee breakdown by rate unit + payrolls
    type Row = { name: string; borongan: number; area: number; payroll: number; total: number };
    const map = new Map<string, Row>();
    for (const l of approvedLogs as any[]) {
      const name = l.employee?.full_name ?? "—";
      const row = map.get(name) ?? { name, borongan: 0, area: 0, payroll: 0, total: 0 };
      const mode = l.rate?.pricing_mode;
      if (mode === "area") row.area += Number(l.amount);
      else row.borongan += Number(l.amount);
      row.total = row.borongan + row.area + row.payroll;
      map.set(name, row);
    }
    for (const p of payrolls as any[]) {
      if (p.status !== "approved" && p.status !== "paid") continue;
      const name = p.employee?.full_name ?? "—";
      const row = map.get(name) ?? { name, borongan: 0, area: 0, payroll: 0, total: 0 };
      row.payroll += Number(p.total || 0);
      row.total = row.borongan + row.area + row.payroll;
      map.set(name, row);
    }
    const perEmployee = Array.from(map.values()).sort((a, b) => b.total - a.total);

    // Expenses by category
    const catMap = new Map<string, number>();
    for (const e of expenses as any[]) {
      const k = String(e.category ?? "lainnya");
      catMap.set(k, (catMap.get(k) ?? 0) + Number(e.amount || 0));
    }
    const perCategory = Array.from(catMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    // Daily omzet trend
    const dayMap = new Map<string, { date: string; omzet: number; expense: number }>();
    for (const o of orders as any[]) {
      const d = o.co_date; if (!d) continue;
      const cur = dayMap.get(d) ?? { date: d, omzet: 0, expense: 0 };
      cur.omzet += Number(o.payment ?? 0) + Number(o.split ?? 0);
      dayMap.set(d, cur);
    }
    for (const e of expenses as any[]) {
      const d = e.expense_date; if (!d) continue;
      const cur = dayMap.get(d) ?? { date: d, omzet: 0, expense: 0 };
      cur.expense += Number(e.amount || 0);
      dayMap.set(d, cur);
    }
    const trend = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ ...r, label: r.date.slice(5) }));

    return { omzet, tenagaKerja, tenagaKerjaBorongan, payrollPaid, belanjaAll, belanjaPnl, belanjaHutang, margin, perEmployee, perCategory, trend };
  }, [data]);

  if (me && me.role !== "owner") return <p className="text-sm text-slate-500">Hanya owner yang bisa lihat laporan.</p>;

  const cards = [
    { label: "Omzet", value: stats.omzet, sub: "Kontrak + split", icon: TrendingUp, from: "from-emerald-500", to: "to-teal-500", text: "text-emerald-50" },
    { label: "Tenaga Kerja", value: stats.tenagaKerja, sub: `Borongan ${fmtIDRShort(stats.tenagaKerjaBorongan)} · Harian ${fmtIDRShort(stats.payrollPaid)}`, icon: Users, from: "from-amber-500", to: "to-orange-500", text: "text-amber-50" },
    { label: "Beban Belanja", value: stats.belanjaAll, sub: stats.belanjaHutang > 0 ? `Termasuk hutang ${fmtIDRShort(stats.belanjaHutang)}` : "Seluruh belanja", icon: Receipt, from: "from-rose-500", to: "to-pink-500", text: "text-rose-50" },
    { label: "Estimasi Margin", value: stats.margin, sub: "Omzet − TK − Belanja", icon: DollarSign, from: stats.margin >= 0 ? "from-sky-500" : "from-red-500", to: stats.margin >= 0 ? "to-indigo-500" : "to-rose-600", text: "text-sky-50" },
  ];

  return (
    <div className="edge-to-edge p-0 sm:p-4 space-y-4 sm:space-y-5 max-w-7xl">
      <div className="flex items-center gap-2 px-3 sm:px-0 pt-3 sm:pt-0">
        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 grid place-items-center text-white shadow">
          <BarChart3 className="h-5 w-5"/>
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Laporan Keuangan</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Ringkasan omzet, upah, & pengeluaran periode.</p>
        </div>
      </div>

      <div className="px-3 sm:px-0">
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="grid gap-3 sm:flex sm:items-end">
              <div className="flex-1"><Label className="text-xs">Dari</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="flex-1"><Label className="text-xs">Sampai</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { k: "lastmonth", label: "Bulan lalu", from: format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd"), to: format(endOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd") },
                  { k: "month", label: "Bulan ini", from: format(startOfMonth(new Date()), "yyyy-MM-dd"), to: format(endOfMonth(new Date()), "yyyy-MM-dd") },
                  { k: "7d", label: "7 hari", from: format(new Date(Date.now() - 6*86400000), "yyyy-MM-dd"), to: format(new Date(), "yyyy-MM-dd") },
                  { k: "30d", label: "30 hari", from: format(new Date(Date.now() - 29*86400000), "yyyy-MM-dd"), to: format(new Date(), "yyyy-MM-dd") },
                ].map((p) => (
                  <button key={p.k} onClick={() => { setFrom(p.from); setTo(p.to); }}
                    className="px-2.5 py-1.5 rounded-md text-xs font-medium border bg-white hover:bg-slate-50">
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="px-3 sm:px-0 grid gap-3 grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-2xl bg-gradient-to-br ${c.from} ${c.to} p-4 shadow-md ${c.text} overflow-hidden`}>
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-90">{c.label}</div>
              <c.icon className="h-4 w-4 opacity-80"/>
            </div>
            <div className="mt-2 text-lg sm:text-2xl font-black leading-tight break-words">{fmtIDR(c.value)}</div>
            <div className="text-[10px] sm:text-xs opacity-80 mt-1 truncate">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="px-3 sm:px-0 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4 text-indigo-600"/> Tren Harian (Omzet vs Belanja)</CardTitle></CardHeader>
          <CardContent className="p-2">
            <div className="h-56">
              {stats.trend.length === 0 ? (
                <div className="h-full grid place-items-center text-xs text-muted-foreground">Belum ada data</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtIDRShort(v).replace("Rp ", "")} width={50}/>
                    <Tooltip formatter={(v: number) => fmtIDR(v)} labelFormatter={(l) => `Tgl ${l}`}/>
                    <Legend wrapperStyle={{ fontSize: 11 }}/>
                    <Bar dataKey="omzet" name="Omzet" fill="#10b981" radius={[4,4,0,0]} />
                    <Bar dataKey="expense" name="Belanja" fill="#f43f5e" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><PieIcon className="h-4 w-4 text-rose-600"/> Pengeluaran per Kategori</CardTitle></CardHeader>
          <CardContent className="p-2">
            <div className="h-56">
              {stats.perCategory.length === 0 ? (
                <div className="h-full grid place-items-center text-xs text-muted-foreground">Belum ada pengeluaran</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={stats.perCategory} dataKey="value" nameKey="name" outerRadius={80} label={(e: any) => e.name}>
                      {stats.perCategory.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]}/>)}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmtIDR(v)}/>
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per employee */}
      <div className="px-3 sm:px-0">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wallet className="h-4 w-4 text-emerald-600"/> Upah per Karyawan (approved)
              <Badge variant="secondary">{stats.perEmployee.length} orang</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 sm:p-4 space-y-4">
            {/* Chart */}
            {stats.perEmployee.length > 0 && (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.perEmployee.slice(0, 12)} margin={{ top: 8, right: 8, bottom: 40, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={60}/>
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtIDRShort(v).replace("Rp ", "")} width={50}/>
                    <Tooltip formatter={(v: number) => fmtIDR(v)}/>
                    <Legend wrapperStyle={{ fontSize: 11 }}/>
                    <Bar dataKey="borongan" name="Borongan (titik)" stackId="a" fill="#0ea5e9" />
                    <Bar dataKey="area" name="Area (P×L)" stackId="a" fill="#a855f7" />
                    <Bar dataKey="payroll" name="Payroll (harian/jam)" stackId="a" fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Mobile list */}
            <div className="md:hidden space-y-2">
              {stats.perEmployee.map((e) => (
                <div key={e.name} className="rounded-xl border bg-white p-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900 truncate">{e.name}</span>
                    <span className="font-bold text-emerald-600 shrink-0">{fmtIDR(e.total)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                    {e.borongan > 0 && <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100">Borongan {fmtIDRShort(e.borongan)}</Badge>}
                    {e.area > 0 && <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">Area {fmtIDRShort(e.area)}</Badge>}
                    {e.payroll > 0 && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Payroll {fmtIDRShort(e.payroll)}</Badge>}
                  </div>
                </div>
              ))}
              {!stats.perEmployee.length && <div className="text-center py-6 text-slate-500 text-sm">Tidak ada data</div>}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500 border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Karyawan</th>
                    <th className="text-right py-2 px-2">Borongan (titik)</th>
                    <th className="text-right py-2 px-2">Area (P×L)</th>
                    <th className="text-right py-2 px-2">Payroll (harian/jam)</th>
                    <th className="text-right py-2 px-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.perEmployee.map((e) => (
                    <tr key={e.name} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="py-2 px-2 font-medium">{e.name}</td>
                      <td className="py-2 px-2 text-right text-sky-700">{e.borongan ? fmtIDR(e.borongan) : "—"}</td>
                      <td className="py-2 px-2 text-right text-purple-700">{e.area ? fmtIDR(e.area) : "—"}</td>
                      <td className="py-2 px-2 text-right text-amber-700">{e.payroll ? fmtIDR(e.payroll) : "—"}</td>
                      <td className="py-2 px-2 text-right font-bold text-emerald-700">{fmtIDR(e.total)}</td>
                    </tr>
                  ))}
                  {!stats.perEmployee.length && (
                    <tr><td colSpan={5} className="text-center py-6 text-slate-500">Tidak ada data</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {isLoading && <div className="text-xs text-muted-foreground text-center">Memuat data…</div>}
    </div>
  );
}
