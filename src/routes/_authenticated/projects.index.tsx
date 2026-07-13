import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Play, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { WorkflowTabs } from "@/components/WorkflowTabs";
import { TablePagination } from "@/components/TablePagination";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/projects/")({ component: ProjectsPage });

function ProjectsPage() {
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", title: "", customer_id: "", deadline: "", description: "", total_points: 0, contract_value: 0 });

  const { data: projects } = useQuery({
    queryKey: ["projects-all"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("*, customer:customers(name)").order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  const { data: customers } = useQuery({
    queryKey: ["customers-all"],
    queryFn: async () => (await supabase.from("customers").select("id,name").order("name")).data ?? [],
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("projects").insert({
        code: form.code, title: form.title,
        customer_id: form.customer_id || null,
        deadline: form.deadline || null,
        description: form.description || null,
        total_points: form.total_points,
        contract_value: form.contract_value,
        status: "draft",
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Project dibuat"); setOpen(false); setForm({ code: "", title: "", customer_id: "", deadline: "", description: "", total_points: 0, contract_value: 0 }); qc.invalidateQueries({ queryKey: ["projects-all"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "draft" | "active" | "done" | "cancelled" }) => {
      const { error } = await supabase.from("projects").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => { toast.success(`Status diubah ke ${v.status}`); qc.invalidateQueries({ queryKey: ["projects-all"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const list = projects ?? [];
  const paged = useMemo(() => list.slice((page - 1) * pageSize, page * pageSize), [list, page, pageSize]);
  useEffect(() => { setPage(1); }, [list.length]);

  if (meLoading) return <p className="text-sm text-slate-500">Memuat…</p>;
  if (!isStaff(me?.role)) return <NoAccess />;

  return (
    <div className="space-y-6 max-w-7xl p-2 sm:p-4">
      <WorkflowTabs />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Project</h1>
          <p className="text-sm text-slate-500">Kelola project neon sign</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> Project Baru</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Project Baru</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Kode *</Label><Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
                <div><Label>Deadline</Label><Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></div>
              </div>
              <div><Label>Judul *</Label><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
              <div><Label>Customer</Label>
                <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Pilih customer" /></SelectTrigger>
                  <SelectContent>{customers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Total Titik</Label><Input type="number" value={form.total_points} onChange={(e) => setForm({ ...form, total_points: Number(e.target.value) })} /></div>
                <div><Label>Nilai Kontrak</Label><Input type="number" value={form.contract_value} onChange={(e) => setForm({ ...form, contract_value: Number(e.target.value) })} /></div>
              </div>
              <div><Label>Deskripsi</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>
              <DialogFooter><Button type="submit" disabled={createMut.isPending}>Simpan</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Kode</TableHead><TableHead>Judul</TableHead><TableHead>Customer</TableHead><TableHead>Deadline</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow></TableHeader>
            <TableBody>
              {projects?.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.code}</TableCell>
                  <TableCell className="font-medium">{p.title}</TableCell>
                  <TableCell>{p.customer?.name ?? "—"}</TableCell>
                  <TableCell>{p.deadline ?? "—"}</TableCell>
                  <TableCell><Badge variant={p.status === "active" ? "default" : p.status === "done" ? "secondary" : "outline"}>{p.status}</Badge></TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {p.status === "draft" && (
                        <Button size="sm" variant="default" onClick={() => setStatus.mutate({ id: p.id, status: "active" })}>
                          <Play className="h-3.5 w-3.5 mr-1" /> Aktifkan
                        </Button>
                      )}
                      {p.status === "active" && (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => setStatus.mutate({ id: p.id, status: "done" })}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Selesai
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: p.id, status: "cancelled" })}>
                            <XCircle className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      {(p.status === "done" || p.status === "cancelled") && (
                        <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: p.id, status: "draft" })}>
                          <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
                        </Button>
                      )}
                      <Link to="/projects/$id" params={{ id: p.id }} className="text-sm text-primary hover:underline ml-2">Detail →</Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!projects?.length && <TableRow><TableCell colSpan={6} className="text-center py-8 text-slate-500">Belum ada project</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function NoAccess() {
  return <Card><CardHeader><CardTitle>Akses ditolak</CardTitle></CardHeader><CardContent><p className="text-sm text-slate-500">Halaman ini hanya untuk admin & owner.</p></CardContent></Card>;
}
