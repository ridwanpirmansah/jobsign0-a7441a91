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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Play, CheckCircle2, XCircle, RotateCcw, Copy, Trash2, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { WorkflowTabs } from "@/components/WorkflowTabs";
import { TablePagination } from "@/components/TablePagination";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/projects/")({ component: ProjectsPage });

type SortKey = "code" | "title" | "customer" | "deadline" | "status" | "total_points" | "contract_value";
type SortDir = "asc" | "desc";

function SortableHead({ label, col, sortKey, sortDir, onClick }: { label: string; col: SortKey; sortKey: SortKey; sortDir: SortDir; onClick: (k: SortKey) => void }) {
  const active = sortKey === col;
  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead>
      <button type="button" onClick={() => onClick(col)} className="inline-flex items-center gap-1 hover:text-slate-900">
        {label} <Icon className="h-3.5 w-3.5 opacity-60" />
      </button>
    </TableHead>
  );
}

function ProjectsPage() {
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", title: "", customer_id: "", deadline: "", description: "", total_points: 0, contract_value: 0 });
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "deadline" || k === "code" ? "desc" : "asc"); }
  };

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

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Project dihapus"); qc.invalidateQueries({ queryKey: ["projects-all"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicateMut = useMutation({
    mutationFn: async (p: any) => {
      const newCode = `${p.code}-COPY-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const { error } = await supabase.from("projects").insert({
        code: newCode,
        title: p.title,
        customer_id: p.customer_id,
        deadline: p.deadline,
        description: p.description,
        total_points: p.total_points,
        contract_value: p.contract_value,
        status: "draft",
        // NOT copied: parent_order_id (kept null so no order linkage)
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Project diduplikat"); qc.invalidateQueries({ queryKey: ["projects-all"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const list = projects ?? [];
    const q = filter.trim().toLowerCase();
    let arr = list.filter((p: any) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!q) return true;
      return [p.code, p.title, p.customer?.name, p.description].some((v) => String(v ?? "").toLowerCase().includes(q));
    });
    arr = [...arr].sort((a: any, b: any) => {
      const get = (r: any) => {
        switch (sortKey) {
          case "code": return r.code ?? "";
          case "title": return r.title ?? "";
          case "customer": return r.customer?.name ?? "";
          case "deadline": return r.deadline ?? "";
          case "status": return r.status ?? "";
          case "total_points": return Number(r.total_points ?? 0);
          case "contract_value": return Number(r.contract_value ?? 0);
        }
      };
      const va = get(a); const vb = get(b);
      if (typeof va === "number" && typeof vb === "number") return sortDir === "asc" ? va - vb : vb - va;
      return sortDir === "asc"
        ? String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" })
        : String(vb).localeCompare(String(va), undefined, { numeric: true, sensitivity: "base" });
    });
    return arr;
  }, [projects, filter, statusFilter, sortKey, sortDir]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);
  useEffect(() => { setPage(1); }, [filter, statusFilter, sortKey, sortDir, filtered.length]);

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
        <CardHeader className="pb-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Input placeholder="Cari kode / judul / customer..." value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="done">Done</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Kode" col="code" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableHead label="Judul" col="title" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableHead label="Customer" col="customer" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableHead label="Deadline" col="deadline" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableHead label="Titik" col="total_points" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableHead label="Status" col="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.code}</TableCell>
                  <TableCell className="font-medium">{p.title}</TableCell>
                  <TableCell>{p.customer?.name ?? "—"}</TableCell>
                  <TableCell>{p.deadline ?? "—"}</TableCell>
                  <TableCell>{p.total_points}</TableCell>
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
                      <Button size="icon" variant="ghost" title="Duplikat" onClick={() => duplicateMut.mutate(p)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="text-rose-600 hover:text-rose-700 hover:bg-rose-50" title="Hapus">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Hapus project ini?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Project <span className="font-semibold">{p.code} — {p.title}</span> akan dihapus permanen. Riwayat job log yang terkait akan tetap ada tetapi kehilangan referensi project.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Batal</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteMut.mutate(p.id)} className="bg-rose-600 hover:bg-rose-700">Hapus</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <Link to="/projects/$id" params={{ id: p.id }} className="text-sm text-primary hover:underline ml-2">Detail →</Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!filtered.length && <TableRow><TableCell colSpan={7} className="text-center py-8 text-slate-500">Tidak ada project</TableCell></TableRow>}
            </TableBody>
          </Table>
          {filtered.length > 0 && (
            <div className="p-3 border-t">
              <TablePagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} label="project" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NoAccess() {
  return <Card><CardHeader><CardTitle>Akses ditolak</CardTitle></CardHeader><CardContent><p className="text-sm text-slate-500">Halaman ini hanya untuk admin & owner.</p></CardContent></Card>;
}
