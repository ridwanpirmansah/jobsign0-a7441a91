import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, Utensils, Lock, Wallet, CreditCard, Save } from "lucide-react";
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
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "cashbon">("cashbon");
  const [allowanceOverride, setAllowanceOverride] = useState<string>("");
  const [filterEmp, setFilterEmp] = useState<string>("all");
  const [allowanceInput, setAllowanceInput] = useState<string>("");

  const { data: employees } = useQuery({
    enabled: staff,
    queryKey: ["employees-active-list"],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("id, full_name, employee_code").eq("active", true).order("full_name");
      return data ?? [];
    },
  });

  const { data: allowanceSetting } = useQuery({
    enabled: staff,
    queryKey: ["meal-allowance"],
    queryFn: async () => {
      const { data } = await supabase.from("material_prices").select("value").eq("key", "meal_allowance_per_person").maybeSingle();
      return Number(data?.value ?? 5000);
    },
  });

  useEffect(() => {
    if (allowanceSetting !== undefined && allowanceInput === "") setAllowanceInput(String(allowanceSetting));
  }, [allowanceSetting, allowanceInput]);

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
      pending: r.filter(x => !x.deducted).reduce((s, x) => s + Number(x.employee_charge ?? 0), 0),
      deducted: r.filter(x => x.deducted).reduce((s, x) => s + Number(x.employee_charge ?? 0), 0),
      companyExpense: r.reduce((s, x) => s + Number(x.company_covered ?? 0), 0),
    };
  }, [rows]);

  const effectiveAllowance = Number(allowanceOverride) > 0 ? Number(allowanceOverride) : Number(allowanceSetting ?? 5000);
  const previewAmt = Number(amount) || 0;
  const previewCompany = Math.min(previewAmt, effectiveAllowance);
  const previewCharge = paymentMethod === "cash" ? 0 : Math.max(0, previewAmt - effectiveAllowance);

  const saveAllowance = useMutation({
    mutationFn: async () => {
      const v = Number(allowanceInput);
      if (!Number.isFinite(v) || v < 0) throw new Error("Nominal jatah tidak valid");
      const { error } = await supabase.from("material_prices").update({ value: v }).eq("key", "meal_allowance_per_person");
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Uang makan diperbarui"); qc.invalidateQueries({ queryKey: ["meal-allowance"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!employeeId) throw new Error("Pilih karyawan terlebih dahulu");
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Nominal Total harus lebih dari 0");

      const emp = employees?.find(e => e.id === employeeId);
      const empName = emp?.full_name ?? "Karyawan";
      const allowance = effectiveAllowance;
      const companyCovered = Math.min(amt, allowance);
      const employeeCharge = paymentMethod === "cash" ? 0 : Math.max(0, amt - allowance);

      // 1) Buat catatan pengeluaran perusahaan untuk bagian yang ditanggung
      let expenseId: string | null = null;
      if (companyCovered > 0) {
        const desc = `Uang makan ${empName}${note ? ` — ${note}` : ""}`;
        const { data: exp, error: expErr } = await supabase.from("expenses").insert({
          expense_date: date,
          category: "operasional",
          amount: companyCovered,
          description: desc,
          note: `Konsumsi karyawan (${paymentMethod === "cash" ? "Cash" : "Cashbon"})`,
          affects_pnl: true,
          payment_status: paymentMethod === "cash" ? "lunas" : "lunas",
        }).select("id").maybeSingle();
        if (expErr) throw expErr;
        expenseId = exp?.id ?? null;
      }

      // 2) Kalau cashbon dan ada tagihan karyawan → buat cashbon (langsung approved)
      let cashbonId: string | null = null;
      if (paymentMethod === "cashbon" && employeeCharge > 0) {
        const { data: cb, error: cbErr } = await supabase.from("cashbon").insert({
          employee_id: employeeId,
          amount: employeeCharge,
          note: `Konsumsi ${format(new Date(date), "dd MMM", { locale: idLocale })}: ${note || "makan"}`,
          status: "approved",
          request_date: date,
          decided_by: me!.user.id,
          decided_at: new Date().toISOString(),
        }).select("id").maybeSingle();
        if (cbErr) throw cbErr;
        cashbonId = cb?.id ?? null;
      }

      // 3) Simpan catatan konsumsi dengan tautan
      const { error } = await supabase.from("employee_consumption").insert({
        employee_id: employeeId,
        consumption_date: date,
        amount: amt,
        note: note || null,
        created_by: me!.user.id,
        payment_method: paymentMethod,
        allowance_applied: allowance,
        expense_id: expenseId,
        cashbon_id: cashbonId,
      });
      if (error) {
        // rollback linked rows kalau gagal
        if (cashbonId) await supabase.from("cashbon").delete().eq("id", cashbonId);
        if (expenseId) await supabase.from("expenses").delete().eq("id", expenseId);
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Catatan konsumsi ditambahkan");
      setAmount(""); setNote(""); setAllowanceOverride("");
      qc.invalidateQueries({ queryKey: ["consumption"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["cashbon"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (row: { id: string; expense_id: string | null; cashbon_id: string | null }) => {
      if (row.cashbon_id) await supabase.from("cashbon").delete().eq("id", row.cashbon_id);
      if (row.expense_id) await supabase.from("expenses").delete().eq("id", row.expense_id);
      const { error } = await supabase.from("employee_consumption").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Catatan dihapus");
      qc.invalidateQueries({ queryKey: ["consumption"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["cashbon"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!staff) return <p className="text-sm text-slate-500">Akses ditolak. Hanya admin/owner.</p>;

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Utensils className="h-6 w-6 text-orange-600" /> Konsumsi Karyawan
        </h1>
        <p className="text-sm text-slate-500">Perusahaan menanggung sebagian (uang makan); sisanya ditagihkan ke karyawan bila metode Cashbon</p>
      </div>

      <Card className="border-sky-200 bg-sky-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-sky-900">
            <Wallet className="h-4 w-4" /> Uang Makan Karyawan (per konsumsi)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-2">
            <div className="flex-1 max-w-xs">
              <Label className="text-xs">Nominal jatah default</Label>
              <Input type="number" inputMode="numeric" value={allowanceInput} onChange={(e) => setAllowanceInput(e.target.value)} />
            </div>
            <Button size="sm" variant="outline" onClick={() => saveAllowance.mutate()} disabled={saveAllowance.isPending}>
              <Save className="h-4 w-4 mr-1" /> Simpan
            </Button>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Contoh: 5.000. Nilai ini otomatis dipakai saat mencatat konsumsi baru, dan bisa dioverride per catatan.</p>
        </CardContent>
      </Card>

      <div className="grid gap-3 grid-cols-3">
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-slate-500">Belum Ditagih Karyawan</div><div className="text-base sm:text-xl font-bold text-amber-600">{fmtIDR(totals.pending)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-slate-500">Sudah Dipotong</div><div className="text-base sm:text-xl font-bold text-emerald-600">{fmtIDR(totals.deducted)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-slate-500">Beban Perusahaan (total)</div><div className="text-base sm:text-xl font-bold text-sky-600">{fmtIDR(totals.companyExpense)}</div></CardContent></Card>
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
              <Label>Nominal Total (Rp)</Label>
              <Input type="number" inputMode="numeric" placeholder="25000" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>Metode Pembayaran</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as "cash" | "cashbon")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cashbon"><span className="inline-flex items-center gap-2"><CreditCard className="h-3.5 w-3.5" /> Cashbon (dibayar perusahaan → tagihkan sisa)</span></SelectItem>
                  <SelectItem value="cash"><span className="inline-flex items-center gap-2"><Wallet className="h-3.5 w-3.5" /> Cash (karyawan bayar sendiri)</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Uang Makan yang Berlaku (opsional override)</Label>
              <Input type="number" inputMode="numeric" placeholder={`Default: ${fmtIDR(Number(allowanceSetting ?? 5000))}`} value={allowanceOverride} onChange={(e) => setAllowanceOverride(e.target.value)} />
            </div>
            <div>
              <Label>Catatan (Nasi padang, Kopi, dst)</Label>
              <Input placeholder="Nasi padang + es teh" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          {previewAmt > 0 && (
            <div className="rounded-lg border border-orange-200 bg-white p-3 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-slate-600">Uang makan berlaku</span><span className="font-medium">{fmtIDR(effectiveAllowance)}</span></div>
              <div className="flex justify-between"><span className="text-sky-700">→ Ditanggung perusahaan</span><span className="font-bold text-sky-700">{fmtIDR(previewCompany)}</span></div>
              <div className="flex justify-between">
                <span className={paymentMethod === "cash" ? "text-slate-500 line-through" : "text-amber-700"}>
                  → Ditagihkan karyawan {paymentMethod === "cash" ? "(cash: karyawan bayar sendiri)" : "(via cashbon)"}
                </span>
                <span className={`font-bold ${paymentMethod === "cash" ? "text-slate-500" : "text-amber-700"}`}>{fmtIDR(previewCharge)}</span>
              </div>
            </div>
          )}

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
            const isCash = r.payment_method === "cash";
            const tone = done
              ? { chip: "bg-emerald-100 text-emerald-700 border-emerald-200", stripe: "bg-emerald-400", bg: "from-emerald-50/60" }
              : isCash
                ? { chip: "bg-slate-100 text-slate-700 border-slate-200", stripe: "bg-slate-400", bg: "from-slate-50/60" }
                : { chip: "bg-amber-100 text-amber-800 border-amber-200", stripe: "bg-amber-400", bg: "from-amber-50/60" };
            return (
              <div key={r.id} className={`relative overflow-hidden rounded-lg border border-slate-200/70 bg-gradient-to-br ${tone.bg} to-white px-3 py-2.5 pl-3.5`}>
                <span className={`absolute left-0 top-0 h-full w-1 ${tone.stripe}`} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900 truncate text-sm">{r.employee?.full_name}</div>
                    <div className="text-[11px] text-slate-500">{format(new Date(r.consumption_date), "EEE, dd MMM yyyy", { locale: idLocale })} · <span className="uppercase font-medium">{isCash ? "Cash" : "Cashbon"}</span></div>
                    {r.note && <div className="text-xs text-slate-700 italic mt-1">"{r.note}"</div>}
                    <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px]">
                      <div><div className="text-slate-500">Total</div><div className="font-semibold">{fmtIDR(Number(r.amount))}</div></div>
                      <div><div className="text-sky-600">Perusahaan</div><div className="font-semibold text-sky-700">{fmtIDR(Number(r.company_covered ?? 0))}</div></div>
                      <div><div className={isCash ? "text-slate-400" : "text-amber-700"}>Karyawan</div><div className={`font-semibold ${isCash ? "text-slate-500" : "text-amber-700"}`}>{fmtIDR(Number(r.employee_charge ?? 0))}</div></div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge variant="outline" className={`text-[10px] uppercase ${tone.chip}`}>
                      {done ? <><Lock className="h-2.5 w-2.5 mr-1" /> Dipotong</> : isCash ? "Cash" : "Belum dipotong"}
                    </Badge>
                  </div>
                </div>
                {!done && (
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" variant="ghost" className="h-7 text-rose-600" onClick={() => remove.mutate({ id: r.id, expense_id: r.expense_id, cashbon_id: r.cashbon_id })}>
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
