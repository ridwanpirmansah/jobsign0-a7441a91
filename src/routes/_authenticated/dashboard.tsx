import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CalendarCheck,
  ClipboardList,
  Wallet,
  FolderKanban,
  ScanLine,
  TrendingUp,
  TrendingDown,
  Minus,
  Timer,
  Hammer,
  Activity,
  LogIn,
  LogOut,
  Coffee,
} from "lucide-react";
import { format, startOfWeek, endOfWeek, subDays, differenceInMinutes } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
}

function fmtJam(mins: number) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m} mnt`;
  if (m === 0) return `${h} jam`;
  return `${h} jam ${m} mnt`;
}

type Period = "today" | "yesterday" | "7d" | "30d";
const PERIOD_LABEL: Record<Period, string> = {
  today: "Hari ini",
  yesterday: "Kemarin",
  "7d": "7 Hari",
  "30d": "30 Hari",
};

function periodRange(p: Period): { from: Date; to: Date; prevFrom: Date; prevTo: Date; label: string } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  if (p === "today") {
    const y = subDays(now, 1);
    return { from: startOfDay(now), to: endOfDay(now), prevFrom: startOfDay(y), prevTo: endOfDay(y), label: "kemarin" };
  }
  if (p === "yesterday") {
    const y = subDays(now, 1);
    const yy = subDays(now, 2);
    return { from: startOfDay(y), to: endOfDay(y), prevFrom: startOfDay(yy), prevTo: endOfDay(yy), label: "2 hari lalu" };
  }
  if (p === "7d") {
    return { from: startOfDay(subDays(now, 6)), to: endOfDay(now), prevFrom: startOfDay(subDays(now, 13)), prevTo: endOfDay(subDays(now, 7)), label: "7 hari sebelumnya" };
  }
  return { from: startOfDay(subDays(now, 29)), to: endOfDay(now), prevFrom: startOfDay(subDays(now, 59)), prevTo: endOfDay(subDays(now, 30)), label: "30 hari sebelumnya" };
}

function pct(curr: number, prev: number): number | null {
  if (prev === 0 && curr === 0) return 0;
  if (prev === 0) return null; // no baseline
  return ((curr - prev) / prev) * 100;
}

function TrendPill({ value, suffix = "vs" }: { value: number | null; suffix?: string }) {
  if (value === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
        <Minus className="h-3 w-3" /> Baru
      </span>
    );
  }
  const up = value > 0.5;
  const down = value < -0.5;
  const cls = up
    ? "bg-emerald-50 text-emerald-700"
    : down
    ? "bg-rose-50 text-rose-700"
    : "bg-slate-100 text-slate-600";
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${cls}`}>
      <Icon className="h-3 w-3" />
      {value > 0 ? "+" : ""}
      {value.toFixed(0)}% {suffix}
    </span>
  );
}

function performanceMessage(empType: "borongan" | "harian" | undefined, deltaPct: number | null): { tone: "good" | "ok" | "low" | "neutral"; text: string } {
  if (deltaPct === null) return { tone: "neutral", text: "Belum ada data pembanding sebelumnya — terus semangat!" };
  if (empType === "borongan") {
    if (deltaPct >= 10) return { tone: "good", text: `Garapan naik ${deltaPct.toFixed(0)}% dibanding sebelumnya. Kerja bagus! 🔥` };
    if (deltaPct <= -10) return { tone: "low", text: `Garapan turun ${Math.abs(deltaPct).toFixed(0)}%. Ayo tingkatkan lagi!` };
    return { tone: "ok", text: "Performa stabil dibanding periode sebelumnya." };
  }
  if (deltaPct >= 10) return { tone: "good", text: `Jam kerja naik ${deltaPct.toFixed(0)}%. Mantap!` };
  if (deltaPct <= -10) return { tone: "low", text: `Jam kerja turun ${Math.abs(deltaPct).toFixed(0)}%. Yuk lebih konsisten.` };
  return { tone: "ok", text: "Jam kerja stabil dibanding periode sebelumnya." };
}

