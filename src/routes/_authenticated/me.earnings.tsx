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
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, ChevronLeft, ChevronRight, Download, CalendarDays } from "lucide-react";
import { format, startOfWeek, endOfWeek, addWeeks } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { generateSlipPdf, type SlipJobBreakdown, type SlipAttendance } from "@/lib/payroll-pdf";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/me/earnings")({ component: MyEarnings });

function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
}

// Weekly period: Sunday → Saturday
const weekStart = (d: Date) => startOfWeek(d, { weekStartsOn: 0 });
const weekEnd = (d: Date) => endOfWeek(d, { weekStartsOn: 0 });

function MyEarnings() {
  const { data: me } = useCurrentUser();
  const staff = isStaff(me?.role);
  const [onBehalfEmpId, setOnBehalfEmpId] = useState<string>("");
  const empId = staff && onBehalfEmpId ? onBehalfEmpId : me?.employee?.id;
  const [from, setFrom] = useState(format(weekStart(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(weekEnd(new Date()), "yyyy-MM-dd"));

  const shiftWeek = (delta: number) => {
    const base = new Date(from + "T00:00:00");
    const s = weekStart(addWeeks(base, delta));
    const e = weekEnd(s);
    setFrom(format(s, "yyyy-MM-dd"));
    setTo(format(e, "yyyy-MM-dd"));
  };
  const thisWeek = () => {
    setFrom(format(weekStart(new Date()), "yyyy-MM-dd"));
    setTo(format(weekEnd(new Date()), "yyyy-MM-dd"));
  };

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

  const { data: empInfo } = useQuery({
    enabled: !!empId,
    queryKey: ["earnings-emp", empId],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("id, daily_wage, hourly_rate, pay_unit, type").eq("id", empId!).maybeSingle();
      return data;
    },
  });

  const { data: attendances } = useQuery({
    enabled: !!empId,
    queryKey: ["earnings-att", empId, from, to],
    queryFn: async () => {
      const { data } = await supabase.from("attendances")
        .select("*").eq("employee_id", empId!).gte("date", from).lte("date", to).order("date", { ascending: false });
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

  // Outstanding cashbon (approved tapi belum dibayar) → akan menjadi potongan
  const { data: outstandingCashbon } = useQuery({
    enabled: !!empId,
    queryKey: ["earnings-cashbon", empId],
    queryFn: async () => {
      const { data } = await supabase.from("cashbon").select("amount,status,request_date,note")
        .eq("employee_id", empId!).eq("status", "approved");
      return data ?? [];
    },
  });

  const { data: empMeta } = useQuery({
    enabled: !!empId,
    queryKey: ["earnings-emp-meta", empId],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("full_name,employee_code,type").eq("id", empId!).maybeSingle();
      return data;
    },
  });

  // Build daily wage entries from attendance
  const dailyEntries = useMemo(() => {
    if (!empInfo || !attendances) return [];
    const wage = Number(empInfo.daily_wage || 0);
    const hourly = Number(empInfo.hourly_rate || 0);
    if (wage <= 0 && hourly <= 0) return [];
    return attendances
      .filter((a) => !!a.check_in && a.status === "hadir")
      .map((a) => {
        let amount = 0;
        let qtyLabel = "1 hari";
        if (empInfo.pay_unit === "hour" && hourly > 0 && a.check_out) {
          const ms = new Date(a.check_out).getTime() - new Date(a.check_in!).getTime();
          const breakMs = a.break_start && a.break_end
            ? new Date(a.break_end).getTime() - new Date(a.break_start).getTime() : 0;
          const hrs = Math.max(0, (ms - breakMs) / 3600000);
          amount = Math.round(hrs * hourly);
          qtyLabel = `${hrs.toFixed(2)} jam`;
        } else {
          amount = wage;
        }
        const isComplete = !!a.check_out;
        return {
          id: `att-${a.id}`,
          log_date: a.date,
          amount,
          qty: qtyLabel,
          status: isComplete ? "approved" : "pending",
          source: "attendance" as const,
        };
      })
      .filter((e) => e.amount > 0);
  }, [empInfo, attendances]);

  const summary = useMemo(() => {
    const approved = (logs ?? []).filter((l) => l.status === "approved");
    const pending = (logs ?? []).filter((l) => l.status === "pending");
    const approvedDaily = dailyEntries.filter((e) => e.status === "approved").reduce((s, e) => s + e.amount, 0);
    const pendingDaily = dailyEntries.filter((e) => e.status === "pending").reduce((s, e) => s + e.amount, 0);
    return {
      approvedTotal: approved.reduce((s, l) => s + Number(l.amount), 0) + approvedDaily,
      pendingTotal: pending.reduce((s, l) => s + Number(l.amount), 0) + pendingDaily,
      approvedCount: approved.length + dailyEntries.filter((e) => e.status === "approved").length,
    };
  }, [logs, dailyEntries]);

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

      <Card className="border-slate-200/70 shadow-sm">
        <CardHeader className="pb-2 px-3 sm:px-6"><CardTitle className="text-base">Detail Laporan</CardTitle></CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {/* Mobile: colorful vertical blocks */}
          <div className="md:hidden space-y-2 px-2 pb-2">
            {logs?.map((l) => {
              const tone = l.status === "approved"
                ? { stripe: "bg-emerald-400", chip: "bg-emerald-100 text-emerald-700 border-emerald-200", amount: "text-emerald-700", bg: "from-emerald-50/60 to-white" }
                : l.status === "rejected"
                ? { stripe: "bg-rose-400", chip: "bg-rose-100 text-rose-700 border-rose-200", amount: "text-rose-700", bg: "from-rose-50/60 to-white" }
                : { stripe: "bg-amber-400", chip: "bg-amber-100 text-amber-800 border-amber-200", amount: "text-amber-700", bg: "from-amber-50/60 to-white" };
              return (
                <div key={l.id} className={`relative overflow-hidden rounded-lg border border-slate-200/70 bg-gradient-to-br ${tone.bg} px-2.5 py-2 pl-3`}>
                  <span className={`absolute left-0 top-0 h-full w-1 ${tone.stripe}`} />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{format(new Date(l.log_date), "EEE, dd MMM yyyy", { locale: idLocale })}</div>
                      {l.project && <div className="text-sm font-semibold text-slate-900 truncate">{l.project.title}</div>}
                      {l.project && <div className="font-mono text-[10px] text-slate-400">{l.project.code}</div>}
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${tone.chip}`}>{l.status}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-sm">
                    <span className="text-slate-600 truncate">{l.rate?.name} <span className="text-slate-400">× {l.qty}</span></span>
                    <span className={`font-bold ${tone.amount}`}>{fmtIDR(Number(l.amount))}</span>
                  </div>
                </div>
              );
            })}
            {dailyEntries.map((e) => {
              const tone = e.status === "approved"
                ? { stripe: "bg-sky-400", chip: "bg-sky-100 text-sky-700 border-sky-200", amount: "text-sky-700", bg: "from-sky-50/60 to-white" }
                : { stripe: "bg-amber-400", chip: "bg-amber-100 text-amber-800 border-amber-200", amount: "text-amber-700", bg: "from-amber-50/60 to-white" };
              return (
                <div key={e.id} className={`relative overflow-hidden rounded-lg border border-slate-200/70 bg-gradient-to-br ${tone.bg} px-2.5 py-2 pl-3`}>
                  <span className={`absolute left-0 top-0 h-full w-1 ${tone.stripe}`} />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{format(new Date(e.log_date), "EEE, dd MMM yyyy", { locale: idLocale })}</div>
                      <div className="text-sm font-semibold text-slate-900">Upah Harian {empInfo?.pay_unit === "hour" ? "(Jam)" : "(Hari)"}</div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${tone.chip}`}>{e.status}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-sm">
                    <span className="text-slate-600 truncate">Kehadiran <span className="text-slate-400">× {e.qty}</span></span>
                    <span className={`font-bold ${tone.amount}`}>{fmtIDR(e.amount)}</span>
                  </div>
                </div>
              );
            })}
            {!logs?.length && !dailyEntries.length && <div className="text-center text-slate-500 py-6 text-sm">Tidak ada data pada periode ini</div>}
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
                {dailyEntries.map((e) => (
                  <TableRow key={e.id} className="bg-sky-50/30">
                    <TableCell>{format(new Date(e.log_date), "EEE, dd MMM yyyy", { locale: idLocale })}</TableCell>
                    <TableCell className="italic text-slate-500">Upah Harian (kehadiran)</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell className="text-right">{e.qty}</TableCell>
                    <TableCell className="text-right">{fmtIDR(e.amount)}</TableCell>
                    <TableCell><Badge variant={e.status === "approved" ? "default" : "secondary"}>{e.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {!logs?.length && !dailyEntries.length && <TableRow><TableCell colSpan={6} className="text-center text-slate-500 py-6">Tidak ada data pada periode ini</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200/70 shadow-sm">
        <CardHeader className="pb-2 px-3 sm:px-6"><CardTitle className="text-base">Slip Gaji</CardTitle></CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {/* Mobile: colorful vertical blocks */}
          <div className="md:hidden space-y-2 px-2 pb-2">
            {payrolls?.map((p) => {
              const paid = p.status === "paid";
              return (
                <div key={p.id} className={`relative overflow-hidden rounded-lg border border-slate-200/70 bg-gradient-to-br ${paid ? "from-emerald-50/60" : "from-indigo-50/60"} to-white px-2.5 py-2 pl-3`}>
                  <span className={`absolute left-0 top-0 h-full w-1 ${paid ? "bg-emerald-400" : "bg-indigo-400"}`} />
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">
                      {format(new Date(p.period_start), "dd MMM", { locale: idLocale })} – {format(new Date(p.period_end), "dd MMM yyyy", { locale: idLocale })}
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${paid ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-indigo-100 text-indigo-700 border-indigo-200"}`}>{p.status}</span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-xs">
                    <div className="rounded-md bg-sky-50 border border-sky-100 px-1.5 py-1">
                      <div className="text-[9px] uppercase text-sky-700/80">Base</div>
                      <div className="font-semibold text-sky-800 text-[11px]">{fmtIDR(Number(p.base))}</div>
                    </div>
                    <div className="rounded-md bg-emerald-50 border border-emerald-100 px-1.5 py-1">
                      <div className="text-[9px] uppercase text-emerald-700/80">Bonus</div>
                      <div className="font-semibold text-emerald-700 text-[11px]">{fmtIDR(Number(p.bonus))}</div>
                    </div>
                    <div className="rounded-md bg-rose-50 border border-rose-100 px-1.5 py-1">
                      <div className="text-[9px] uppercase text-rose-700/80">Potongan</div>
                      <div className="font-semibold text-rose-700 text-[11px]">{fmtIDR(Number(p.deductions))}</div>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between border-t border-dashed border-slate-200 pt-1.5">
                    <span className="text-[11px] text-slate-500">Total Diterima</span>
                    <span className="text-base font-bold text-slate-900">{fmtIDR(Number(p.total))}</span>
                  </div>
                </div>
              );
            })}
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
