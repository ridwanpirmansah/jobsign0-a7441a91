import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, startOfDay, endOfDay, subDays, eachDayOfInterval, differenceInCalendarDays } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line,
  LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { TrendingUp, TrendingDown, DollarSign, Wallet, Users, Clock, Sparkles, Award, CalendarRange, ChevronDown } from "lucide-react";
import type { DateRange } from "react-day-picker";

export const Route = createFileRoute("/_authenticated/owner/analytics")({
  component: AnalyticsPage,
});

type Period = "today" | "yesterday" | "7" | "15" | "30" | "60" | "365" | "custom";
const PERIODS: { value: Exclude<Period, "custom">; label: string }[] = [
  { value: "today", label: "Hari Ini" },
  { value: "yesterday", label: "Kemarin" },
  { value: "7", label: "7 Hari" },
  { value: "15", label: "15 Hari" },
  { value: "30", label: "30 Hari" },
  { value: "60", label: "60 Hari" },
  { value: "365", label: "1 Tahun" },
];

const PIE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
}
function fmtShortIDR(n: number) {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}M`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}jt`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}

function presetRange(p: Exclude<Period, "custom">): { from: Date; to: Date } {
  const now = new Date();
  if (p === "today") return { from: startOfDay(now), to: endOfDay(now) };
  if (p === "yesterday") {
    const y = subDays(now, 1);
    return { from: startOfDay(y), to: endOfDay(y) };
  }
  const n = parseInt(p, 10);
  return { from: startOfDay(subDays(now, n - 1)), to: endOfDay(now) };
}

