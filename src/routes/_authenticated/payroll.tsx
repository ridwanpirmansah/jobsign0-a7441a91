import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format, startOfWeek, endOfWeek, addWeeks, differenceInCalendarDays, isSameDay } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { ChevronLeft, ChevronRight, CalendarRange } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/payroll")({ component: PayrollPage });

function fmtIDR(n: number) { return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0); }

const weekStart = (d: Date) => startOfWeek(d, { weekStartsOn: 0 });
const weekEnd = (d: Date) => endOfWeek(d, { weekStartsOn: 0 });

function PayrollPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const [from, setFrom] = useState(format(weekStart(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(weekEnd(new Date()), "yyyy-MM-dd"));
  const [pickerOpen, setPickerOpen] = useState(false);
  const shiftWeek = (delta: number) => {
    const base = new Date(from + "T00:00:00");
    const s = weekStart(addWeeks(base, delta));
    setFrom(format(s, "yyyy-MM-dd"));
    setTo(format(weekEnd(s), "yyyy-MM-dd"));
  };

  const { data: payrolls } = useQuery({
    queryKey: ["payrolls", from, to],
    queryFn: async () => (await supabase.from("payrolls").select("*, employee:employees(full_name,employee_code,type)")
      .eq("period_start", from).eq("period_end", to).order("created_at", { ascending: false })).data ?? [],
  });

  const generate = useMutation({
    mutationFn: async () => {
      const { data: emps } = await supabase.from("employees").select("*").eq("active", true);
      if (!emps?.length) throw new Error("Tidak ada karyawan aktif");
      const days = differenceInCalendarDays(new Date(to), new Date(from)) + 1;

      for (const e of emps) {
        const anyE = e as typeof e & { hourly_rate?: number | string; pay_unit?: "day" | "hour" };
        let base = 0;
        if (e.type === "borongan") {
          const { data: logs } = await supabase.from("job_logs").select("amount")
            .eq("employee_id", e.id).eq("status", "approved").gte("log_date", from).lte("log_date", to);
          base = (logs ?? []).reduce((s, l) => s + Number(l.amount), 0);
        } else if (anyE.pay_unit === "hour") {
          const { data: att } = await supabase.from("attendances").select("check_in,check_out")
            .eq("employee_id", e.id).eq("status", "hadir").gte("date", from).lte("date", to);
          const totalHours = (att ?? []).reduce((s, a) => {
            if (!a.check_in || !a.check_out) return s;
            const diffMs = new Date(a.check_out).getTime() - new Date(a.check_in).getTime();
            return s + Math.max(diffMs / 3_600_000, 0);
          }, 0);
          base = totalHours * Number(anyE.hourly_rate ?? 0);
        } else {
          const { data: att } = await supabase.from("attendances").select("status")
            .eq("employee_id", e.id).eq("status", "hadir").gte("date", from).lte("date", to);
          base = (att ?? []).length * Number(e.daily_wage);
        }
        // Hitung potongan cashbon yang belum dibayar (status approved)
        const { data: cb } = await supabase.from("cashbon").select("amount")
          .eq("employee_id", e.id).eq("status", "approved");
        const deductions = (cb ?? []).reduce((s, c) => s + Number(c.amount), 0);
        const total = Math.max(0, base - deductions);
        // upsert
        const { data: existing } = await supabase.from("payrolls").select("id")
          .eq("employee_id", e.id).eq("period_start", from).eq("period_end", to).maybeSingle();
        if (existing) {
          await supabase.from("payrolls").update({ base, deductions, total }).eq("id", existing.id);
        } else {
          await supabase.from("payrolls").insert({ employee_id: e.id, period_start: from, period_end: to, base, deductions, total, status: "draft" });
        }
        void days;
      }
    },
    onSuccess: () => { toast.success("Payroll digenerate"); qc.invalidateQueries({ queryKey: ["payrolls"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "draft" | "approved" | "paid" }) => {
      const payload: { status: "draft" | "approved" | "paid"; approved_by?: string; approved_at?: string } = { status };
      if (status === "approved") { payload.approved_by = me!.user.id; payload.approved_at = new Date().toISOString(); }
      const { error } = await supabase.from("payrolls").update(payload).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payrolls"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isStaff(me?.role)) return <p className="text-sm text-slate-500">Akses ditolak.</p>;
  const isOwner = me?.role === "owner";
  const isCurrent = isSameDay(new Date(from + "T00:00:00"), weekStart(new Date()));

  return (
    <div className="space-y-6 max-w-7xl">
      <div><h1 className="text-2xl font-bold text-slate-900">Payroll</h1><p className="text-sm text-slate-500">Generate & approve slip gaji per periode</p></div>

      <Card className="overflow-hidden border-0 shadow-sm bg-gradient-to-br from-sky-50 via-violet-50 to-rose-50">
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => {
                const now = new Date();
                setFrom(format(weekStart(now), "yyyy-MM-dd"));
                setTo(format(weekEnd(now), "yyyy-MM-dd"));
              }}
              className={cn(
                "px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all",
                isCurrent
                  ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                  : "bg-white/70 text-slate-600 border border-white hover:bg-white",
              )}
            >
              Minggu Ini
            </button>
            <Button onClick={() => generate.mutate()} disabled={generate.isPending} size="sm" className="bg-slate-900 hover:bg-slate-800 text-white">
              Generate / Refresh
            </Button>
          </div>

          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => shiftWeek(-1)}
              className="h-10 w-10 rounded-full bg-white/80 hover:bg-white shadow-sm shrink-0"
              aria-label="Minggu lalu"
            >
              <ChevronLeft className="h-5 w-5 text-sky-600" />
            </Button>

            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <button className="min-w-0 rounded-2xl bg-white/90 backdrop-blur px-3 py-2.5 shadow-sm border border-white hover:bg-white transition-all text-center group">
                  <div className="flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
                    <CalendarRange className="h-3 w-3" />
                    Periode Mingguan
                  </div>
                  <div className="mt-0.5 text-sm sm:text-base font-bold text-slate-900 truncate">
                    {format(new Date(from), "dd MMM", { locale: idLocale })} – {format(new Date(to), "dd MMM yyyy", { locale: idLocale })}
                  </div>
                  <div className="text-[10px] text-slate-500">Min – Sab · Gajian Sabtu</div>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-fit max-w-[calc(100vw-1rem)] overflow-hidden p-0 pointer-events-auto" align="center">
                <Calendar
                  mode="single"
                  selected={new Date(from + "T00:00:00")}
                  onSelect={(d) => {
                    if (!d) return;
                    const s = weekStart(d);
                    setFrom(format(s, "yyyy-MM-dd"));
                    setTo(format(weekEnd(s), "yyyy-MM-dd"));
                    setPickerOpen(false);
                  }}
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
              onClick={() => shiftWeek(1)}
              className="h-10 w-10 rounded-full bg-white/80 hover:bg-white shadow-sm shrink-0"
              aria-label="Minggu depan"
            >
              <ChevronRight className="h-5 w-5 text-sky-600" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card><CardContent className="p-0">
        {/* Mobile: vertical cards */}
        <div className="md:hidden space-y-3 p-3">
          {payrolls?.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{p.employee?.full_name}</div>
                  <Badge variant="outline" className="mt-1 text-xs">{p.employee?.type}</Badge>
                </div>
                <Badge variant={p.status === "paid" ? "default" : p.status === "approved" ? "secondary" : "outline"}>{p.status}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md bg-slate-50 px-2 py-1.5">
                  <div className="text-[10px] uppercase text-slate-500">Base</div>
                  <div className="font-semibold">{fmtIDR(Number(p.base))}</div>
                </div>
                <div className="rounded-md bg-emerald-50 px-2 py-1.5">
                  <div className="text-[10px] uppercase text-emerald-700/70">Total</div>
                  <div className="font-bold text-emerald-700">{fmtIDR(Number(p.total))}</div>
                </div>
              </div>
              <Select value={p.status} onValueChange={(v) => setStatus.mutate({ id: p.id, status: v as "draft" | "approved" | "paid" })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">draft</SelectItem>
                  <SelectItem value="approved" disabled={!isOwner && p.status !== "approved"}>approved {!isOwner && "(owner)"}</SelectItem>
                  <SelectItem value="paid" disabled={!isOwner}>paid {!isOwner && "(owner)"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
          {!payrolls?.length && <div className="text-center py-8 text-slate-500 text-sm">Belum ada payroll untuk periode ini. Klik <em>Generate</em>.</div>}
        </div>

        {/* Desktop: table */}
        <div className="hidden md:block">
          <Table>
            <TableHeader><TableRow><TableHead>Karyawan</TableHead><TableHead>Tipe</TableHead><TableHead className="text-right">Base</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {payrolls?.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.employee?.full_name}</TableCell>
                  <TableCell><Badge variant="outline">{p.employee?.type}</Badge></TableCell>
                  <TableCell className="text-right">{fmtIDR(Number(p.base))}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtIDR(Number(p.total))}</TableCell>
                  <TableCell><Badge variant={p.status === "paid" ? "default" : p.status === "approved" ? "secondary" : "outline"}>{p.status}</Badge></TableCell>
                  <TableCell>
                    <Select value={p.status} onValueChange={(v) => setStatus.mutate({ id: p.id, status: v as "draft" | "approved" | "paid" })}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">draft</SelectItem>
                        <SelectItem value="approved" disabled={!isOwner && p.status !== "approved"}>approved {!isOwner && "(owner)"}</SelectItem>
                        <SelectItem value="paid" disabled={!isOwner}>paid {!isOwner && "(owner)"}</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
              {!payrolls?.length && <TableRow><TableCell colSpan={6} className="text-center py-8 text-slate-500">Belum ada payroll untuk periode ini. Klik <em>Generate</em>.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent></Card>
    </div>
  );
}
