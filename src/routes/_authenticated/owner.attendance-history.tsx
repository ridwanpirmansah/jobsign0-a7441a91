import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LogIn, LogOut, Coffee, Clock, StickyNote, Users } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/owner/attendance-history")({ component: OwnerAttendanceHistory });

function fmtDur(mins: number | null) {
  if (mins == null || isNaN(mins)) return "—";
  if (mins <= 0) return "0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}j ${m}m` : `${m}m`;
}

function OwnerAttendanceHistory() {
  const { data: me } = useCurrentUser();
  const [empFilter, setEmpFilter] = useState<string>("all");

  const { data: employees } = useQuery({
    queryKey: ["all-employees-att"],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("id,full_name,active").order("full_name");
      return data ?? [];
    },
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["all-att", empFilter],
    queryFn: async () => {
      let q = supabase
        .from("attendances")
        .select("*, employees(id,full_name)")
        .order("date", { ascending: false })
        .order("check_in", { ascending: false })
        .limit(300);
      if (empFilter !== "all") q = q.eq("employee_id", empFilter);
      const { data } = await q;
      return data ?? [];
    },
  });

  const stats = useMemo(() => {
    const total = rows?.length ?? 0;
    const hadir = rows?.filter((r) => r.status === "hadir").length ?? 0;
    return { total, hadir };
  }, [rows]);

  if (me && me.role !== "owner" && me.role !== "admin") {
    return <p className="text-sm text-slate-500">Hanya owner/admin yang bisa melihat halaman ini.</p>;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Riwayat Absensi Karyawan</h1>
        <p className="text-sm text-slate-500">Pantau absensi seluruh karyawan beserta durasi kerja & istirahat</p>
      </div>

      <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50/60 via-white to-white">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Users className="h-4 w-4 text-indigo-600" /> Filter Karyawan
          </div>
          <div className="flex-1 max-w-sm">
            <Select value={empFilter} onValueChange={setEmpFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Karyawan</SelectItem>
                {employees?.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.full_name}{!e.active && " (nonaktif)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-slate-500">
            {stats.total} entri · {stats.hadir} hadir
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-none bg-transparent sm:border sm:shadow-sm sm:bg-card">
        <CardHeader className="px-0 sm:px-6"><CardTitle className="text-base">Riwayat</CardTitle></CardHeader>
        <CardContent className="space-y-3 px-0 sm:px-6">
          {isLoading && <div className="text-center text-slate-500 py-10 text-sm">Memuat...</div>}
          {rows?.map((r: any) => {
            const d = new Date(r.date);
            const day = format(d, "dd", { locale: idLocale });
            const mon = format(d, "MMM", { locale: idLocale });
            const wk = format(d, "EEEE", { locale: idLocale });
            const yr = format(d, "yyyy");
            const ci = r.check_in ? new Date(r.check_in) : null;
            const co = r.check_out ? new Date(r.check_out) : null;
            const bs = r.break_start ? new Date(r.break_start) : null;
            const be = r.break_end ? new Date(r.break_end) : null;
            const breakMins = bs && be ? Math.max(0, Math.round((be.getTime() - bs.getTime()) / 60000)) : null;
            const grossMins = ci && co ? Math.max(0, Math.round((co.getTime() - ci.getTime()) / 60000)) : null;
            const workMins = grossMins != null ? Math.max(0, grossMins - (breakMins ?? 0)) : null;
            const statusColor =
              r.status === "hadir"
                ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                : "bg-slate-100 text-slate-600 border-slate-200";
            return (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-2.5 sm:p-4 shadow-sm">
                <div className="flex items-stretch gap-3">
                  <div className="flex flex-col items-center justify-center shrink-0 w-14 sm:w-16 rounded-lg bg-gradient-to-b from-indigo-50 to-white border border-indigo-100 py-2">
                    <span className="text-[10px] uppercase font-semibold text-indigo-500 tracking-wide">{mon}</span>
                    <span className="text-2xl font-black leading-none text-slate-900">{day}</span>
                    <span className="text-[10px] text-slate-400 mt-0.5">{yr}</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{r.employees?.full_name ?? "—"}</p>
                        <p className="text-[11px] text-slate-500 capitalize">{wk}</p>
                      </div>
                      <Badge variant="outline" className={`text-[10px] uppercase tracking-wide ${statusColor}`}>{r.status}</Badge>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2">
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
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="flex items-center gap-1.5 rounded-md bg-indigo-50 px-2 py-1.5 border border-indigo-100 min-w-0">
                        <Clock className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[10px] text-indigo-700/70 leading-none">Durasi Kerja</p>
                          <p className="text-sm font-bold text-indigo-700 leading-tight">{fmtDur(workMins)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 border border-amber-100 min-w-0">
                        <Coffee className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[10px] text-amber-700/70 leading-none">
                            Istirahat {bs && be ? `(${format(bs, "HH:mm")}–${format(be, "HH:mm")})` : ""}
                          </p>
                          <p className="text-sm font-bold text-amber-700 leading-tight">{fmtDur(breakMins)}</p>
                        </div>
                      </div>
                    </div>

                    {r.note && (
                      <div className="mt-2 flex items-start gap-2 rounded-md bg-slate-50 px-2 py-1.5 border border-slate-100">
                        <StickyNote className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
                        <p className="text-xs text-slate-600 whitespace-pre-wrap min-w-0">{r.note}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {!isLoading && !rows?.length && (
            <div className="text-center text-slate-500 py-10 text-sm">Belum ada data</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
