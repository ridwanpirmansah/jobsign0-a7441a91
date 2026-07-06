import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, ChevronLeft, ChevronRight, Download, CalendarDays, CalendarRange } from "lucide-react";
import { format, startOfWeek, endOfWeek, addWeeks, startOfMonth, endOfMonth, addMonths, isSameDay } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { generateSlipPdf, type SlipJobBreakdown, type SlipAttendance, type SlipConsumption } from "@/lib/payroll-pdf";
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
  const [mode, setMode] = useState<"week" | "month">("week");
  const [from, setFrom] = useState(format(weekStart(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(weekEnd(new Date()), "yyyy-MM-dd"));
  const [pickerOpen, setPickerOpen] = useState(false);

  const setRange = (s: Date, e: Date) => {
    setFrom(format(s, "yyyy-MM-dd"));
    setTo(format(e, "yyyy-MM-dd"));
  };
  const shift = (delta: number) => {
    const base = new Date(from + "T00:00:00");
    if (mode === "week") {
      const s = weekStart(addWeeks(base, delta));
      setRange(s, weekEnd(s));
    } else {
      const s = startOfMonth(addMonths(base, delta));
      setRange(s, endOfMonth(s));
    }
  };
  const goCurrent = () => {
    const now = new Date();
    if (mode === "week") setRange(weekStart(now), weekEnd(now));
    else setRange(startOfMonth(now), endOfMonth(now));
  };
  const switchMode = (m: "week" | "month") => {
    setMode(m);
    const base = new Date(from + "T00:00:00");
    if (m === "week") setRange(weekStart(base), weekEnd(base));
    else setRange(startOfMonth(base), endOfMonth(base));
  };
  const onPickDate = (d: Date | undefined) => {
    if (!d) return;
    if (mode === "week") setRange(weekStart(d), weekEnd(d));
    else setRange(startOfMonth(d), endOfMonth(d));
    setPickerOpen(false);
  };

  const fromDate = new Date(from + "T00:00:00");
  const toDate = new Date(to + "T00:00:00");
  const isCurrent = mode === "week"
    ? isSameDay(fromDate, weekStart(new Date()))
    : isSameDay(fromDate, startOfMonth(new Date()));
  const rangeLabel = mode === "week"
    ? `${format(fromDate, "dd MMM", { locale: idLocale })} – ${format(toDate, "dd MMM yyyy", { locale: idLocale })}`
    : format(fromDate, "MMMM yyyy", { locale: idLocale });

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

  // Konsumsi karyawan yang belum dipotong (akan jadi potongan slip)
  const { data: outstandingConsumption } = useQuery({
    enabled: !!empId,
    queryKey: ["earnings-consumption", empId, to],
    queryFn: async () => {
      const { data } = await supabase.from("employee_consumption")
        .select("amount,consumption_date,note")
        .eq("employee_id", empId!).eq("deducted", false).lte("consumption_date", to)
        .order("consumption_date", { ascending: true });
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

  // Total cashbon yang belum dibayar (status approved) → potongan slip
  const cashbonDeduction = useMemo(
    () => (outstandingCashbon ?? []).reduce((s, c) => s + Number(c.amount), 0),
    [outstandingCashbon],
  );

  // Rincian garapan per jenis (Potong / Tempel / Solder / Kabel, dst) — non-reparasi
  const jobBreakdown: SlipJobBreakdown[] = useMemo(() => {
    const map = new Map<string, SlipJobBreakdown>();
    (logs ?? []).filter((l) => !l.is_repair).forEach((l) => {
      const name = l.rate?.name ?? "Lainnya";
      const unit = l.rate?.unit ?? "pcs";
      const cur = map.get(name) ?? { name, unit, qty: 0, amount: 0 };
      cur.qty += Number(l.qty);
      cur.amount += Number(l.amount);
      map.set(name, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [logs]);

  // Rincian khusus reparasi
  const repairBreakdown: SlipJobBreakdown[] = useMemo(() => {
    const map = new Map<string, SlipJobBreakdown>();
    (logs ?? []).filter((l) => l.is_repair).forEach((l) => {
      const name = l.rate?.name ?? "Reparasi";
      const unit = l.rate?.unit ?? "pcs";
      const cur = map.get(name) ?? { name, unit, qty: 0, amount: 0 };
      cur.qty += Number(l.qty);
      cur.amount += Number(l.amount);
      map.set(name, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [logs]);

  const repairTotalCount = useMemo(() => repairBreakdown.reduce((s, b) => s + b.qty, 0), [repairBreakdown]);
  const repairTotalAmount = useMemo(() => repairBreakdown.reduce((s, b) => s + b.amount, 0), [repairBreakdown]);

  // Attendance per hari + jam kerja
  const attendanceDetail: SlipAttendance[] = useMemo(() => {
    return (attendances ?? [])
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((a) => {
        let hours = 0;
        if (a.check_in && a.check_out) {
          const ms = new Date(a.check_out).getTime() - new Date(a.check_in).getTime();
          const breakMs = a.break_start && a.break_end
            ? new Date(a.break_end).getTime() - new Date(a.break_start).getTime() : 0;
          hours = Math.max(0, (ms - breakMs) / 3600000);
        }
        return { date: a.date, check_in: a.check_in, check_out: a.check_out, hours };
      });
  }, [attendances]);

  const totalHours = useMemo(() => attendanceDetail.reduce((s, a) => s + a.hours, 0), [attendanceDetail]);
  const baseTotal = summary.approvedTotal + summary.pendingTotal;
  const netTotal = baseTotal - cashbonDeduction;

  const handleDownloadPdf = () => {
    if (!empMeta) { toast.error("Data karyawan belum siap"); return; }
    generateSlipPdf({
      employeeName: empMeta.full_name,
      employeeCode: empMeta.employee_code,
      employeeType: empMeta.type,
      periodStart: from,
      periodEnd: to,
      jobBreakdown,
      repairBreakdown,
      attendance: attendanceDetail,
      base: baseTotal,
      bonus: 0,
      cashbonDeduction,
      totalHours,
    });
    toast.success("Slip gaji PDF berhasil diunduh");
  };

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

      <Card className="overflow-hidden border-0 shadow-sm bg-gradient-to-br from-sky-50 via-violet-50 to-rose-50">
        <CardContent className="p-3 sm:p-4 space-y-3">
          {/* Mode toggle */}
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex rounded-full bg-white/70 backdrop-blur p-0.5 shadow-sm border border-white">
              {(["week", "month"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-semibold rounded-full transition-all",
                    mode === m
                      ? "bg-gradient-to-r from-sky-500 to-violet-500 text-white shadow"
                      : "text-slate-600 hover:text-slate-900",
                  )}
                >
                  {m === "week" ? "Mingguan" : "Bulanan"}
                </button>
              ))}
            </div>
            <button
              onClick={goCurrent}
              className={cn(
                "px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all",
                isCurrent
                  ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                  : "bg-white/70 text-slate-600 border border-white hover:bg-white",
              )}
            >
              {mode === "week" ? "Minggu Ini" : "Bulan Ini"}
            </button>
          </div>

          {/* Navigator */}
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => shift(-1)}
              className="h-10 w-10 rounded-full bg-white/80 hover:bg-white shadow-sm shrink-0"
              aria-label="Periode sebelumnya"
            >
              <ChevronLeft className="h-5 w-5 text-sky-600" />
            </Button>

            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <button className="min-w-0 rounded-2xl bg-white/90 backdrop-blur px-3 py-2.5 shadow-sm border border-white hover:bg-white transition-all text-center group">
                  <div className="flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
                    <CalendarRange className="h-3 w-3" />
                    {mode === "week" ? "Periode Mingguan" : "Periode Bulanan"}
                  </div>
                  <div className="mt-0.5 text-sm sm:text-base font-bold text-slate-900 truncate">
                    {rangeLabel}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {mode === "week" ? "Min – Sab · Gajian Sabtu" : "Tap untuk pilih bulan"}
                  </div>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-fit max-w-[calc(100vw-1rem)] overflow-hidden p-0 pointer-events-auto" align="center">
                <Calendar
                  mode="single"
                  selected={fromDate}
                  onSelect={onPickDate}
                  weekStartsOn={0}
                  locale={idLocale}
                  initialFocus
                  className={cn("p-3 pointer-events-auto max-sm:[--cell-size:calc((100vw-2.5rem)/7)] max-sm:p-2 max-sm:text-xs")}
                />
              </PopoverContent>
            </Popover>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => shift(1)}
              className="h-10 w-10 rounded-full bg-white/80 hover:bg-white shadow-sm shrink-0"
              aria-label="Periode berikutnya"
            >
              <ChevronRight className="h-5 w-5 text-sky-600" />
            </Button>
          </div>
        </CardContent>
      </Card>



      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Disetujui</div><div className="text-2xl font-bold text-emerald-600">{fmtIDR(summary.approvedTotal)}</div><div className="text-xs text-slate-400">{summary.approvedCount} laporan</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Menunggu Approval</div><div className="text-2xl font-bold text-amber-600">{fmtIDR(summary.pendingTotal)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Total Periode</div><div className="text-2xl font-bold text-slate-900">{fmtIDR(baseTotal)}</div></CardContent></Card>
      </div>

      {/* Slip Gaji Mingguan — preview & download */}
      <Card className="border-emerald-200/70 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base">Slip Gaji Minggu Ini</CardTitle>
              <p className="text-xs text-slate-500 mt-1">
                {format(new Date(from), "dd MMM", { locale: idLocale })} – {format(new Date(to), "dd MMM yyyy", { locale: idLocale })}
              </p>
            </div>
            <Button onClick={handleDownloadPdf} size="sm" className="bg-emerald-600 hover:bg-emerald-700">
              <Download className="h-4 w-4 mr-1.5" /> Unduh PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Rincian garapan per jenis */}
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500 mb-2">Rincian Garapan</div>
            {jobBreakdown.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {jobBreakdown.map((b) => (
                  <div key={b.name} className="rounded-lg border border-slate-200 bg-white px-3 py-2 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{b.name}</div>
                      <div className="text-[11px] text-slate-500">{b.qty} {b.unit}</div>
                    </div>
                    <div className="text-sm font-semibold text-sky-700">{fmtIDR(b.amount)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-400 italic">Belum ada garapan minggu ini</div>
            )}
          </div>

          {/* Rincian reparasi (jika ada) */}
          {repairBreakdown.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase text-orange-600 mb-2 flex items-center gap-1.5">
                🔧 Rincian Pekerjaan Reparasi
                <span className="text-[10px] font-normal normal-case text-orange-500">
                  ({repairTotalCount} pekerjaan · {fmtIDR(repairTotalAmount)})
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {repairBreakdown.map((b) => (
                  <div key={b.name} className="rounded-lg border border-orange-200 bg-orange-50/40 px-3 py-2 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{b.name}</div>
                      <div className="text-[11px] text-slate-500">{b.qty} {b.unit}</div>
                    </div>
                    <div className="text-sm font-semibold text-orange-700">{fmtIDR(b.amount)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Jam kerja */}
          <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <span className="text-sm text-slate-600">Total Jam Kerja Minggu Ini</span>
            <span className="text-sm font-bold text-slate-900">{totalHours.toFixed(2)} jam</span>
          </div>

          {/* Ringkasan */}
          <div className="rounded-lg border border-slate-200 divide-y">
            <div className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-slate-600">Penghasilan Pokok</span>
              <span className="font-semibold">{fmtIDR(baseTotal)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2 text-sm bg-rose-50/40">
              <div>
                <div className="text-slate-700">Potongan Cashbon</div>
                {cashbonDeduction > 0 && (
                  <div className="text-[11px] text-rose-600">{outstandingCashbon?.length} cashbon belum dibayar</div>
                )}
              </div>
              <span className="font-semibold text-rose-700">- {fmtIDR(cashbonDeduction)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5 bg-emerald-50">
              <span className="text-sm font-bold text-emerald-900">Total Diterima</span>
              <span className="text-lg font-bold text-emerald-700">{fmtIDR(netTotal)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

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
                    <span className="text-slate-600 truncate flex items-center gap-1.5">
                      {l.is_repair && <span className="rounded-full bg-orange-100 text-orange-700 border border-orange-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase">🔧 Reparasi</span>}
                      <span className="truncate">{l.rate?.name} <span className="text-slate-400">× {l.qty}</span></span>
                    </span>
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
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span>{l.rate?.name}</span>
                        {l.is_repair && <Badge className="bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100 text-[10px]">🔧 Reparasi</Badge>}
                      </div>
                    </TableCell>
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
