import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Wrench, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/me/repairs")({ component: MyRepairs });

function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
}

function MyRepairs() {
  const { data: me } = useCurrentUser();
  const staff = isStaff(me?.role);
  const qc = useQueryClient();

  const [onBehalfEmpId, setOnBehalfEmpId] = useState<string>("");
  const [orderId, setOrderId] = useState<string>("");
  const [rateId, setRateId] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  const effectiveEmpId = staff && onBehalfEmpId ? onBehalfEmpId : me?.employee?.id;

  const { data: employees } = useQuery({
    enabled: staff,
    queryKey: ["employees-active-all"],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("id, full_name, type").eq("active", true).order("full_name");
      return data ?? [];
    },
  });

  const { data: orders } = useQuery({
    queryKey: ["repairable-orders"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_repairable_orders");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; order_no: string; text_neon: string; username: string | null; kota: string | null; status: string; project_id: string | null }>;
    },
  });

  const { data: rates } = useQuery({
    queryKey: ["rates-active"],
    queryFn: async () => {
      const { data } = await supabase.from("job_rates").select("*").eq("active", true).order("name");
      return data ?? [];
    },
  });

  const { data: logs } = useQuery({
    enabled: !!effectiveEmpId,
    queryKey: ["my-repair-logs", effectiveEmpId],
    queryFn: async () => {
      const { data } = await supabase.from("job_logs")
        .select("*, rate:job_rates(name,unit,rate_per_unit), order:orders!source_order_id(order_no,text_neon)")
        .eq("employee_id", effectiveEmpId!)
        .eq("is_repair", true)
        .order("log_date", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const selectedOrder = orders?.find((o) => o.id === orderId);
  const selectedRate = rates?.find((r) => r.id === rateId);
  const qtyNum = Number(qty) || 0;
  const preview = selectedRate ? qtyNum * Number(selectedRate.rate_per_unit) : 0;

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!effectiveEmpId) throw new Error("Pilih karyawan terlebih dahulu");
      if (!orderId) throw new Error("Pilih order asal");
      if (!rateId) throw new Error("Pilih jenis tarif reparasi");
      if (qtyNum <= 0) throw new Error("Qty harus lebih dari 0");
      if (!reason.trim()) throw new Error("Wajib isi alasan/penjelasan kerusakan");
      const { error } = await supabase.from("job_logs").insert({
        employee_id: effectiveEmpId,
        project_id: selectedOrder?.project_id ?? null,
        rate_id: rateId,
        qty: qtyNum,
        note: reason.trim(),
        repair_reason: reason.trim(),
        is_repair: true,
        source_order_id: orderId,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Klaim reparasi terkirim, menunggu approval");
      setOrderId(""); setRateId(""); setQty(""); setReason("");
      qc.invalidateQueries({ queryKey: ["my-repair-logs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("job_logs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Klaim dihapus"); qc.invalidateQueries({ queryKey: ["my-repair-logs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Wrench className="h-6 w-6 text-orange-500" /> Klaim Reparasi
        </h1>
        <p className="text-sm text-slate-500">Catat pekerjaan reparasi untuk order neon sign yang bermasalah. Akan masuk antrian approval.</p>
      </div>

      {staff && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-900">
              <ShieldCheck className="h-4 w-4" /> Mode Admin — Klaim atas nama karyawan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Label>Karyawan</Label>
            <Select value={onBehalfEmpId} onValueChange={setOnBehalfEmpId}>
              <SelectTrigger><SelectValue placeholder={me?.employee ? "Diri sendiri (default)" : "Pilih karyawan"} /></SelectTrigger>
              <SelectContent>
                {me?.employee && <SelectItem value={me.employee.id}>{me.employee.full_name} (saya)</SelectItem>}
                {employees?.filter((e) => e.id !== me?.employee?.id).map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.full_name} {e.type ? `· ${e.type}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Form Klaim Reparasi</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Order Asal yang Direparasi</Label>
            <Select value={orderId} onValueChange={setOrderId}>
              <SelectTrigger><SelectValue placeholder="Pilih order yang bermasalah" /></SelectTrigger>
              <SelectContent>
                {orders?.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    #{o.order_no || "—"} · {o.text_neon} {o.username ? `· ${o.username}` : ""} {o.kota ? `· ${o.kota}` : ""}
                  </SelectItem>
                ))}
                {!orders?.length && <div className="px-2 py-3 text-sm text-slate-500">Belum ada order</div>}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Jenis Tarif Reparasi</Label>
              <Select value={rateId} onValueChange={setRateId}>
                <SelectTrigger><SelectValue placeholder="Pilih tarif" /></SelectTrigger>
                <SelectContent>
                  {rates?.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name} · {fmtIDR(Number(r.rate_per_unit))}/{r.unit}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs mt-1 text-slate-500">Owner dapat menambah tarif khusus reparasi pada menu Tarif Borongan.</p>
            </div>
            <div>
              <Label>Qty</Label>
              <Input type="number" step="0.01" min="0" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
              {selectedRate && (
                <p className="text-xs mt-1 text-slate-500">
                  Estimasi upah: <span className="font-semibold text-slate-900">{fmtIDR(preview)}</span>
                </p>
              )}
            </div>
          </div>

          <div>
            <Label>Penjelasan Kerusakan / Alasan Reparasi <span className="text-rose-500">*</span></Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Jelaskan kerusakan yang diperbaiki..." />
          </div>

          {!effectiveEmpId && (
            <p className="text-xs text-rose-600">
              {staff ? "Pilih karyawan terlebih dahulu." : "Akun Anda belum terhubung ke data karyawan."}
            </p>
          )}

          <div className="flex justify-end">
            <Button
              className="bg-orange-500 hover:bg-orange-600 text-white"
              onClick={() => submitMut.mutate()}
              disabled={submitMut.isPending || !effectiveEmpId}
            >
              <Wrench className="h-4 w-4 mr-1" /> Kirim Klaim Reparasi
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Riwayat Klaim Reparasi</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {logs?.map((l) => (
            <div key={l.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">{format(new Date(l.log_date), "EEE, dd MMM yyyy", { locale: idLocale })}</div>
                  {l.order && (
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      #{l.order.order_no || "—"} · {l.order.text_neon}
                    </div>
                  )}
                  <div className="text-xs text-slate-500">{l.rate?.name} · {l.qty} {l.rate?.unit}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-slate-900">{fmtIDR(Number(l.amount))}</div>
                  <Badge variant={l.status === "approved" ? "default" : l.status === "rejected" ? "destructive" : "secondary"} className="text-[10px]">
                    {l.status}
                  </Badge>
                </div>
              </div>
              {l.repair_reason && <div className="text-xs text-slate-600 italic border-t border-dashed border-slate-200 pt-2">"{l.repair_reason}"</div>}
              {l.status === "pending" && (
                <div className="flex justify-end">
                  <Button size="sm" variant="ghost" onClick={() => deleteMut.mutate(l.id)} className="text-rose-600 hover:text-rose-700">
                    <Trash2 className="h-4 w-4 mr-1" /> Hapus
                  </Button>
                </div>
              )}
            </div>
          ))}
          {!logs?.length && <div className="text-center py-6 text-sm text-slate-500">Belum ada klaim reparasi.</div>}
        </CardContent>
      </Card>
    </div>
  );
}
