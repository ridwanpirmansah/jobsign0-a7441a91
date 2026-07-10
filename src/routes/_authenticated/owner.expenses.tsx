import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Area, AreaChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
  Bar, BarChart,
} from "recharts";
import {
  format, startOfDay, endOfDay, subDays, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, startOfYear, endOfYear,
  eachDayOfInterval, eachMonthOfInterval, differenceInCalendarDays,
} from "date-fns";
import { id as idLocale } from "date-fns/locale";
import {
  CalendarRange, ChevronDown, Plus, Pencil, Trash2, Wallet, TrendingDown, Tag,
  Megaphone, Package2, Boxes, Wrench, Banknote, Zap, Car, MoreHorizontal, Receipt,
  Archive,
} from "lucide-react";
import type { DateRange } from "react-day-picker";

export const Route = createFileRoute("/_authenticated/owner/expenses")({
  component: ExpensesPage,
});

type Period = "today" | "yesterday" | "7" | "30" | "thisWeek" | "thisMonth" | "thisYear" | "custom";
const PERIODS: { value: Exclude<Period, "custom">; label: string }[] = [
  { value: "today", label: "Hari Ini" },
  { value: "yesterday", label: "Kemarin" },
  { value: "7", label: "7 Hari" },
  { value: "thisWeek", label: "Minggu Ini" },
  { value: "30", label: "30 Hari" },
  { value: "thisMonth", label: "Bulan Ini" },
  { value: "thisYear", label: "Tahun Ini" },
];

type Category =
  | "iklan" | "bahan_pokok" | "bahan_penunjang" | "operasional"
  | "gaji" | "utilitas" | "transportasi" | "packing" | "lainnya";

const CATEGORIES: { value: Category; label: string; color: string; icon: any; affectsPnl: boolean }[] = [
  { value: "iklan",           label: "Iklan & Marketing", color: "#ec4899", icon: Megaphone,    affectsPnl: true },
  { value: "bahan_pokok",     label: "Bahan Pokok (HPP)", color: "#6366f1", icon: Package2,     affectsPnl: false },
  { value: "bahan_penunjang", label: "Bahan Penunjang",   color: "#06b6d4", icon: Boxes,        affectsPnl: true },
  { value: "operasional",     label: "Operasional",       color: "#f59e0b", icon: Wrench,       affectsPnl: true },
  { value: "gaji",            label: "Gaji & Upah",       color: "#10b981", icon: Banknote,     affectsPnl: true },
  { value: "utilitas",        label: "Listrik / Air / Internet", color: "#8b5cf6", icon: Zap, affectsPnl: true },
  { value: "transportasi",    label: "Transportasi",      color: "#ef4444", icon: Car,          affectsPnl: true },
  { value: "packing",         label: "Packing",            color: "#d97706", icon: Archive,      affectsPnl: true },
  { value: "lainnya",         label: "Lainnya",           color: "#64748b", icon: MoreHorizontal, affectsPnl: true },
];
const catMap = Object.fromEntries(CATEGORIES.map((c) => [c.value, c])) as Record<Category, typeof CATEGORIES[number]>;

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
  if (p === "thisWeek") return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
  if (p === "thisMonth") return { from: startOfMonth(now), to: endOfMonth(now) };
  if (p === "thisYear") return { from: startOfYear(now), to: endOfYear(now) };
  const n = parseInt(p, 10);
  return { from: startOfDay(subDays(now, n - 1)), to: endOfDay(now) };
}

type PaymentStatus = "lunas" | "hutang";
type ExpenseRow = {
  id: string;
  expense_date: string;
  category: Category;
  amount: number;
  description: string;
  vendor: string | null;
  note: string | null;
  affects_pnl: boolean;
  payment_status: PaymentStatus;
  created_at: string;
};

function ExpensesPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<Period>("thisMonth");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerOpenMobile, setPickerOpenMobile] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [catFilter, setCatFilter] = useState<Category | "all">("all");
  const [payFilter, setPayFilter] = useState<"all" | "hutang" | "lunas">("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);

  const range = useMemo(() => {
    if (period === "custom" && customRange?.from && customRange?.to) {
      const from = startOfDay(customRange.from);
      const to = endOfDay(customRange.to);
      return { from, to, days: differenceInCalendarDays(to, from) + 1 };
    }
    const presetVal = period === "custom" ? "thisMonth" : period;
    const r = presetRange(presetVal as Exclude<Period, "custom">);
    return { ...r, days: differenceInCalendarDays(r.to, r.from) + 1 };
  }, [period, customRange]);

  const fromStr = format(range.from, "yyyy-MM-dd");
  const toStr = format(range.to, "yyyy-MM-dd");

  const { data, isLoading } = useQuery({
    enabled: !!me && isStaff(me.role),
    queryKey: ["expenses", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("id,expense_date,category,amount,description,vendor,note,affects_pnl,payment_status,created_at")
        .gte("expense_date", fromStr)
        .lte("expense_date", toStr)
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ExpenseRow[];
    },
  });

  const rows = data ?? [];
  const filtered = rows.filter((r) => {
    if (catFilter !== "all" && r.category !== catFilter) return false;
    if (payFilter === "hutang" && r.payment_status !== "hutang") return false;
    if (payFilter === "lunas" && r.payment_status !== "lunas") return false;
    return true;
  });


  // KPI
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const pnlTotal = rows.filter((r) => r.affects_pnl).reduce((s, r) => s + Number(r.amount), 0);
  const hppTotal = total - pnlTotal;
  const avgDaily = range.days > 0 ? total / range.days : 0;

  // by category
  const byCategory = useMemo(() => {
    const map = new Map<Category, number>();
    for (const r of rows) map.set(r.category, (map.get(r.category) ?? 0) + Number(r.amount));
    return CATEGORIES
      .map((c) => ({ name: c.label, value: map.get(c.value) ?? 0, color: c.color, key: c.value }))
      .filter((c) => c.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  // time series — daily if <=62 days, else monthly
  const series = useMemo(() => {
    const useDaily = range.days <= 62;
    if (useDaily) {
      const days = eachDayOfInterval({ start: range.from, end: range.to });
      const map = new Map<string, number>();
      for (const r of rows) {
        if (!r.affects_pnl) continue;
        map.set(r.expense_date, (map.get(r.expense_date) ?? 0) + Number(r.amount));
      }
      return days.map((d) => {
        const k = format(d, "yyyy-MM-dd");
        return { label: format(d, "d MMM", { locale: idLocale }), value: map.get(k) ?? 0 };
      });
    }
    const months = eachMonthOfInterval({ start: range.from, end: range.to });
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.affects_pnl) continue;
      const k = r.expense_date.slice(0, 7);
      map.set(k, (map.get(k) ?? 0) + Number(r.amount));
    }
    return months.map((d) => {
      const k = format(d, "yyyy-MM");
      return { label: format(d, "MMM yy", { locale: idLocale }), value: map.get(k) ?? 0 };
    });
  }, [rows, range]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("expenses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pengeluaran dihapus");
      qc.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Gagal menghapus"),
  });

  const togglePayMutation = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: PaymentStatus }) => {
      const { error } = await supabase.from("expenses").update({ payment_status: next }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.next === "lunas" ? "Ditandai Lunas" : "Ditandai Hutang");
      qc.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Gagal memperbarui status"),
  });

  const unpaidTotal = rows.filter((r) => r.payment_status === "hutang").reduce((s, r) => s + Number(r.amount), 0);
  const unpaidCount = rows.filter((r) => r.payment_status === "hutang").length;


  if (me && !isStaff(me.role)) {
    return <p className="p-6 text-sm text-rose-600">Akses ditolak. Halaman ini hanya untuk admin/owner.</p>;
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Receipt className="h-6 w-6 text-rose-500" />
            Catatan Pengeluaran
          </h1>
          <p className="text-sm text-slate-500">Pantau biaya iklan, bahan, operasional, dan pengeluaran usaha lainnya.</p>
        </div>
        <Button
          onClick={() => { setEditing(null); setDialogOpen(true); }}
          className="bg-gradient-to-r from-rose-500 to-amber-500 text-white border-0 shadow-sm hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Tambah Pengeluaran
        </Button>
      </div>

      {/* Period card */}
      <Card className="border-0 shadow-sm overflow-hidden bg-gradient-to-br from-rose-50 via-amber-50 to-emerald-50">
        <CardContent className="p-4 sm:p-5 space-y-3">
          {/* Desktop */}
          <div className="hidden sm:flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-9 w-9 shrink-0 rounded-xl bg-white/70 backdrop-blur flex items-center justify-center shadow-sm">
                <CalendarRange className="h-4 w-4 text-rose-500" />
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
                    ? "bg-gradient-to-r from-rose-500 to-amber-500 text-white border-0 shadow-sm hover:opacity-90"
                    : "bg-white/80 backdrop-blur border-slate-200 text-slate-700 hover:bg-white"}
                >
                  <CalendarRange className="h-3.5 w-3.5 mr-1.5" /> Custom
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 pointer-events-auto" align="end">
                <Calendar
                  mode="range"
                  selected={customRange}
                  onSelect={(r) => {
                    setCustomRange(r);
                    if (r?.from && r?.to) { setPeriod("custom"); setPickerOpen(false); }
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
                  key={p.value} type="button" onClick={() => setPeriod(p.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    active ? "bg-white text-rose-700 shadow-sm ring-1 ring-rose-200" : "bg-white/50 text-slate-600 hover:bg-white/80"
                  }`}
                >{p.label}</button>
              );
            })}
          </div>

          {/* Mobile */}
          <div className="sm:hidden flex items-center gap-3">
            <Popover open={pickerOpenMobile} onOpenChange={setPickerOpenMobile}>
              <PopoverTrigger asChild>
                <button
                  type="button" aria-label="Pilih rentang tanggal custom"
                  className={`h-10 w-10 shrink-0 rounded-xl bg-white/70 backdrop-blur flex items-center justify-center shadow-sm transition-all active:scale-95 ${
                    period === "custom" ? "ring-2 ring-rose-400 bg-white" : ""
                  }`}
                >
                  <CalendarRange className="h-5 w-5 text-rose-500" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-fit max-w-[calc(100vw-1rem)] overflow-hidden p-0 pointer-events-auto" align="start" sideOffset={8}>
                <Calendar
                  className="max-sm:[--cell-size:calc((100vw-2.5rem)/7)] max-sm:p-2 max-sm:text-xs"
                  mode="range"
                  selected={customRange}
                  onSelect={(r) => {
                    setCustomRange(r);
                    if (r?.from && r?.to) { setPeriod("custom"); setPickerOpenMobile(false); }
                  }}
                  numberOfMonths={1} locale={idLocale} initialFocus
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
                  key={p.value} type="button" onClick={() => { setPeriod(p.value); setShowMore(false); }}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    active ? "bg-white text-rose-700 shadow-sm ring-1 ring-rose-200" : "bg-white/50 text-slate-600 hover:bg-white/80"
                  }`}
                >{p.label}</button>
              );
            })}
            <button
              type="button" onClick={() => setShowMore((s) => !s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1 ${
                showMore ? "bg-white text-rose-700 shadow-sm ring-1 ring-rose-200" : "bg-white/50 text-slate-600 hover:bg-white/80"
              }`}
            >Lainnya <ChevronDown className={`h-3 w-3 transition-transform ${showMore ? "rotate-180" : ""}`} /></button>
          </div>
          {showMore && (
            <div className="sm:hidden flex flex-wrap gap-1.5 pt-1 border-t border-white/40">
              {PERIODS.slice(3).map((p) => {
                const active = period === p.value;
                return (
                  <button
                    key={p.value} type="button" onClick={() => setPeriod(p.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                      active ? "bg-white text-rose-700 shadow-sm ring-1 ring-rose-200" : "bg-white/50 text-slate-600 hover:bg-white/80"
                    }`}
                  >{p.label}</button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label="Total Pengeluaran" value={fmtIDR(total)} hint={`${rows.length} transaksi`} tone="rose" icon={<Wallet className="h-4 w-4" />} />
        <KpiCard label="Beban Usaha (P&L)" value={fmtIDR(pnlTotal)} hint="Masuk laporan laba/rugi" tone="amber" icon={<TrendingDown className="h-4 w-4" />} />
        <KpiCard label="Belanja Bahan Pokok" value={fmtIDR(hppTotal)} hint="Sudah dihitung di HPP" tone="indigo" icon={<Package2 className="h-4 w-4" />} />
        <KpiCard label="Rata-rata / Hari" value={fmtIDR(avgDaily)} hint={`Periode ${range.days} hari`} tone="emerald" icon={<Banknote className="h-4 w-4" />} />
        <KpiCard
          label="Belum Dibayar"
          value={fmtIDR(unpaidTotal)}
          hint={payFilter === "hutang" ? "Klik lagi untuk reset filter" : `${unpaidCount} transaksi · klik untuk filter`}
          tone="orange"
          icon={<Wallet className="h-4 w-4" />}
          active={payFilter === "hutang"}
          onClick={() => setPayFilter((p) => (p === "hutang" ? "all" : "hutang"))}
        />
      </div>



      {isLoading && <p className="text-sm text-slate-500">Memuat data…</p>}

      {/* Charts */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tren Beban Usaha</CardTitle>
            <p className="text-xs text-slate-500">Hanya kategori yang masuk laporan usaha (mengecualikan Bahan Pokok).</p>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series}>
                  <defs>
                    <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtShortIDR} width={48} />
                  <Tooltip formatter={(v: number) => fmtIDR(v)} />
                  <Area type="monotone" dataKey="value" stroke="#f43f5e" strokeWidth={2} fill="url(#expGrad)" name="Beban" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Komposisi Kategori</CardTitle>
            <p className="text-xs text-slate-500">Distribusi pengeluaran berdasarkan kategori.</p>
          </CardHeader>
          <CardContent>
            {byCategory.length === 0 ? (
              <p className="text-sm text-slate-400 py-12 text-center">Belum ada pengeluaran.</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                      {byCategory.map((c) => <Cell key={c.key} fill={c.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmtIDR(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-2 space-y-1">
              {byCategory.map((c) => (
                <div key={c.key} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: c.color }} />
                    <span className="text-slate-600 truncate">{c.name}</span>
                  </div>
                  <span className="font-semibold text-slate-800">{fmtIDR(c.value)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bar chart per category */}
      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Total per Kategori</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCategory} layout="vertical" margin={{ left: 16, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtShortIDR} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                <Tooltip formatter={(v: number) => fmtIDR(v)} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {byCategory.map((c) => <Cell key={c.key} fill={c.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* List + filter */}
      <Card className="border-slate-200">
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <Tag className="h-4 w-4 text-slate-500" />
            <span>Riwayat Pengeluaran{payFilter === "hutang" ? " — Belum Dibayar" : payFilter === "lunas" ? " — Sudah Lunas" : ""}</span>
            {(payFilter !== "all" || catFilter !== "all") && (
              <button
                type="button"
                onClick={() => { setPayFilter("all"); setCatFilter("all"); }}
                className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
              >
                × reset filter
              </button>
            )}
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={payFilter} onValueChange={(v) => setPayFilter(v as any)}>
              <SelectTrigger className="w-[170px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="hutang">● Belum Dibayar</SelectItem>
                <SelectItem value="lunas">● Sudah Lunas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={catFilter} onValueChange={(v) => setCatFilter(v as any)}>
              <SelectTrigger className="w-[200px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Kategori</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">
              {payFilter === "hutang" ? "Tidak ada pengeluaran hutang pada periode ini." : "Tidak ada pengeluaran pada periode ini."}
            </p>
          ) : (

            <div className="space-y-2">
              {filtered.map((r) => {
                const c = catMap[r.category];
                const Icon = c.icon;
                return (
                  <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors">
                    <div
                      className="h-10 w-10 shrink-0 rounded-lg flex items-center justify-center"
                      style={{ background: `${c.color}1a`, color: c.color }}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-800 truncate">{r.description}</span>
                        <Badge variant="secondary" className="text-[10px]" style={{ background: `${c.color}1a`, color: c.color }}>
                          {c.label}
                        </Badge>
                        {!r.affects_pnl && (
                          <Badge variant="outline" className="text-[10px] text-indigo-600 border-indigo-200">HPP</Badge>
                        )}
                        {r.payment_status === "lunas" ? (
                          <Badge className="text-[10px] bg-emerald-100 text-emerald-700 border-0 hover:bg-emerald-100">✓ Lunas</Badge>
                        ) : (
                          <Badge className="text-[10px] bg-orange-100 text-orange-700 border-0 hover:bg-orange-100">● Hutang</Badge>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap mt-0.5">
                        <span>{format(new Date(r.expense_date), "EEE, d MMM yyyy", { locale: idLocale })}</span>
                        {r.vendor && <span>• {r.vendor}</span>}
                        {r.note && <span className="truncate">• {r.note}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-slate-900">{fmtIDR(Number(r.amount))}</div>
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <Button
                          size="sm" variant="ghost"
                          className={`h-7 px-2 text-[10px] font-semibold ${r.payment_status === "lunas" ? "text-orange-600 hover:text-orange-700 hover:bg-orange-50" : "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"}`}
                          disabled={togglePayMutation.isPending}
                          onClick={() => togglePayMutation.mutate({ id: r.id, next: r.payment_status === "lunas" ? "hutang" : "lunas" })}
                        >
                          {r.payment_status === "lunas" ? "→ Hutang" : "→ Lunas"}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditing(r); setDialogOpen(true); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-600 hover:text-rose-700"
                          onClick={() => { if (confirm("Hapus pengeluaran ini?")) deleteMutation.mutate(r.id); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => qc.invalidateQueries({ queryKey: ["expenses"] })}
      />
    </div>
  );
}

function KpiCard({ label, value, hint, tone, icon, active, onClick }: { label: string; value: string; hint?: string; tone: "rose"|"amber"|"indigo"|"emerald"|"orange"; icon: React.ReactNode; active?: boolean; onClick?: () => void }) {
  const tones: Record<string, string> = {
    rose: "from-rose-50 to-rose-100 text-rose-700",
    amber: "from-amber-50 to-amber-100 text-amber-700",
    indigo: "from-indigo-50 to-indigo-100 text-indigo-700",
    emerald: "from-emerald-50 to-emerald-100 text-emerald-700",
    orange: "from-orange-50 to-orange-100 text-orange-700",
  };
  const ringMap: Record<string, string> = { orange: "ring-2 ring-orange-400" };
  const interactive = !!onClick;
  return (
    <Card
      className={`border-0 shadow-sm bg-gradient-to-br ${tones[tone]} ${interactive ? "cursor-pointer transition-all hover:shadow-md active:scale-[0.98]" : ""} ${active ? (ringMap[tone] ?? "ring-2 ring-slate-400") : ""}`}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wide font-semibold opacity-80">{label}</div>
          <div className="opacity-70">{icon}</div>
        </div>
        <div className="text-lg font-bold mt-1.5 text-slate-900">{value}</div>
        {hint && <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}


function ExpenseDialog({
  open, onOpenChange, editing, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: ExpenseRow | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    expense_date: format(new Date(), "yyyy-MM-dd"),
    category: "iklan" as Category,
    amount: "",
    description: "",
    vendor: "",
    note: "",
    affects_pnl: true,
    payment_status: "lunas" as PaymentStatus,
  });
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // sync editing → form when dialog opens
  useMemo(() => {
    if (open) {
      if (editing) {
        setForm({
          expense_date: editing.expense_date,
          category: editing.category,
          amount: String(editing.amount),
          description: editing.description,
          vendor: editing.vendor ?? "",
          note: editing.note ?? "",
          affects_pnl: editing.affects_pnl,
          payment_status: editing.payment_status ?? "lunas",
        });
      } else {
        setForm({
          expense_date: format(new Date(), "yyyy-MM-dd"),
          category: "iklan", amount: "", description: "", vendor: "", note: "",
          affects_pnl: true, payment_status: "lunas",
        });
      }
    }
  }, [open, editing]);

  const mutation = useMutation({
    mutationFn: async () => {
      const amt = Number(form.amount);
      if (!Number.isFinite(amt) || amt < 0) throw new Error("Nominal tidak valid");
      if (!form.description.trim()) throw new Error("Deskripsi wajib diisi");
      const payload = {
        expense_date: form.expense_date,
        category: form.category,
        amount: amt,
        description: form.description.trim(),
        vendor: form.vendor.trim() || null,
        note: form.note.trim() || null,
        affects_pnl: form.affects_pnl,
        payment_status: form.payment_status,
      };
      if (editing) {
        const { error } = await supabase.from("expenses").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("expenses").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Pengeluaran diperbarui" : "Pengeluaran ditambahkan");
      onSaved();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Gagal menyimpan"),
  });

  const onCatChange = (v: Category) => {
    setForm((f) => ({ ...f, category: v, affects_pnl: catMap[v].affectsPnl }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Pengeluaran" : "Tambah Pengeluaran"}</DialogTitle>
          <DialogDescription>
            Catat biaya iklan, bahan, atau pengeluaran usaha lainnya.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tanggal</Label>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-start font-normal mt-1">
                    <CalendarRange className="h-3.5 w-3.5 mr-1.5" />
                    {format(new Date(form.expense_date), "d MMM yyyy", { locale: idLocale })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
                  <Calendar
                    mode="single"
                    selected={new Date(form.expense_date)}
                    onSelect={(d) => {
                      if (d) { setForm((f) => ({ ...f, expense_date: format(d, "yyyy-MM-dd") })); setDatePickerOpen(false); }
                    }}
                    locale={idLocale}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label className="text-xs">Kategori</Label>
              <Select value={form.category} onValueChange={(v) => onCatChange(v as Category)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Deskripsi</Label>
            <Input
              className="mt-1"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Cth: Iklan Meta Ads minggu 1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Nominal (Rp)</Label>
              <Input
                type="number" min={0} className="mt-1"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div>
              <Label className="text-xs">Vendor / Toko (opsional)</Label>
              <Input
                className="mt-1"
                value={form.vendor}
                onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
                placeholder="Cth: Tokopedia"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Catatan (opsional)</Label>
            <Textarea
              className="mt-1 min-h-[64px]"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Detail tambahan..."
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 bg-slate-50">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-800">Status Pembayaran</div>
              <div className="text-[11px] text-slate-500">
                Tandai apakah pengeluaran ini sudah dibayar atau masih hutang.
              </div>
            </div>
            <div className="flex rounded-md border border-slate-200 overflow-hidden bg-white shrink-0">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, payment_status: "lunas" }))}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${form.payment_status === "lunas" ? "bg-emerald-500 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >Lunas</button>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, payment_status: "hutang" }))}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${form.payment_status === "hutang" ? "bg-orange-500 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >Hutang</button>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 bg-slate-50">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-800">Masuk Laporan Laba/Rugi</div>
              <div className="text-[11px] text-slate-500">
                Matikan jika sudah dihitung di HPP (mis. bahan pokok).
              </div>
            </div>
            <Switch checked={form.affects_pnl} onCheckedChange={(v) => setForm((f) => ({ ...f, affects_pnl: v }))} />
          </div>

        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="bg-gradient-to-r from-rose-500 to-amber-500 text-white border-0"
          >
            {mutation.isPending ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
