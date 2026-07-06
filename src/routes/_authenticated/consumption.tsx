import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, Utensils, Lock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/consumption")({ component: ConsumptionPage });

function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
}

function ConsumptionPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const staff = isStaff(me?.role);

  const [employeeId, setEmployeeId] = useState<string>("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [filterEmp, setFilterEmp] = useState<string>("all");

  const { data: employees } = useQuery({
    enabled: staff,
    queryKey: ["employees-active-list"],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("id, full_name, employee_code").eq("active", true).order("full_name");
      return data ?? [];
    },
  });

  const { data: rows } = useQuery({
    enabled: staff,
    queryKey: ["consumption", filterEmp],
    queryFn: async () => {
      const q = supabase.from("employee_consumption")
        .select("*, employee:employees(full_name, employee_code)")
        .order("consumption_date", { ascending: false });
      if (filterEmp !== "all") q.eq("employee_id", filterEmp);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const totals = useMemo(() => {
    const r = rows ?? [];
    return {
      pending: r.filter(x => !x.deducted).reduce((s, x) => s + Number(x.amount), 0),
      deducted: r.filter(x => x.deducted).reduce((s, x) => s + Number(x.amount), 0),
    };
  }, [rows]);

  const create = useMutation({
    mutationFn: async () => {
      if (!employeeId) throw new Error("Pilih karyawan");
      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error("Nominal tidak valid");
      const { error } = await supabase.from("employee_consumption").insert({
        employee_id: employeeId,
        consumption_date: date,
        amount: amt,
        note: note || null,
        created_by: me!.user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Catatan konsumsi ditambahkan");
      setAmount(""); setNote("");
      qc.invalidateQueries({ queryKey: ["consumption"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employee_consumption").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Catatan dihapus"); qc.invalidateQueries({ queryKey: ["consumption"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!staff) return <p className="text-sm text-slate-500">Akses ditolak. Hanya admin/owner.</p>;

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Utensils className="h-6 w-6 text-orange-600" /> Konsumsi Karyawan
        </h1>
        <p className="text-sm text-slate-500">Catat jajan/makan karyawan yang dibayar uang perusahaan — akan memotong upah di akhir periode</p>
      </div>

      <div className="grid gap-3 grid-cols-2">
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-slate-500">Belum Dipotong</div><div className="text-base sm:text-xl font-bold text-amber-600">{fmtIDR(totals.pending)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-slate-500">Sudah Dipotong</div><div className="text-base sm:text-xl font-bold text-emerald-600">{fmtIDR(totals.deducted)}</div></CardContent></Card>
      </div>

      <Card className="border-orange-200 bg-gradient-to-br from-orange-50/50 to-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4 text-orange-600" /> Tambah Catatan Konsumsi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Karyawan</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
                <SelectContent>
                  {employees?.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.full_name}{e.employee_code ? ` · ${e.employee_code}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tanggal</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Nominal (Rp)</Label>
              <Input type="number" inputMode="numeric" placeholder="25000" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>Catatan (contoh: Nasi padang, Kopi)</Label>
              <Input placeholder="Nasi padang + es teh" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <Button onClick={() => create.mutate()} disabled={create.isPending} className="bg-orange-600 hover:bg-orange-700">
            <Plus className="h-4 w-4 mr-2" /> Simpan
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Riwayat Konsumsi</CardTitle>
          <div className="min-w-[180px]">
            <Select value={filterEmp} onValueChange={setFilterEmp}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua karyawan</SelectItem>
                {employees?.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-2 sm:p-4 space-y-2">
          {rows?.map((r) => {
            const done = r.deducted;
            const tone = done
              ? { chip: "bg-emerald-100 text-emerald-700 border-emerald-200", stripe: "bg-emerald-400", bg: "from-emerald-50/60" }
              : { chip: "bg-amber-100 text-amber-800 border-amber-200", stripe: "bg-amber-400", bg: "from-amber-50/60" };
            return (
              <div key={r.id} className={`relative overflow-hidden rounded-lg border border-slate-200/70 bg-gradient-to-br ${tone.bg} to-white px-3 py-2.5 pl-3.5`}>
                <span className={`absolute left-0 top-0 h-full w-1 ${tone.stripe}`} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate text-sm">{r.employee?.full_name}</div>
                    <div className="text-[11px] text-slate-500">{format(new Date(r.consumption_date), "EEE, dd MMM yyyy", { locale: idLocale })}</div>
                    {r.note && <div className="text-xs text-slate-700 italic mt-1">"{r.note}"</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold text-slate-900">{fmtIDR(Number(r.amount))}</div>
                    <Badge variant="outline" className={`text-[10px] uppercase ${tone.chip}`}>
                      {done ? <><Lock className="h-2.5 w-2.5 mr-1" /> Dipotong</> : "Belum dipotong"}
                    </Badge>
                  </div>
                </div>
                {!done && (
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" variant="ghost" className="h-7 text-rose-600" onClick={() => remove.mutate(r.id)}>
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Hapus
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          {!rows?.length && <div className="text-center text-slate-500 py-6 text-sm">Belum ada catatan konsumsi</div>}
        </CardContent>
      </Card>
    </div>
  );
}
