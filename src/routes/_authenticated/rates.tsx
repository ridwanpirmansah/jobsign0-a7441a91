import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/rates")({ component: RatesPage });

function fmtIDR(n: number) { return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0); }

function RatesPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", unit: "titik", rate_per_unit: 0, note: "" });
  const [editId, setEditId] = useState<string | null>(null);

  const { data: rates } = useQuery({
    queryKey: ["rates"],
    queryFn: async () => (await supabase.from("job_rates").select("*").order("name")).data ?? [],
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { name: form.name, unit: form.unit, rate_per_unit: form.rate_per_unit, note: form.note || null };
      const { error } = editId
        ? await supabase.from("job_rates").update(payload).eq("id", editId)
        : await supabase.from("job_rates").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Tersimpan"); setOpen(false); setEditId(null); setForm({ name: "", unit: "titik", rate_per_unit: 0, note: "" }); qc.invalidateQueries({ queryKey: ["rates"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => { const { error } = await supabase.from("job_rates").update({ active }).eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rates"] }),
  });

  if (!isStaff(me?.role)) return <p className="text-sm text-slate-500">Akses ditolak.</p>;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-slate-900">Tarif Borongan</h1><p className="text-sm text-slate-500">Daftar jenis garapan & tarif per titik/satuan</p></div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditId(null); setForm({ name: "", unit: "titik", rate_per_unit: 0, note: "" }); } }}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> Tarif Baru</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? "Edit" : "Tambah"} Tarif</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }} className="space-y-3">
              <div><Label>Nama *</Label><Input required placeholder="cth: Bending huruf timbul" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Satuan</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
                <div><Label>Tarif per satuan *</Label><Input type="number" required value={form.rate_per_unit} onChange={(e) => setForm({ ...form, rate_per_unit: Number(e.target.value) })} /></div>
              </div>
              <div><Label>Catatan</Label><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
              <DialogFooter><Button type="submit" disabled={saveMut.isPending}>Simpan</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Nama</TableHead><TableHead>Satuan</TableHead><TableHead className="text-right">Tarif</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {rates?.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.unit}</TableCell>
                <TableCell className="text-right font-mono">{fmtIDR(Number(r.rate_per_unit))}</TableCell>
                <TableCell><Badge variant={r.active ? "default" : "secondary"}>{r.active ? "aktif" : "nonaktif"}</Badge></TableCell>
                <TableCell className="text-right space-x-2">
                  <Button variant="ghost" size="sm" onClick={() => { setEditId(r.id); setForm({ name: r.name, unit: r.unit, rate_per_unit: Number(r.rate_per_unit), note: r.note ?? "" }); setOpen(true); }}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleActive.mutate({ id: r.id, active: !r.active })}>{r.active ? "Nonaktifkan" : "Aktifkan"}</Button>
                </TableCell>
              </TableRow>
            ))}
            {!rates?.length && <TableRow><TableCell colSpan={5} className="text-center py-8 text-slate-500">Belum ada tarif</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