function Dashboard() {
  const { data: me } = useCurrentUser();
  const today = format(new Date(), "yyyy-MM-dd");
  const monthStart = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd");
  const empId = me?.employee?.id;
  const empType = me?.employee?.type as "borongan" | "harian" | undefined;
  const hourlyRate = Number(me?.employee?.hourly_rate ?? 0);
  const dailyWage = Number(me?.employee?.daily_wage ?? 0);
  const payUnit = (me?.employee?.pay_unit as "day" | "hour" | undefined) ?? "day";

  const [period, setPeriod] = useState<Period>("7d");
  const range = useMemo(() => periodRange(period), [period]);

  const { data: attToday } = useQuery({
    enabled: !!empId,
    queryKey: ["att-today", empId, today],
    queryFn: async () => {
      const { data } = await supabase.from("attendances").select("*").eq("employee_id", empId!).eq("date", today).maybeSingle();
      return data;
    },
  });

  // Job logs in period (with rate join) — borongan focus
  const { data: periodLogs } = useQuery({
    enabled: !!empId,
    queryKey: ["period-logs", empId, range.prevFrom.toISOString(), range.to.toISOString()],
    queryFn: async () => {
      const from = format(range.prevFrom, "yyyy-MM-dd");
      const to = format(range.to, "yyyy-MM-dd");
      const { data } = await supabase
        .from("job_logs")
        .select("id,qty,amount,status,log_date,rate:job_rates(id,name,unit,rate_per_unit)")
        .eq("employee_id", empId!)
        .gte("log_date", from)
        .lte("log_date", to);
      return (data ?? []) as Array<{
        id: string;
        qty: number;
        amount: number;
        status: string;
        log_date: string;
        rate: { id: string; name: string; unit: string; rate_per_unit: number } | null;
      }>;
    },
  });

  // Attendances in period + previous (for hours/earnings)
  const { data: periodAtt } = useQuery({
    enabled: !!empId,
    queryKey: ["period-att", empId, range.prevFrom.toISOString(), range.to.toISOString()],
    queryFn: async () => {
      const from = format(range.prevFrom, "yyyy-MM-dd");
      const to = format(range.to, "yyyy-MM-dd");
      const { data } = await supabase
        .from("attendances")
        .select("date,check_in,check_out,status")
        .eq("employee_id", empId!)
        .gte("date", from)
        .lte("date", to);
      return data ?? [];
    },
  });

  // Weekly attendance (Mon-Sun) for harian/borongan weekly performance
  const weekRange = useMemo(() => {
    const now = new Date();
    return {
      from: startOfWeek(now, { weekStartsOn: 1 }),
      to: endOfWeek(now, { weekStartsOn: 1 }),
      prevFrom: startOfWeek(subDays(now, 7), { weekStartsOn: 1 }),
      prevTo: endOfWeek(subDays(now, 7), { weekStartsOn: 1 }),
    };
  }, []);

  const { data: weekAtt } = useQuery({
    enabled: !!empId,
    queryKey: ["week-att", empId, weekRange.prevFrom.toISOString()],
    queryFn: async () => {
      const from = format(weekRange.prevFrom, "yyyy-MM-dd");
      const to = format(weekRange.to, "yyyy-MM-dd");
      const { data } = await supabase
        .from("attendances")
        .select("date,check_in,check_out")
        .eq("employee_id", empId!)
        .gte("date", from)
        .lte("date", to);
      return data ?? [];
    },
  });

  const { data: monthLogs } = useQuery({
    enabled: !!empId,
    queryKey: ["month-logs", empId, monthStart],
    queryFn: async () => {
      const { data } = await supabase.from("job_logs").select("amount,status,log_date")
        .eq("employee_id", empId!).gte("log_date", monthStart);
      return data ?? [];
    },
  });

  const { data: myProjects } = useQuery({
    enabled: !!empId,
    queryKey: ["my-projects", empId],
    queryFn: async () => {
      const { data } = await supabase.from("project_assignments")
        .select("project:projects(id,code,title,status,deadline)").eq("employee_id", empId!);
      return (data ?? []).map((r: { project: unknown }) => r.project).filter(Boolean) as Array<{ id: string; code: string; title: string; status: string; deadline: string | null }>;
    },
  });

  const { data: staffStats } = useQuery({
    enabled: isStaff(me?.role),
    queryKey: ["staff-stats"],
    queryFn: async () => {
      const [p, pending, emps] = await Promise.all([
        supabase.from("projects").select("id,status"),
        supabase.from("job_logs").select("id").eq("status", "pending"),
        supabase.from("employees").select("id").eq("active", true),
      ]);
      return {
        activeProjects: (p.data ?? []).filter((x) => x.status === "active").length,
        totalProjects: (p.data ?? []).length,
        pendingApprovals: (pending.data ?? []).length,
        activeEmployees: (emps.data ?? []).length,
      };
    },
  });

  // === Derived stats ===
  const approvedMonth = (monthLogs ?? []).filter((l) => l.status === "approved").reduce((s, l) => s + Number(l.amount), 0);
  const pendingMonth = (monthLogs ?? []).filter((l) => l.status === "pending").reduce((s, l) => s + Number(l.amount), 0);

  // Split current vs previous from periodLogs
  const fromKey = format(range.from, "yyyy-MM-dd");
  const toKey = format(range.to, "yyyy-MM-dd");
  const prevFromKey = format(range.prevFrom, "yyyy-MM-dd");
  const prevToKey = format(range.prevTo, "yyyy-MM-dd");

  const logsCurr = (periodLogs ?? []).filter((l) => l.log_date >= fromKey && l.log_date <= toKey && l.status !== "rejected");
  const logsPrev = (periodLogs ?? []).filter((l) => l.log_date >= prevFromKey && l.log_date <= prevToKey && l.status !== "rejected");

  // Group current logs by rate
  const rateBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; unit: string; rate: number; qty: number; amount: number; count: number }>();
    for (const l of logsCurr) {
      const key = l.rate?.id ?? "unknown";
      const ex = map.get(key) ?? { name: l.rate?.name ?? "—", unit: l.rate?.unit ?? "titik", rate: Number(l.rate?.rate_per_unit ?? 0), qty: 0, amount: 0, count: 0 };
      ex.qty += Number(l.qty);
      ex.amount += Number(l.amount);
      ex.count += 1;
      map.set(key, ex);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [logsCurr]);

  const totalQtyCurr = logsCurr.reduce((s, l) => s + Number(l.qty), 0);
  const totalQtyPrev = logsPrev.reduce((s, l) => s + Number(l.qty), 0);
  const totalAmountCurr = logsCurr.reduce((s, l) => s + Number(l.amount), 0);
  const totalAmountPrev = logsPrev.reduce((s, l) => s + Number(l.amount), 0);

  // Attendance hours/earnings in period
  const computeAttStats = (atts: Array<{ date: string; check_in: string | null; check_out: string | null }>) => {
    let minutes = 0;
    let days = 0;
    for (const a of atts) {
      if (a.check_in && a.check_out) {
        minutes += Math.max(0, differenceInMinutes(new Date(a.check_out), new Date(a.check_in)));
      }
      if (a.check_in) days += 1;
    }
    const earnings = payUnit === "hour" ? (minutes / 60) * hourlyRate : days * dailyWage;
    return { minutes, days, earnings };
  };
  const attCurr = computeAttStats((periodAtt ?? []).filter((a) => a.date >= fromKey && a.date <= toKey));
  const attPrev = computeAttStats((periodAtt ?? []).filter((a) => a.date >= prevFromKey && a.date <= prevToKey));

  const fromKeyW = format(weekRange.from, "yyyy-MM-dd");
  const toKeyW = format(weekRange.to, "yyyy-MM-dd");
  const prevFromKeyW = format(weekRange.prevFrom, "yyyy-MM-dd");
  const prevToKeyW = format(weekRange.prevTo, "yyyy-MM-dd");
  const weekCurr = computeAttStats((weekAtt ?? []).filter((a) => a.date >= fromKeyW && a.date <= toKeyW));
  const weekPrev = computeAttStats((weekAtt ?? []).filter((a) => a.date >= prevFromKeyW && a.date <= prevToKeyW));

  // Performance message
  const perfDelta = empType === "harian" ? pct(attCurr.minutes, attPrev.minutes) : pct(totalQtyCurr, totalQtyPrev);
  const perfMsg = performanceMessage(empType, perfDelta);
  const weekDelta = empType === "harian" ? pct(weekCurr.minutes, weekPrev.minutes) : pct(weekCurr.minutes, weekPrev.minutes);

  const maxBar = Math.max(...rateBreakdown.map((r) => r.amount), 1);

  const perfToneCls =
    perfMsg.tone === "good"
      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
      : perfMsg.tone === "low"
      ? "bg-rose-50 border-rose-200 text-rose-800"
      : perfMsg.tone === "ok"
      ? "bg-sky-50 border-sky-200 text-sky-800"
      : "bg-slate-50 border-slate-200 text-slate-700";

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Halo, {me?.profile?.full_name || "—"}</h1>
        <p className="text-sm text-slate-500">
          {format(new Date(), "EEEE, dd MMMM yyyy", { locale: idLocale })}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {me?.role === "owner" && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/70 bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-400 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-950 shadow-sm shadow-amber-500/30">
              ★ Owner
            </span>
          )}
          {(me?.role === "owner" || me?.role === "admin") && (
            <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
              Admin
            </span>
          )}
          {empType && (
            <Badge variant="outline" className="capitalize">
              Pekerja {empType}
            </Badge>
          )}
        </div>
      </div>

      {/* Check-in card */}
      <Card className="border-0 shadow-none bg-transparent sm:border sm:shadow-sm sm:bg-card">
        <CardHeader className="pb-3 px-0 sm:px-6">
          <CardTitle className="flex items-center gap-2 text-base"><CalendarCheck className="h-4 w-4" /> Absensi Hari Ini</CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {!empId ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
              Akun Anda belum terhubung ke data karyawan. Minta admin/owner menambahkan Anda di menu <strong>Karyawan</strong> dan menyambungkan ke akun ini.
            </p>
          ) : (() => {
            const att = attToday as {
              check_in: string | null;
              check_out: string | null;
              break_start: string | null;
              break_end: string | null;
            } | null | undefined;
            const ci = att?.check_in ? new Date(att.check_in) : null;
            const co = att?.check_out ? new Date(att.check_out) : null;
            const bs = att?.break_start ? new Date(att.break_start) : null;
            const be = att?.break_end ? new Date(att.break_end) : null;
            // 4 scans done = check_in + break_start + break_end + check_out
            const fullyDone = !!(ci && bs && be && co);
            // Net working duration
            let workMin = 0;
            let isRunning = false;
            if (ci) {
              const end = co ?? new Date();
              workMin = Math.max(0, differenceInMinutes(end, ci));
              if (bs && be) workMin -= Math.max(0, differenceInMinutes(be, bs));
              else if (bs && !be) workMin -= Math.max(0, differenceInMinutes(new Date(), bs));
              isRunning = !co;
            }
            const breakMin = bs && be ? Math.max(0, differenceInMinutes(be, bs)) : bs && !be ? Math.max(0, differenceInMinutes(new Date(), bs)) : 0;
            // Button label by stage
            let btnLabel = "Scan untuk Check-In";
            if (ci && !co && !bs) btnLabel = "Scan Check-Out / Istirahat";
            else if (ci && co && !bs) btnLabel = "Scan Mulai Kerja Lagi";
            else if (ci && bs && be && !co) btnLabel = "Scan Check-Out (Pulang)";

            return (
              <div className="rounded-xl border border-slate-200 bg-white p-2.5 sm:p-4 shadow-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1.5 min-w-0">
                    <LogIn className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-emerald-700/70 leading-none">Check In</p>
                      <p className="text-sm font-bold text-emerald-700 leading-tight">{ci ? format(ci, "HH:mm") : "—"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-1.5 min-w-0">
                    <LogOut className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-rose-700/70 leading-none">Check Out</p>
                      <p className="text-sm font-bold text-rose-700 leading-tight">{co ? format(co, "HH:mm") : "—"}</p>
                    </div>
                  </div>
                  {ci && (
                    <div className="flex items-center gap-1.5 rounded-md bg-indigo-50 px-2 py-1.5 min-w-0 col-span-2">
                      <Timer className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] text-indigo-700/70 leading-none">Durasi Kerja</p>
                        <p className="text-sm font-bold text-indigo-700 leading-tight">
                          {fmtJam(workMin)}{isRunning ? " (berjalan)" : ""}
                        </p>
                      </div>
                    </div>
                  )}
                  {(bs || be) && (
                    <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 min-w-0 col-span-2 border border-amber-100">
                      <Coffee className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                      <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                        <p className="text-[11px] text-amber-700 leading-tight">
                          Istirahat <span className="font-semibold">{bs ? format(bs, "HH:mm") : "—"}</span> – <span className="font-semibold">{be ? format(be, "HH:mm") : "(berjalan)"}</span>
                        </p>
                        <span className="text-[11px] font-bold text-amber-800 bg-amber-100 rounded px-1.5 py-0.5 shrink-0">
                          {breakMin >= 60 ? `${Math.floor(breakMin/60)}j ${breakMin%60}m` : `${breakMin}m`}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-3 pt-3 border-t border-dashed border-slate-200 flex justify-end">
                  {fullyDone ? (
                    <Badge variant="secondary">Selesai hari ini</Badge>
                  ) : (
                    <Button asChild size="lg">
                      <Link to="/me/scan">
                        <ScanLine className="h-4 w-4 mr-2" />
                        {btnLabel}
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Performance banner */}
      {empId && (
        <div className={`border rounded-lg px-4 py-3 flex items-start gap-3 ${perfToneCls}`}>
          <Activity className="h-5 w-5 mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="font-semibold">Performa {PERIOD_LABEL[period].toLowerCase()}</div>
            <div>{perfMsg.text}</div>
          </div>
        </div>
      )}

      {/* Period selector */}
      {empId && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-sm font-semibold text-slate-700">Ringkasan Kinerja</h2>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList>
              <TabsTrigger value="today">Hari ini</TabsTrigger>
              <TabsTrigger value="yesterday">Kemarin</TabsTrigger>
              <TabsTrigger value="7d">7 Hari</TabsTrigger>
              <TabsTrigger value="30d">30 Hari</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* Borongan view */}
      {empId && empType === "borongan" && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Stat
              icon={<Hammer className="h-4 w-4" />}
              label={`Total titik (${PERIOD_LABEL[period]})`}
              value={`${totalQtyCurr.toLocaleString("id-ID")} titik`}
              trend={<TrendPill value={pct(totalQtyCurr, totalQtyPrev)} suffix={range.label} />}
              tint="bg-indigo-50 text-indigo-700"
            />
            <Stat
              icon={<Wallet className="h-4 w-4" />}
              label="Estimasi penghasilan"
              value={fmtIDR(totalAmountCurr)}
              trend={<TrendPill value={pct(totalAmountCurr, totalAmountPrev)} suffix={range.label} />}
              tint="bg-emerald-50 text-emerald-700"
            />
            <Stat
              icon={<Timer className="h-4 w-4" />}
              label="Jam kerja (info)"
              value={fmtJam(attCurr.minutes)}
              sub={`${attCurr.days} hari hadir`}
              tint="bg-sky-50 text-sky-700"
            />
            <Stat
              icon={<ClipboardList className="h-4 w-4" />}
              label="Jumlah laporan"
              value={String(logsCurr.length)}
              sub={`${rateBreakdown.length} jenis garapan`}
              tint="bg-amber-50 text-amber-700"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Hammer className="h-4 w-4" /> Rincian Per Jenis Garapan
              </CardTitle>
            </CardHeader>
            <CardContent>
              {rateBreakdown.length === 0 ? (
                <p className="text-sm text-slate-500">Belum ada garapan pada periode ini.</p>
              ) : (
                <div className="space-y-3">
                  {rateBreakdown.map((r) => (
                    <div key={r.name} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <div>
                          <span className="font-semibold text-slate-800">{r.name}</span>
                          <span className="text-slate-500"> · {r.qty.toLocaleString("id-ID")} {r.unit}</span>
                          <span className="text-xs text-slate-400"> @ {fmtIDR(r.rate)}</span>
                        </div>
                        <div className="font-semibold text-emerald-700">{fmtIDR(r.amount)}</div>
                      </div>
                      <div className="h-2 bg-slate-100 rounded overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded"
                          style={{ width: `${(r.amount / maxBar) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="pt-3 mt-3 border-t flex items-center justify-between text-sm">
                    <span className="font-semibold text-slate-700">Total</span>
                    <span className="font-bold text-emerald-700">{fmtIDR(totalAmountCurr)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Harian view */}
      {empId && empType === "harian" && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Stat
              icon={<Timer className="h-4 w-4" />}
              label={`Total jam kerja (${PERIOD_LABEL[period]})`}
              value={fmtJam(attCurr.minutes)}
              trend={<TrendPill value={pct(attCurr.minutes, attPrev.minutes)} suffix={range.label} />}
              tint="bg-indigo-50 text-indigo-700"
            />
            <Stat
              icon={<Wallet className="h-4 w-4" />}
              label="Estimasi pendapatan"
              value={fmtIDR(attCurr.earnings)}
              trend={<TrendPill value={pct(attCurr.earnings, attPrev.earnings)} suffix={range.label} />}
              sub={payUnit === "hour" ? `Rp ${hourlyRate.toLocaleString("id-ID")}/jam` : `Rp ${dailyWage.toLocaleString("id-ID")}/hari`}
              tint="bg-emerald-50 text-emerald-700"
            />
            <Stat
              icon={<CalendarCheck className="h-4 w-4" />}
              label="Hari hadir"
              value={`${attCurr.days} hari`}
              tint="bg-sky-50 text-sky-700"
            />
            <Stat
              icon={<Activity className="h-4 w-4" />}
              label="Rata-rata jam/hari"
              value={attCurr.days > 0 ? fmtJam(attCurr.minutes / attCurr.days) : "—"}
              tint="bg-amber-50 text-amber-700"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Performa Minggu Ini</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <div className="text-xs text-slate-500">Jam kerja minggu ini</div>
                  <div className="text-xl font-bold">{fmtJam(weekCurr.minutes)}</div>
                  <div className="mt-1"><TrendPill value={weekDelta} suffix="vs minggu lalu" /></div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Estimasi pendapatan</div>
                  <div className="text-xl font-bold text-emerald-700">{fmtIDR(weekCurr.earnings)}</div>
                  <div className="text-xs text-slate-400 mt-1">Minggu lalu: {fmtIDR(weekPrev.earnings)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Hari hadir minggu ini</div>
                  <div className="text-xl font-bold">{weekCurr.days} / 7</div>
                  <div className="text-xs text-slate-400 mt-1">Minggu lalu: {weekPrev.days} hari</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Weekly performance for borongan too (informational) */}
      {empId && empType === "borongan" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Performa Jam Kerja Minggu Ini (Info)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <div className="text-xs text-slate-500">Total jam minggu ini</div>
                <div className="text-xl font-bold">{fmtJam(weekCurr.minutes)}</div>
                <div className="mt-1"><TrendPill value={weekDelta} suffix="vs minggu lalu" /></div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Hari hadir</div>
                <div className="text-xl font-bold">{weekCurr.days} / 7</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Catatan</div>
                <div className="text-sm text-slate-600">Jam kerja tidak mempengaruhi gaji borongan, hanya sebagai info kehadiran.</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly summary */}
      {empId && (
        <div className="grid gap-4 md:grid-cols-3">
          <Stat icon={<Wallet className="h-4 w-4" />} label="Pendapatan disetujui (bulan ini)" value={fmtIDR(approvedMonth)} tint="bg-emerald-50 text-emerald-700" />
          <Stat icon={<ClipboardList className="h-4 w-4" />} label="Menunggu approval" value={fmtIDR(pendingMonth)} tint="bg-amber-50 text-amber-700" />
          <Stat icon={<FolderKanban className="h-4 w-4" />} label="Project saya" value={String(myProjects?.length ?? 0)} tint="bg-sky-50 text-sky-700" />
        </div>
      )}

      {/* My projects */}
      <Card>
        <CardHeader><CardTitle className="text-base">Project Aktif Saya</CardTitle></CardHeader>
        <CardContent>
          {!myProjects?.length ? <p className="text-sm text-slate-500">Belum ada project yang ditugaskan.</p> : (
            <div className="grid gap-2 md:grid-cols-2">
              {myProjects.map((p) => (
                <div key={p.id} className="border rounded-lg p-3 flex items-center gap-3 bg-white">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{p.title}</div>
                    <div className="text-xs text-slate-500">{p.code} · deadline {p.deadline ?? "—"}</div>
                  </div>
                  <Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3"><Link to="/me/jobs" className="text-sm text-primary hover:underline">+ Input laporan garapan</Link></div>
        </CardContent>
      </Card>

      {/* Staff stats */}
      {isStaff(me?.role) && staffStats && (
        <div>
          <h2 className="text-sm font-semibold text-slate-500 mb-3 mt-6">Ringkasan Operasional</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="Project aktif" value={String(staffStats.activeProjects)} sub={`dari ${staffStats.totalProjects} total`} />
            <Stat label="Job log perlu approve" value={String(staffStats.pendingApprovals)} tint="bg-amber-50 text-amber-700" />
            <Stat label="Karyawan aktif" value={String(staffStats.activeEmployees)} />
            <Stat label="Role Anda" value={me!.role} />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  tint,
  trend,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tint?: string;
  trend?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500">{label}</div>
          {icon && <div className={`p-1.5 rounded ${tint ?? "bg-slate-100 text-slate-600"}`}>{icon}</div>}
        </div>
        <div className="text-xl font-bold mt-1 text-slate-900">{value}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
        {trend && <div className="mt-2">{trend}</div>}
      </CardContent>
    </Card>
  );
}
