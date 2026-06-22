import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth, differenceInCalendarDays } from "date-fns";

export const Route = createFileRoute("/_authenticated/payroll")({ component: PayrollPage });

function fmtIDR(n: number) { return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0); }

function PayrollPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const [from, setFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));

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
        // upsert
        const { data: existing } = await supabase.from("payrolls").select("id")
          .eq("employee_id", e.id).eq("period_start", from).eq("period_end", to).maybeSingle();
        if (existing) {
          await supabase.from("payrolls").update({ base, total: base }).eq("id", existing.id);
        } else {
          await supabase.from("payrolls").insert({ employee_id: e.id, period_start: from, period_end: to, base, total: base, status: "draft" });
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

  return (
    <div className="space-y-6 max-w-7xl">
      <div><h1 className="text-2xl font-bold text-slate-900">Payroll</h1><p className="text-sm text-slate-500">Generate & approve slip gaji per periode</p></div>

      <Card>
        <CardHeader><CardTitle className="text-base">Periode</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-3 items-end flex-wrap">
            <div><Label>Dari</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label>Sampai</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <Button onClick={() => generate.mutate()} disabled={generate.isPending}>Generate / Refresh</Button>
          </div>
        </CardContent>
      </Card>

      <Card><CardContent className="p-0">
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
      </CardContent></Card>
    </div>
  );
}
