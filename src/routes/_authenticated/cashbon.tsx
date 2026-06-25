import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Check, X, Wallet, Plus, Trash2, BadgeDollarSign } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/cashbon")({ component: CashbonPage });

function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
}

type Status = "pending" | "approved" | "rejected" | "paid";

function CashbonPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const staff = isStaff(me?.role);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const { data: rows } = useQuery({
    queryKey: ["cashbon", staff ? "all" : me?.employee?.id],
    enabled: !!me,
    queryFn: async () => {
      const q = supabase.from("cashbon")
        .select("*, employee:employees(full_name, employee_code)")
        .order("created_at", { ascending: false });
      if (!staff && me?.employee?.id) q.eq("employee_id", me.employee.id);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const totals = useMemo(() => {
    const r = rows ?? [];
    return {
      pending: r.filter(x => x.status === "pending").reduce((s, x) => s + Number(x.amount), 0),
      approved: r.filter(x => x.status === "approved").reduce((s, x) => s + Number(x.amount), 0),
      paid: r.filter(x => x.status === "paid").reduce((s, x) => s + Number(x.amount), 0),
    };
  }, [rows]);

  const create = useMutation({
    mutationFn: async () => {
      if (!me?.employee?.id) throw new Error("Akun belum terhubung ke data karyawan");
      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error("Nominal tidak valid");
      const { error } = await supabase.from("cashbon").insert({
        employee_id: me.employee.id, amount: amt, note: note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pengajuan cashbon terkirim");
      setAmount(""); setNote("");
      qc.invalidateQueries({ queryKey: ["cashbon"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Status }) => {
      const nowIso = new Date().toISOString();
      const patch = status === "paid"
        ? { status, decided_by: me!.user.id, decided_at: nowIso, paid_at: nowIso }
        : { status, decided_by: me!.user.id, decided_at: nowIso };
      const { error } = await supabase.from("cashbon").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Status diperbarui"); qc.invalidateQueries({ queryKey: ["cashbon"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cashbon").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Pengajuan dihapus"); qc.invalidateQueries({ queryKey: ["cashbon"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toneOf = (s: Status) =>
    s === "approved" ? { chip: "bg-sky-100 text-sky-700 border-sky-200", stripe: "bg-sky-400", bg: "from-sky-50/60" }
    : s === "paid" ? { chip: "bg-emerald-100 text-emerald-700 border-emerald-200", stripe: "bg-emerald-400", bg: "from-emerald-50/60" }
    : s === "rejected" ? { chip: "bg-rose-100 text-rose-700 border-rose-200", stripe: "bg-rose-400", bg: "from-rose-50/60" }
    : { chip: "bg-amber-100 text-amber-800 border-amber-200", stripe: "bg-amber-400", bg: "from-amber-50/60" };

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><BadgeDollarSign className="h-6 w-6 text-emerald-600" /> Cashbon</h1>
        <p className="text-sm text-slate-500">{staff ? "Kelola pengajuan kasbon karyawan" : "Ajukan kasbon (pinjaman gaji)"}</p>
      </div>

      <div className="grid gap-3 grid-cols-3">
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-slate-500">Menunggu</div><div className="text-base sm:text-xl font-bold text-amber-600">{fmtIDR(totals.pending)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-slate-500">Disetujui</div><div className="text-base sm:text-xl font-bold text-sky-600">{fmtIDR(totals.approved)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-slate-500">Dibayarkan</div><div className="text-base sm:text-xl font-bold text-emerald-600">{fmtIDR(totals.paid)}</div></CardContent></Card>
      </div>

      {me?.employee && (
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/50 to-white">
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4 text-emerald-600" /> Ajukan Cashbon Baru</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Nominal (Rp)</Label>
                <Input type="number" inputMode="numeric" placeholder="500000" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div>
                <Label>Keperluan / Catatan</Label>
                <Input placeholder="contoh: bayar listrik" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            <Button onClick={() => create.mutate()} disabled={create.isPending} className="bg-emerald-600 hover:bg-emerald-700">
              <Wallet className="h-4 w-4 mr-2" /> Ajukan
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{staff ? "Semua Pengajuan" : "Pengajuan Saya"}</CardTitle></CardHeader>
        <CardContent className="p-2 sm:p-4 space-y-2">
          {rows?.map((r) => {
            const tone = toneOf(r.status as Status);
            return (
              <div key={r.id} className={`relative overflow-hidden rounded-lg border border-slate-200/70 bg-gradient-to-br ${tone.bg} to-white px-3 py-2.5 pl-3.5`}>
                <span className={`absolute left-0 top-0 h-full w-1 ${tone.stripe}`} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {staff && <div className="font-semibold text-slate-900 truncate text-sm">{r.employee?.full_name}</div>}
                    <div className="text-[11px] text-slate-500">{format(new Date(r.request_date), "EEE, dd MMM yyyy", { locale: idLocale })}</div>
                    {r.note && <div className="text-xs text-slate-700 italic mt-1">"{r.note}"</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold text-slate-900">{fmtIDR(Number(r.amount))}</div>
                    <Badge variant="outline" className={`text-[10px] uppercase ${tone.chip}`}>{r.status}</Badge>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 justify-end">
                  {!staff && r.status === "pending" && (
                    <Button size="sm" variant="ghost" className="h-7 text-rose-600" onClick={() => remove.mutate(r.id)}>
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Batal
                    </Button>
                  )}
                  {staff && r.status === "pending" && (
                    <>
                      <Button size="sm" variant="outline" className="h-7 border-sky-200 text-sky-700 hover:bg-sky-50" onClick={() => decide.mutate({ id: r.id, status: "approved" })}>
                        <Check className="h-3.5 w-3.5 mr-1" /> Setuju
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => decide.mutate({ id: r.id, status: "rejected" })}>
                        <X className="h-3.5 w-3.5 mr-1" /> Tolak
                      </Button>
                    </>
                  )}
                  {staff && r.status === "approved" && (
                    <Button size="sm" variant="outline" className="h-7 border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={() => decide.mutate({ id: r.id, status: "paid" })}>
                      <Wallet className="h-3.5 w-3.5 mr-1" /> Tandai Dibayar
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {!rows?.length && <div className="text-center text-slate-500 py-6 text-sm">Belum ada pengajuan</div>}
        </CardContent>
      </Card>
    </div>
  );
}