function AnalyticsPage() {
  const { data: me } = useCurrentUser();
  const [period, setPeriod] = useState<Period>("30");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerOpenMobile, setPickerOpenMobile] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const range = useMemo(() => {
    if (period === "custom" && customRange?.from && customRange?.to) {
      const from = startOfDay(customRange.from);
      const to = endOfDay(customRange.to);
      return { from, to, days: differenceInCalendarDays(to, from) + 1 };
    }
    const presetVal = period === "custom" ? "30" : period;
    const r = presetRange(presetVal as Exclude<Period, "custom">);
    return { ...r, days: differenceInCalendarDays(r.to, r.from) + 1 };
  }, [period, customRange]);
  const prevRange = useMemo(() => {
    const len = range.to.getTime() - range.from.getTime();
    return { from: new Date(range.from.getTime() - len - 1), to: new Date(range.from.getTime() - 1) };
  }, [range]);

  const fromStr = format(range.from, "yyyy-MM-dd");
  const toStr = format(range.to, "yyyy-MM-dd");
  const prevFromStr = format(prevRange.from, "yyyy-MM-dd");
  const prevToStr = format(prevRange.to, "yyyy-MM-dd");

  const { data, isLoading } = useQuery({
    enabled: me?.role === "owner",
    queryKey: ["owner-analytics", fromStr, toStr],
    queryFn: async () => {
      const [orders, logs, attendances, employees, prevOrders, prevLogs] = await Promise.all([
        supabase.from("orders")
          .select("co_date,created_at,payment,split,hpp,profit,led_cost,akrilik_cost,solder_cost,tempel_cost,kabel_cost,kabel_socket_cost,adaptor,modul,biaya_lainnya,socket_dc,baut_fischer,outdoor_cost,status")
          .not("status", "in", "(draft,ready_stock)")
          .gte("co_date", fromStr).lte("co_date", toStr),
        supabase.from("job_logs")
          .select("amount,status,log_date,employee_id,employee:employees(full_name,type)")
          .gte("log_date", fromStr).lte("log_date", toStr),
        supabase.from("attendances")
          .select("date,check_in,check_out,employee_id,employee:employees(full_name)")
          .gte("date", fromStr).lte("date", toStr),
        supabase.from("employees").select("id,full_name,type,active").eq("active", true),
        supabase.from("orders").select("payment,hpp,profit,status").neq("status", "draft").gte("co_date", prevFromStr).lte("co_date", prevToStr),
        supabase.from("job_logs").select("amount,status").gte("log_date", prevFromStr).lte("log_date", prevToStr),
      ]);
      return {
        orders: orders.data ?? [],
        logs: logs.data ?? [],
        attendances: attendances.data ?? [],
        employees: employees.data ?? [],
        prevOrders: prevOrders.data ?? [],
        prevLogs: prevLogs.data ?? [],
      };
    },
  });

  if (me && me.role !== "owner") {
    return <p className="p-6 text-sm text-rose-600">Akses ditolak. Halaman ini hanya untuk owner.</p>;
  }

  // KPI
  const omset = (data?.orders ?? []).reduce((s, o) => s + Number(o.payment ?? 0) + Number(o.split ?? 0), 0);
  const hpp = (data?.orders ?? []).reduce((s, o) => s + Number(o.hpp ?? 0), 0);
  const profit = (data?.orders ?? []).reduce((s, o) => s + Number(o.profit ?? 0), 0);
  const tk = (data?.logs ?? []).filter((l) => l.status !== "rejected").reduce((s, l) => s + Number(l.amount ?? 0), 0);
  const margin = profit - tk; // margin bersih setelah tenaga kerja
  const orderCount = (data?.orders ?? []).length;

  // previous-period KPIs
  const prevOmset = (data?.prevOrders ?? []).reduce((s, o) => s + Number(o.payment ?? 0), 0);
  const prevProfit = (data?.prevOrders ?? []).reduce((s, o) => s + Number(o.profit ?? 0), 0);
  const prevTk = (data?.prevLogs ?? []).filter((l) => l.status !== "rejected").reduce((s, l) => s + Number(l.amount ?? 0), 0);

  const pct = (cur: number, prev: number) => {
    if (!prev) return cur ? 100 : 0;
    return ((cur - prev) / prev) * 100;
  };

  // Time series per day
  const days = eachDayOfInterval({ start: range.from, end: range.to });
  const dayKey = (d: Date) => format(d, "yyyy-MM-dd");
  const series = days.map((d) => {
    const k = dayKey(d);
    const dayOrders = (data?.orders ?? []).filter((o) => (o.co_date ?? "").slice(0, 10) === k);
    const dayLogs = (data?.logs ?? []).filter((l) => (l.log_date ?? "").slice(0, 10) === k && l.status !== "rejected");
    const dOmset = dayOrders.reduce((s, o) => s + Number(o.payment ?? 0) + Number(o.split ?? 0), 0);
    const dHpp = dayOrders.reduce((s, o) => s + Number(o.hpp ?? 0), 0);
    const dProfit = dayOrders.reduce((s, o) => s + Number(o.profit ?? 0), 0);
    const dTk = dayLogs.reduce((s, l) => s + Number(l.amount ?? 0), 0);
    return {
      date: k,
      label: format(d, range.days <= 31 ? "d MMM" : "MMM ''yy", { locale: idLocale }),
      omset: dOmset,
      hpp: dHpp,
      profit: dProfit,
      margin: dProfit - dTk,
      tk: dTk,
    };
  });

  // HPP composition
  const compKeys = [
    { k: "led_cost", name: "LED" },
    { k: "akrilik_cost", name: "Akrilik" },
    { k: "solder_cost", name: "Solder" },
    { k: "tempel_cost", name: "Tempel" },
    { k: "kabel_cost", name: "Kabel" },
    { k: "kabel_socket_cost", name: "Kabel Socket" },
    { k: "adaptor", name: "Adaptor" },
    { k: "modul", name: "Modul" },
    { k: "biaya_lainnya", name: "Biaya Lainnya" },
    { k: "socket_dc", name: "Socket DC" },
    { k: "baut_fischer", name: "Baut Fischer" },
    { k: "outdoor_cost", name: "Outdoor" },
  ];
  const composition = compKeys.map(({ k, name }) => ({
    name,
    value: (data?.orders ?? []).reduce((s, o) => s + Number((o as Record<string, unknown>)[k] ?? 0), 0),
  })).filter((c) => c.value > 0).sort((a, b) => b.value - a.value);

  // Employee performance
  const empMap = new Map<string, { name: string; type: string; total: number; jobs: number; days: number; sumCheckInMin: number; cntCheckIn: number; lateCount: number }>();
  (data?.employees ?? []).forEach((e) => {
    empMap.set(e.id, { name: e.full_name, type: e.type, total: 0, jobs: 0, days: 0, sumCheckInMin: 0, cntCheckIn: 0, lateCount: 0 });
  });
  (data?.logs ?? []).filter((l) => l.status !== "rejected").forEach((l) => {
    const cur = empMap.get(l.employee_id) ?? { name: l.employee?.full_name ?? "—", type: l.employee?.type ?? "", total: 0, jobs: 0, days: 0, sumCheckInMin: 0, cntCheckIn: 0, lateCount: 0 };
    cur.total += Number(l.amount ?? 0);
    cur.jobs += 1;
    empMap.set(l.employee_id, cur);
  });
  (data?.attendances ?? []).forEach((a) => {
    const cur = empMap.get(a.employee_id) ?? { name: a.employee?.full_name ?? "—", type: "", total: 0, jobs: 0, days: 0, sumCheckInMin: 0, cntCheckIn: 0, lateCount: 0 };
    cur.days += 1;
    if (a.check_in) {
      // convert to Asia/Jakarta hours
      const d = new Date(a.check_in);
      const jakartaMin = (d.getUTCHours() * 60 + d.getUTCMinutes() + 7 * 60) % (24 * 60);
      cur.sumCheckInMin += jakartaMin;
      cur.cntCheckIn += 1;
      if (jakartaMin > 8 * 60) cur.lateCount += 1; // setelah 08:00
    }
    empMap.set(a.employee_id, cur);
  });
  const empRows = [...empMap.values()]
    .map((e) => ({
      ...e,
      avgCheckIn: e.cntCheckIn ? e.sumCheckInMin / e.cntCheckIn : null,
    }))
    .filter((e) => e.total > 0 || e.days > 0)
    .sort((a, b) => b.total - a.total);

  const topEarner = empRows[0];
  const earliestBird = [...empRows].filter((e) => e.avgCheckIn != null).sort((a, b) => (a.avgCheckIn! - b.avgCheckIn!))[0];

  const fmtMinToTime = (m: number | null) => {
    if (m == null) return "—";
    const h = Math.floor(m / 60); const mm = Math.floor(m % 60);
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-emerald-600" />
          Analitik Keuangan & Performa
        </h1>
        <p className="text-sm text-slate-500">Ringkasan omset, margin, biaya tenaga kerja, dan performa karyawan.</p>
      </div>

      {/* Period selector — soft gradient card */}
      <Card className="border-0 shadow-sm overflow-hidden bg-gradient-to-br from-emerald-50 via-sky-50 to-violet-50">
        <CardContent className="p-4 sm:p-5 space-y-3">
          {/* Desktop / Tablet layout (sm and up) */}
          <div className="hidden sm:flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-9 w-9 shrink-0 rounded-xl bg-white/70 backdrop-blur flex items-center justify-center shadow-sm">
                <CalendarRange className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Periode</div>
                <div className="text-sm font-semibold text-slate-800 truncate">
                  {format(range.from, "d MMM yyyy", { locale: idLocale })} – {format(range.to, "d MMM yyyy", { locale: idLocale })}
                  <span className="ml-2 text-xs font-normal text-slate-500">({range.days} hari)</span>
                </div>
              </div>
            </div>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant={period === "custom" ? "default" : "outline"}
                  className={period === "custom"
                    ? "bg-gradient-to-r from-emerald-500 to-sky-500 text-white border-0 shadow-sm hover:opacity-90"
                    : "bg-white/80 backdrop-blur border-slate-200 text-slate-700 hover:bg-white"}
                >
                  <CalendarRange className="h-3.5 w-3.5 mr-1.5" />
                  Custom
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 pointer-events-auto" align="end">
                <Calendar
                  mode="range"
                  selected={customRange}
                  onSelect={(r) => {
                    setCustomRange(r);
                    if (r?.from && r?.to) {
                      setPeriod("custom");
                      setPickerOpen(false);
                    }
                  }}
                  numberOfMonths={2}
                  locale={idLocale}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="hidden sm:flex flex-wrap gap-1.5">
            {PERIODS.map((p) => {
              const active = period === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPeriod(p.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    active
                      ? "bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-200"
                      : "bg-white/50 text-slate-600 hover:bg-white/80"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Mobile layout (below sm) */}
          <div className="sm:hidden flex items-center gap-3">
            <Popover open={pickerOpenMobile} onOpenChange={setPickerOpenMobile}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Pilih rentang tanggal custom"
                  className={`h-10 w-10 shrink-0 rounded-xl bg-white/70 backdrop-blur flex items-center justify-center shadow-sm transition-all active:scale-95 ${
                    period === "custom" ? "ring-2 ring-emerald-400 bg-white" : ""
                  }`}
                >
                  <CalendarRange className="h-5 w-5 text-emerald-600" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-fit max-w-[calc(100vw-1rem)] overflow-hidden p-0 pointer-events-auto" align="start" sideOffset={8}>
                <Calendar
                  className="max-sm:[--cell-size:calc((100vw-2.5rem)/7)] max-sm:p-2 max-sm:text-xs"
                  mode="range"
                  selected={customRange}
                  onSelect={(r) => {
                    setCustomRange(r);
                    if (r?.from && r?.to) {
                      setPeriod("custom");
                      setPickerOpenMobile(false);
                    }
                  }}
                  numberOfMonths={1}
                  locale={idLocale}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Periode</div>
              <div className="text-sm font-semibold text-slate-800 truncate">
                {format(range.from, "d MMM yyyy", { locale: idLocale })} – {format(range.to, "d MMM yyyy", { locale: idLocale })}
                <span className="ml-1.5 text-xs font-normal text-slate-500">({range.days} h)</span>
              </div>
            </div>
          </div>
          <div className="sm:hidden flex flex-wrap gap-1.5">
            {PERIODS.slice(0, 3).map((p) => {
              const active = period === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => { setPeriod(p.value); setShowMore(false); }}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    active
                      ? "bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-200"
                      : "bg-white/50 text-slate-600 hover:bg-white/80"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setShowMore((s) => !s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1 ${
                showMore
                  ? "bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-200"
                  : "bg-white/50 text-slate-600 hover:bg-white/80"
              }`}
            >
              Lainnya
              <ChevronDown className={`h-3 w-3 transition-transform ${showMore ? "rotate-180" : ""}`} />
            </button>
          </div>
          {showMore && (
            <div className="sm:hidden flex flex-wrap gap-1.5 pt-1 border-t border-white/40">
              {PERIODS.slice(3).map((p) => {
                const active = period === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPeriod(p.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                      active
                        ? "bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-200"
                        : "bg-white/50 text-slate-600 hover:bg-white/80"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>


      {isLoading && <p className="text-sm text-slate-500">Memuat data…</p>}

      {/* KPI */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Omset" value={omset} delta={pct(omset, prevOmset)} icon={DollarSign} color="emerald" subtitle={`${orderCount} order`} />
        <KpiCard title="Profit Kotor" value={profit} delta={pct(profit, prevProfit)} icon={TrendingUp} color="sky" subtitle={`Margin ${omset ? Math.round((profit / omset) * 100) : 0}%`} />
        <KpiCard title="Biaya Tenaga Kerja" value={tk} delta={pct(tk, prevTk)} icon={Wallet} color="amber" inverse subtitle="Garapan disetujui & pending" />
        <KpiCard title="Margin Bersih" value={margin} delta={pct(margin, prevProfit - prevTk)} icon={Award} color="violet" subtitle="Profit − Tenaga Kerja" />
      </div>

      {/* Main chart: omset / hpp / margin */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tren Omset, HPP & Margin</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full">
            <ResponsiveContainer>
              <AreaChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gOmset" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gMargin" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtShortIDR} />
                <Tooltip formatter={(v: number) => fmtIDR(v)} labelClassName="text-xs" />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="omset" name="Omset" stroke="#10b981" fill="url(#gOmset)" strokeWidth={2} />
                <Area type="monotone" dataKey="margin" name="Margin Bersih" stroke="#8b5cf6" fill="url(#gMargin)" strokeWidth={2} />
                <Line type="monotone" dataKey="hpp" name="HPP" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Biaya Tenaga Kerja per Hari</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer>
                <BarChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtShortIDR} />
                  <Tooltip formatter={(v: number) => fmtIDR(v)} />
                  <Bar dataKey="tk" name="Biaya TK" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Komposisi HPP</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={composition} dataKey="value" nameKey="name" outerRadius={90} innerRadius={45} paddingAngle={2}>
                    {composition.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtIDR(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {!composition.length && <p className="text-xs text-slate-400 text-center -mt-6">Belum ada data biaya</p>}
          </CardContent>
        </Card>
      </div>

      {/* Performance highlights */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-emerald-100 flex items-center justify-center">
              <Award className="h-6 w-6 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-emerald-700">Top Earner</div>
              <div className="text-lg font-bold text-slate-900 truncate">{topEarner?.name ?? "—"}</div>
              <div className="text-sm text-slate-600">{topEarner ? fmtIDR(topEarner.total) : "Belum ada data"}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-sky-200 bg-gradient-to-br from-sky-50 to-white">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-sky-100 flex items-center justify-center">
              <Clock className="h-6 w-6 text-sky-600" />
            </div>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-sky-700">Pagi Hari Juara</div>
              <div className="text-lg font-bold text-slate-900 truncate">{earliestBird?.name ?? "—"}</div>
              <div className="text-sm text-slate-600">Rata-rata check-in {fmtMinToTime(earliestBird?.avgCheckIn ?? null)}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Employee bar chart + table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Performa Karyawan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 w-full">
            <ResponsiveContainer>
              <BarChart data={empRows.slice(0, 12)} margin={{ top: 8, right: 12, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" interval={0} height={48} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtShortIDR} />
                <Tooltip formatter={(v: number) => fmtIDR(v)} />
                <Bar dataKey="total" name="Total Garapan" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500 border-b">
                  <th className="py-2 px-3">Karyawan</th>
                  <th className="py-2 px-3">Tipe</th>
                  <th className="py-2 px-3 text-right">Total Garapan</th>
                  <th className="py-2 px-3 text-right">Jumlah Log</th>
                  <th className="py-2 px-3 text-right">Kehadiran</th>
                  <th className="py-2 px-3 text-right">Avg Check-in</th>
                  <th className="py-2 px-3 text-right">Terlambat</th>
                </tr>
              </thead>
              <tbody>
                {empRows.map((e, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="py-2 px-3 font-medium text-slate-800">{e.name}</td>
                    <td className="py-2 px-3"><Badge variant="outline" className="capitalize">{e.type || "—"}</Badge></td>
                    <td className="py-2 px-3 text-right font-semibold text-emerald-700">{fmtIDR(e.total)}</td>
                    <td className="py-2 px-3 text-right">{e.jobs}</td>
                    <td className="py-2 px-3 text-right">{e.days} hari</td>
                    <td className="py-2 px-3 text-right font-mono">{fmtMinToTime(e.avgCheckIn)}</td>
                    <td className="py-2 px-3 text-right">
                      {e.lateCount > 0
                        ? <span className="text-rose-600 font-medium">{e.lateCount}×</span>
                        : <span className="text-slate-400">0</span>}
                    </td>
                  </tr>
                ))}
                {!empRows.length && (
                  <tr><td colSpan={7} className="text-center py-6 text-slate-500">Belum ada data pada periode ini</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-3">Catatan: Terlambat dihitung jika check-in setelah 08:00 WIB.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  title, value, delta, icon: Icon, color, subtitle, inverse,
}: {
  title: string; value: number; delta: number; subtitle?: string; inverse?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  color: "emerald" | "sky" | "amber" | "violet";
}) {
  const palette = {
    emerald: { bg: "bg-emerald-50", text: "text-emerald-700", icon: "bg-emerald-100 text-emerald-600" },
    sky: { bg: "bg-sky-50", text: "text-sky-700", icon: "bg-sky-100 text-sky-600" },
    amber: { bg: "bg-amber-50", text: "text-amber-700", icon: "bg-amber-100 text-amber-600" },
    violet: { bg: "bg-violet-50", text: "text-violet-700", icon: "bg-violet-100 text-violet-600" },
  }[color];
  const good = inverse ? delta <= 0 : delta >= 0;
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-slate-500">{title}</div>
            <div className="text-2xl font-bold text-slate-900 mt-1 truncate">{fmtIDR(value)}</div>
            {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
          </div>
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${palette.icon}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className={`mt-3 inline-flex items-center gap-1 text-xs font-medium ${good ? "text-emerald-600" : "text-rose-600"}`}>
          {good ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {delta > 0 ? "+" : ""}{delta.toFixed(1)}% vs periode sebelumnya
        </div>
      </CardContent>
    </Card>
  );
}
