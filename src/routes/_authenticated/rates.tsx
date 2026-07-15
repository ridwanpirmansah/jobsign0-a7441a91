import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/rates")({ component: RatesPage });

function fmtIDR(n: number) { return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0); }

type PricingMode = "per_unit" | "area";
type FormState = { name: string; unit: string; rate_per_unit: number; min_amount: number; pricing_mode: PricingMode; sort_order: number; note: string };
const emptyForm: FormState = { name: "", unit: "titik", rate_per_unit: 0, min_amount: 0, pricing_mode: "per_unit", sort_order: 0, note: "" };

function RatesPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);

  const { data: rates } = useQuery({
    queryKey: ["rates"],
    queryFn: async () =>
      (await supabase
        .from("job_rates")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true })).data ?? [],
  });

  const nextSortOrder = () => Math.max(0, ...(rates ?? []).map((r) => Number(r.sort_order ?? 0))) + 10;

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        unit: form.unit,
        rate_per_unit: form.rate_per_unit,
        min_amount: form.min_amount,
        pricing_mode: form.pricing_mode,
        sort_order: form.sort_order,
        note: form.note || null,
      };
      const { error } = editId
        ? await supabase.from("job_rates").update(payload).eq("id", editId)
        : await supabase.from("job_rates").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Tersimpan"); setOpen(false); setEditId(null); setForm(emptyForm); qc.invalidateQueries({ queryKey: ["rates"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => { const { error } = await supabase.from("job_rates").update({ active }).eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rates"] }),
  });

  const reorderMut = useMutation({
    mutationFn: async ({ id, direction }: { id: string; direction: -1 | 1 }) => {
      const list = [...(rates ?? [])];
      const index = list.findIndex((r) => r.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= list.length) return;
      [list[index], list[target]] = [list[target], list[index]];
      const updates = list.map((r, i) =>
        supabase.from("job_rates").update({ sort_order: (i + 1) * 10 }).eq("id", r.id),
      );
      const results = await Promise.all(updates);
      const error = results.find((res) => res.error)?.error;
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rates"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isStaff(me?.role)) return <p className="text-sm text-slate-500">Akses ditolak.</p>;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-slate-900">Tarif Borongan</h1><p className="text-sm text-slate-500">Daftar jenis garapan & tarif per titik/satuan atau per area (P × L)</p></div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditId(null); setForm(emptyForm); } }}>
          <DialogTrigger asChild><Button onClick={() => setForm({ ...emptyForm, sort_order: nextSortOrder() })}><Plus className="h-4 w-4 mr-2" /> Tarif Baru</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? "Edit" : "Tambah"} Tarif</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }} className="space-y-3">
              <div><Label>Nama *</Label><Input required placeholder="cth: Potong Akrilik" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Mode Perhitungan</Label>
                  <Select value={form.pricing_mode} onValueChange={(v) => setForm({ ...form, pricing_mode: v as PricingMode, unit: v === "area" ? "cm²" : form.unit })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="per_unit">Per satuan (mis. titik)</SelectItem>
                      <SelectItem value="area">Per area (Panjang × Lebar)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Satuan</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Tarif per satuan *</Label><Input type="number" step="0.01" required value={form.rate_per_unit} onChange={(e) => setForm({ ...form, rate_per_unit: Number(e.target.value) })} /></div>
                <div>
                  <Label>Upah Minimum</Label>
                  <Input type="number" value={form.min_amount} onChange={(e) => setForm({ ...form, min_amount: Number(e.target.value) })} />
                  <p className="text-xs text-slate-500 mt-1">Bila hasil qty × tarif di bawah nilai ini, upah dinaikkan ke minimum.</p>
                </div>
              </div>
              {form.pricing_mode === "area" && (
                <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded p-2">
                  Mode area: qty otomatis dari ukuran akrilik order (P × L). Karyawan cukup klaim sekali; jenis garapan ini tidak terikat jumlah titik.
                </p>
              )}
              <div><Label>Urutan Tampil</Label><Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></div>
              <div><Label>Catatan</Label><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
              <DialogFooter><Button type="submit" disabled={saveMut.isPending}>Simpan</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Urutan</TableHead><TableHead>Nama</TableHead><TableHead>Mode</TableHead><TableHead>Satuan</TableHead><TableHead className="text-right">Tarif</TableHead><TableHead className="text-right">Min Upah</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {rates?.map((r, index) => {
              const anyR = r as typeof r & { pricing_mode?: PricingMode; min_amount?: number | string };
              const mode = (anyR.pricing_mode ?? "per_unit") as PricingMode;
              const minA = Number(anyR.min_amount ?? 0);
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <span className="w-8 text-xs font-mono text-slate-500">{r.sort_order}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === 0 || reorderMut.isPending} onClick={() => reorderMut.mutate({ id: r.id, direction: -1 })} title="Naikkan urutan">
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === (rates?.length ?? 0) - 1 || reorderMut.isPending} onClick={() => reorderMut.mutate({ id: r.id, direction: 1 })} title="Turunkan urutan">
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><Badge variant="outline">{mode === "area" ? "area (P×L)" : "per satuan"}</Badge></TableCell>
                  <TableCell>{r.unit}</TableCell>
                  <TableCell className="text-right font-mono">{fmtIDR(Number(r.rate_per_unit))}</TableCell>
                  <TableCell className="text-right font-mono">{minA > 0 ? fmtIDR(minA) : "—"}</TableCell>
                  <TableCell><Badge variant={r.active ? "default" : "secondary"}>{r.active ? "aktif" : "nonaktif"}</Badge></TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="ghost" size="sm" onClick={() => { setEditId(r.id); setForm({ name: r.name, unit: r.unit, rate_per_unit: Number(r.rate_per_unit), min_amount: minA, pricing_mode: mode, sort_order: Number(r.sort_order ?? 0), note: r.note ?? "" }); setOpen(true); }}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleActive.mutate({ id: r.id, active: !r.active })}>{r.active ? "Nonaktifkan" : "Aktifkan"}</Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {!rates?.length && <TableRow><TableCell colSpan={8} className="text-center py-8 text-slate-500">Belum ada tarif</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
