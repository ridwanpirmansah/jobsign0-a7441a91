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
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Slip Gaji</CardTitle></CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}
