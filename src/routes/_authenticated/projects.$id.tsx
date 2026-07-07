import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/projects/$id")({ component: ProjectDetail });

function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
}

function ProjectDetail() {
  const { id } = useParams({ from: "/_authenticated/projects/$id" });
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const qc = useQueryClient();
  const [empToAdd, setEmpToAdd] = useState("");

  const { data: project } = useQuery({
    queryKey: ["project", id],
    queryFn: async () => (await supabase.from("projects").select("*, customer:customers(name,phone), parent_order:orders!projects_parent_order_id_fkey(id, order_no, source, co_date, username, kota, payment, split, status, notes)").eq("id", id).maybeSingle()).data,
  });
  const { data: assignments } = useQuery({
    queryKey: ["assignments", id],
    queryFn: async () => (await supabase.from("project_assignments").select("id, employee:employees(id,full_name,employee_code,type)").eq("project_id", id)).data ?? [],
  });
  const { data: employees } = useQuery({
    queryKey: ["employees-active"],
    queryFn: async () => (await supabase.from("employees").select("id,full_name,employee_code").eq("active", true).order("full_name")).data ?? [],
  });
  const { data: logs } = useQuery({
    queryKey: ["project-logs", id],
    queryFn: async () => (await supabase.from("job_logs")
      .select("*, employee:employees(full_name,employee_code), rate:job_rates(name,unit)")
      .eq("project_id", id).order("log_date", { ascending: false })).data ?? [],
  });

  const approverIds = Array.from(new Set((logs ?? []).map((l: any) => l.approved_by).filter(Boolean))) as string[];
  const { data: approvers } = useQuery({
    queryKey: ["approvers", approverIds.sort().join(",")],
    enabled: approverIds.length > 0,
    queryFn: async () => (await supabase.from("profiles").select("id, full_name").in("id", approverIds)).data ?? [],
  });
  const approverMap = new Map((approvers ?? []).map((p: any) => [p.id, p.full_name]));


  const updateStatus = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.from("projects").update({ status: status as "draft" | "active" | "done" | "cancelled" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Status diperbarui"); qc.invalidateQueries({ queryKey: ["project", id] }); },
  });

  const addAssign = useMutation({
    mutationFn: async () => {
      if (!empToAdd) return;
      const { error } = await supabase.from("project_assignments").insert({ project_id: id, employee_id: empToAdd });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Karyawan ditugaskan"); setEmpToAdd(""); qc.invalidateQueries({ queryKey: ["assignments", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeAssign = useMutation({
    mutationFn: async (aid: string) => { const { error } = await supabase.from("project_assignments").delete().eq("id", aid); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["assignments", id] }); },
  });

  const totalApproved = (logs ?? []).filter((l) => l.status === "approved").reduce((s, l) => s + Number(l.qty), 0);
  const totalSpend = (logs ?? []).filter((l) => l.status === "approved").reduce((s, l) => s + Number(l.amount), 0);

  if (meLoading) return <p className="text-sm text-slate-500">Memuat…</p>;
  if (!isStaff(me?.role)) return <p className="text-sm text-slate-500">Akses ditolak. Role Anda: {me?.role ?? "tidak diketahui"}</p>;
  if (!project) return <p className="text-sm text-slate-500">Memuat…</p>;

  return (
    <div className="space-y-6 max-w-7xl">
      <Link to="/projects" className="text-sm text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"><ArrowLeft className="h-4 w-4" /> Kembali ke list</Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs font-mono text-slate-500">{project.code}</div>
          <h1 className="text-2xl font-bold text-slate-900">{project.title}</h1>
          <p className="text-sm text-slate-500">Customer: {project.customer?.name ?? "—"} · Deadline: {project.deadline ?? "—"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{project.status}</Badge>
          <Select value={project.status} onValueChange={(v) => updateStatus.mutate(v)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">draft</SelectItem>
              <SelectItem value="active">active</SelectItem>
              <SelectItem value="done">done</SelectItem>
              <SelectItem value="cancelled">cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>


      {project.parent_order && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Order Terkait</CardTitle></CardHeader>
          <CardContent className="text-sm grid sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div><div className="text-xs text-slate-500">No. Order</div><div className="font-mono font-semibold">{project.parent_order.order_no}</div></div>
            <div><div className="text-xs text-slate-500">Sumber</div><div><Badge variant="outline">{project.parent_order.source}</Badge> <Badge variant="secondary" className="ml-1">{project.parent_order.status}</Badge></div></div>
            <div><div className="text-xs text-slate-500">Tgl CO</div><div>{project.parent_order.co_date ?? "-"}</div></div>
            <div><div className="text-xs text-slate-500">Customer / Kota</div><div>{project.parent_order.username ?? "-"}{project.parent_order.kota ? ` — ${project.parent_order.kota}` : ""}</div></div>
            <div><div className="text-xs text-slate-500">Payment Order</div><div className="font-semibold">{fmtIDR(Number(project.parent_order.payment ?? 0) + Number(project.parent_order.split ?? 0))}</div></div>
            {project.parent_order.notes && <div className="sm:col-span-2 md:col-span-3"><div className="text-xs text-slate-500">Catatan Order</div><div className="text-slate-700">{project.parent_order.notes}</div></div>}
            <div className="sm:col-span-2 md:col-span-4">
              <Link to="/orders" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">Buka daftar order →</Link>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Total Titik</div><div className="text-2xl font-bold">{project.total_points}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Titik Selesai</div><div className="text-2xl font-bold">{totalApproved}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Nilai Kontrak</div><div className="text-2xl font-bold">{fmtIDR(Number(project.contract_value))}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Biaya Tenaga Kerja</div><div className="text-2xl font-bold text-amber-600">{fmtIDR(totalSpend)}</div></CardContent></Card>
      </div>


      <Card>
        <CardHeader><CardTitle className="text-base">Karyawan Ditugaskan</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Select value={empToAdd} onValueChange={setEmpToAdd}>
              <SelectTrigger className="max-w-sm"><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
              <SelectContent>{employees?.map((e) => <SelectItem key={e.id} value={e.id}>{e.employee_code} — {e.full_name}</SelectItem>)}</SelectContent>
            </Select>
            <Button onClick={() => addAssign.mutate()} disabled={!empToAdd}>Tugaskan</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {assignments?.map((a) => (
              <Badge key={a.id} variant="secondary" className="gap-1.5 py-1.5 px-2">
                {a.employee?.full_name} ({a.employee?.type})
                <button onClick={() => removeAssign.mutate(a.id)}><X className="h-3 w-3" /></button>
              </Badge>
            ))}
            {!assignments?.length && <p className="text-sm text-slate-500">Belum ada karyawan ditugaskan</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Riwayat Job Log</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>Karyawan</TableHead><TableHead>Tarif</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Upah</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {logs?.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{format(new Date(l.log_date), "EEE, dd MMM yyyy", { locale: idLocale })}</TableCell>
                  <TableCell>{l.employee?.full_name}</TableCell>
                  <TableCell>{l.rate?.name}</TableCell>
                  <TableCell className="text-right">{l.qty}</TableCell>
                  <TableCell className="text-right">{fmtIDR(Number(l.amount))}</TableCell>
                  <TableCell><Badge variant={l.status === "approved" ? "default" : l.status === "rejected" ? "destructive" : "secondary"}>{l.status}</Badge></TableCell>
                </TableRow>
              ))}
              {!logs?.length && <TableRow><TableCell colSpan={6} className="text-center py-6 text-slate-500">Belum ada laporan</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
