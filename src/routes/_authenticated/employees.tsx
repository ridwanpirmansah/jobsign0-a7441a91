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
import { Plus, Link2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/employees")({ component: EmployeesPage });

const emptyForm = { employee_code: "", full_name: "", phone: "", type: "borongan" as "borongan" | "harian", daily_wage: 0, hourly_rate: 0, pay_unit: "day" as "day" | "hour", profile_id: "" };

function fmtIDR(n: number) { return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0); }

function EmployeesPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);

  const { data: employees } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => (await supabase.from("employees").select("*, profile:profiles(full_name)").order("full_name")).data ?? [],
  });
  const { data: profiles } = useQuery({
    queryKey: ["profiles-for-link"],
    queryFn: async () => (await supabase.from("profiles").select("id,full_name")).data ?? [],
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        employee_code: form.employee_code,
        full_name: form.full_name,
        phone: form.phone || null,
        type: form.type,
        daily_wage: form.daily_wage,
        hourly_rate: form.hourly_rate,
        pay_unit: form.pay_unit,
        profile_id: form.profile_id || null,
      };
      const { error } = editId
        ? await supabase.from("employees").update(payload).eq("id", editId)
        : await supabase.from("employees").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Tersimpan"); setOpen(false); setEditId(null); setForm(emptyForm); qc.invalidateQueries({ queryKey: ["employees"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("employees").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });

  if (!isStaff(me?.role)) return <p className="text-sm text-slate-500">Akses ditolak.</p>;

  const openEdit = (e: NonNullable<typeof employees>[number]) => {
    setEditId(e.id);
    const anyE = e as typeof e & { hourly_rate?: number | string; pay_unit?: "day" | "hour" };
    setForm({
      employee_code: e.employee_code,
      full_name: e.full_name,
      phone: e.phone ?? "",
      type: e.type,
      daily_wage: Number(e.daily_wage),
      hourly_rate: Number(anyE.hourly_rate ?? 0),
      pay_unit: (anyE.pay_unit ?? "day") as "day" | "hour",
      profile_id: e.profile_id ?? "",
    });
    setOpen(true);
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-slate-900">Karyawan</h1><p className="text-sm text-slate-500">Kelola data karyawan borongan & harian</p></div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditId(null); setForm(emptyForm); } }}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> Tambah</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? "Edit" : "Tambah"} Karyawan</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Kode *</Label><Input required value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} /></div>
                <div><Label>Tipe *</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as "borongan" | "harian" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="borongan">Borongan</SelectItem><SelectItem value="harian">Harian</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Nama Lengkap *</Label><Input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>HP</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                {form.type === "harian" ? (
                  <div><Label>Skema Bayar (harian)</Label>
                    <Select value={form.pay_unit} onValueChange={(v) => setForm({ ...form, pay_unit: v as "day" | "hour" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="day">Per Hari</SelectItem>
                        <SelectItem value="hour">Per Jam</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : <div />}
              </div>
              {form.type === "harian" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Upah Harian</Label>
                    <Input type="number" disabled={form.pay_unit !== "day"} value={form.daily_wage} onChange={(e) => setForm({ ...form, daily_wage: Number(e.target.value) })} />
                    <p className="text-xs text-slate-500 mt-1">Dipakai bila skema "Per Hari" (× jumlah hari hadir).</p>
                  </div>
                  <div>
                    <Label>Upah per Jam</Label>
                    <Input type="number" disabled={form.pay_unit !== "hour"} value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: Number(e.target.value) })} />
                    <p className="text-xs text-slate-500 mt-1">Dipakai bila skema "Per Jam" (× total jam dari check-in/out).</p>
                  </div>
                </div>
              )}
              <div><Label>Hubungkan ke akun (opsional)</Label>
                <Select value={form.profile_id} onValueChange={(v) => setForm({ ...form, profile_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Pilih akun user" /></SelectTrigger>
                  <SelectContent>{profiles?.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name || p.id}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-slate-500 mt-1">Sambungkan agar karyawan bisa login & check-in mandiri.</p>
              </div>
              <DialogFooter><Button type="submit" disabled={saveMut.isPending}>Simpan</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Kode</TableHead><TableHead>Nama</TableHead><TableHead>Tipe</TableHead><TableHead>Tarif</TableHead><TableHead>HP</TableHead><TableHead>Akun</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {employees?.map((e) => {
              const anyE = e as typeof e & { hourly_rate?: number | string; pay_unit?: "day" | "hour" };
              const tarif = e.type === "harian"
                ? (anyE.pay_unit === "hour"
                    ? `${fmtIDR(Number(anyE.hourly_rate ?? 0))} / jam`
                    : `${fmtIDR(Number(e.daily_wage))} / hari`)
                : "—";
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs">{e.employee_code}</TableCell>
                  <TableCell className="font-medium">{e.full_name}</TableCell>
                  <TableCell><Badge variant="outline">{e.type}</Badge></TableCell>
                  <TableCell className="text-xs">{tarif}</TableCell>
                  <TableCell>{e.phone ?? "—"}</TableCell>
                  <TableCell>{e.profile_id ? <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Link2 className="h-3 w-3" />terhubung</span> : <span className="text-xs text-slate-400">belum</span>}</TableCell>
                  <TableCell><Badge variant={e.active ? "default" : "secondary"}>{e.active ? "aktif" : "nonaktif"}</Badge></TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(e)}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleActive.mutate({ id: e.id, active: !e.active })}>{e.active ? "Nonaktifkan" : "Aktifkan"}</Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {!employees?.length && <TableRow><TableCell colSpan={8} className="text-center py-8 text-slate-500">Belum ada karyawan</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
