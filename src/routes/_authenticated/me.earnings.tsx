import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { id as idLocale } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/me/earnings")({ component: MyEarnings });

function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
}

function MyEarnings() {
  const { data: me } = useCurrentUser();
  const staff = isStaff(me?.role);
  const [onBehalfEmpId, setOnBehalfEmpId] = useState<string>("");
  const empId = staff && onBehalfEmpId ? onBehalfEmpId : me?.employee?.id;
  const [from, setFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));

  const { data: employees } = useQuery({
    enabled: staff,
    queryKey: ["employees-earnings-list"],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("id, full_name, type").eq("active", true).order("full_name");
      return data ?? [];
    },
  });

  const { data: logs } = useQuery({
    enabled: !!empId,
    queryKey: ["earnings-logs", empId, from, to],
    queryFn: async () => {
      const { data } = await supabase.from("job_logs")
        .select("*, project:projects(code,title), rate:job_rates(name,unit)")
        .eq("employee_id", empId!).gte("log_date", from).lte("log_date", to).order("log_date", { ascending: false });
      return data ?? [];
    },
  });

  const { data: payrolls } = useQuery({
    enabled: !!empId,
    queryKey: ["my-payrolls", empId],
    queryFn: async () => {
      const { data } = await supabase.from("payrolls").select("*").eq("employee_id", empId!).order("period_start", { ascending: false });
      return data ?? [];
    },
  });

  const summary = useMemo(() => {
    const approved = (logs ?? []).filter((l) => l.status === "approved");
    const pending = (logs ?? []).filter((l) => l.status === "pending");
    return {
      approvedTotal: approved.reduce((s, l) => s + Number(l.amount), 0),
      pendingTotal: pending.reduce((s, l) => s + Number(l.amount), 0),
      approvedCount: approved.length,
    };
  }, [logs]);

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Pendapatan {staff && onBehalfEmpId ? "Karyawan" : "Saya"}</h1>
        <p className="text-sm text-slate-500">Rekap upah borongan & slip gaji</p>
      </div>

      {staff && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-900">
              <ShieldCheck className="h-4 w-4" /> Mode Admin — Lihat pendapatan karyawan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-w-md">
              <Label>Karyawan</Label>
              <Select value={onBehalfEmpId} onValueChange={setOnBehalfEmpId}>
                <SelectTrigger><SelectValue placeholder={me?.employee ? "Diri sendiri (default)" : "Pilih karyawan"} /></SelectTrigger>
                <SelectContent>
                  {me?.employee && <SelectItem value={me.employee.id}>{me.employee.full_name} (saya)</SelectItem>}
                  {employees?.filter((e) => e.id !== me?.employee?.id).map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.full_name} {e.type ? `· ${e.type}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Filter Periode</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-3 flex-wrap items-end">
            <div><Label>Dari</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label>Sampai</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Disetujui</div><div className="text-2xl font-bold text-emerald-600">{fmtIDR(summary.approvedTotal)}</div><div className="text-xs text-slate-400">{summary.approvedCount} laporan</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Menunggu Approval</div><div className="text-2xl font-bold text-amber-600">{fmtIDR(summary.pendingTotal)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Total Periode</div><div className="text-2xl font-bold text-slate-900">{fmtIDR(summary.approvedTotal + summary.pendingTotal)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Detail Laporan</CardTitle></CardHeader>
        <CardContent className="p-0 sm:p-6">
          {/* Mobile: cards */}
          <div className="md:hidden space-y-3 p-3">
            {logs?.map((l) => (
              <div key={l.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500">{format(new Date(l.log_date), "EEE, dd MMM yyyy", { locale: idLocale })}</div>
                    {l.project && <div className="text-sm font-medium text-slate-900 truncate">{l.project.title}</div>}
                    {l.project && <div className="font-mono text-[10px] text-slate-400">{l.project.code}</div>}
                  </div>
                  <Badge variant={l.status === "approved" ? "default" : l.status === "rejected" ? "destructive" : "secondary"} className="shrink-0">{l.status}</Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{l.rate?.name} <span className="text-slate-400">× {l.qty}</span></span>
                  <span className="font-bold text-emerald-600">{fmtIDR(Number(l.amount))}</span>
                </div>
              </div>
            ))}
            {!logs?.length && <div className="text-center text-slate-500 py-6 text-sm">Tidak ada data pada periode ini</div>}
          </div>
          {/* Desktop: table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Tanggal</TableHead><TableHead>Project</TableHead><TableHead>Tarif</TableHead>
                <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Upah</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {logs?.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{format(new Date(l.log_date), "EEE, dd MMM yyyy", { locale: idLocale })}</TableCell>
                    <TableCell>
                      {l.project ? (
                        <div className="leading-tight">
                          <div className="font-mono text-xs text-slate-500">{l.project.code}</div>
                          <div className="font-medium text-slate-900">{l.project.title}</div>
                        </div>
                      ) : "—"}
                    </TableCell>
                    <TableCell>{l.rate?.name}</TableCell>
                    <TableCell className="text-right">{l.qty}</TableCell>
                    <TableCell className="text-right">{fmtIDR(Number(l.amount))}</TableCell>
                    <TableCell><Badge variant={l.status === "approved" ? "default" : l.status === "rejected" ? "destructive" : "secondary"}>{l.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {!logs?.length && <TableRow><TableCell colSpan={6} className="text-center text-slate-500 py-6">Tidak ada data pada periode ini</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Slip Gaji</CardTitle></CardHeader>
        <CardContent className="p-0 sm:p-6">
          {/* Mobile: cards */}
          <div className="md:hidden space-y-3 p-3">
            {payrolls?.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">
                    {format(new Date(p.period_start), "dd MMM", { locale: idLocale })} – {format(new Date(p.period_end), "dd MMM yyyy", { locale: idLocale })}
                  </div>
                  <Badge variant={p.status === "paid" ? "default" : "secondary"}>{p.status}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-md bg-slate-50 px-2 py-1.5">
                    <div className="text-[10px] uppercase text-slate-500">Base</div>
                    <div className="font-semibold text-slate-900">{fmtIDR(Number(p.base))}</div>
                  </div>
                  <div className="rounded-md bg-emerald-50 px-2 py-1.5">
                    <div className="text-[10px] uppercase text-emerald-700/70">Bonus</div>
                    <div className="font-semibold text-emerald-700">{fmtIDR(Number(p.bonus))}</div>
                  </div>
                  <div className="rounded-md bg-rose-50 px-2 py-1.5">
                    <div className="text-[10px] uppercase text-rose-700/70">Potongan</div>
                    <div className="font-semibold text-rose-700">{fmtIDR(Number(p.deductions))}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-2">
                  <span className="text-xs text-slate-500">Total</span>
                  <span className="text-base font-bold text-slate-900">{fmtIDR(Number(p.total))}</span>
                </div>
              </div>
            ))}
            {!payrolls?.length && <div className="text-center text-slate-500 py-6 text-sm">Belum ada slip</div>}
          </div>
          {/* Desktop: table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader><TableRow><TableHead>Periode</TableHead><TableHead className="text-right">Base</TableHead><TableHead className="text-right">Bonus</TableHead><TableHead className="text-right">Potongan</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {payrolls?.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{format(new Date(p.period_start), "dd MMM", { locale: idLocale })} – {format(new Date(p.period_end), "dd MMM yyyy", { locale: idLocale })}</TableCell>
                    <TableCell className="text-right">{fmtIDR(Number(p.base))}</TableCell>
                    <TableCell className="text-right">{fmtIDR(Number(p.bonus))}</TableCell>
                    <TableCell className="text-right">{fmtIDR(Number(p.deductions))}</TableCell>
                    <TableCell className="text-right font-semibold">{fmtIDR(Number(p.total))}</TableCell>
                    <TableCell><Badge variant={p.status === "paid" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {!payrolls?.length && <TableRow><TableCell colSpan={6} className="text-center text-slate-500 py-6">Belum ada slip</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
