import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, X, SlidersHorizontal, Wrench } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/approvals")({ component: ApprovalsPage });

function fmtIDR(n: number) { return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0); }

type JobLogRow = {
  id: string;
  log_date: string;
  qty: number;
  amount: number;
  note: string | null;
  status: string;
  is_repair: boolean | null;
  repair_reason: string | null;
  employee?: { full_name: string; employee_code: string } | null;
  project?: { code: string; title: string } | null;
  rate?: { name: string; unit: string; rate_per_unit: number } | null;
  order?: { order_no: string; text_neon: string } | null;
};

function ApprovalsPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const [partialOpen, setPartialOpen] = useState(false);
  const [partialLog, setPartialLog] = useState<JobLogRow | null>(null);
  const [partialQty, setPartialQty] = useState("");
  const [partialAmount, setPartialAmount] = useState("");

  const { data: logs } = useQuery({
    queryKey: ["pending-logs"],
    queryFn: async () => (await supabase.from("job_logs")
      .select("*, employee:employees(full_name,employee_code), project:projects(code,title), rate:job_rates(name,unit,rate_per_unit), order:orders!source_order_id(order_no,text_neon)")
      .eq("status", "pending").order("created_at", { ascending: false })).data as unknown as JobLogRow[] ?? [],
  });

  const decide = useMutation({
    mutationFn: async (args: { id: string; status: "approved" | "rejected"; qty?: number; amount?: number }) => {
      const { error } = await supabase.rpc("approve_job_log", {
        _id: args.id,
        _status: args.status,
        _qty: args.qty ?? undefined,
        _amount: args.amount ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Status diperbarui");
      qc.invalidateQueries({ queryKey: ["pending-logs"] });
      setPartialOpen(false);
      setPartialLog(null);
      setPartialQty(""); setPartialAmount("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openPartial = (l: JobLogRow) => {
    setPartialLog(l);
    setPartialQty(String(l.qty));
    setPartialAmount("");
    setPartialOpen(true);
  };

  const submitPartial = () => {
    if (!partialLog) return;
    const qty = Number(partialQty);
    if (!qty || qty <= 0) { toast.error("Qty harus lebih dari 0"); return; }
    const amt = partialAmount.trim() === "" ? undefined : Number(partialAmount);
    if (amt !== undefined && (isNaN(amt) || amt < 0)) { toast.error("Nominal tidak valid"); return; }
    decide.mutate({ id: partialLog.id, status: "approved", qty, amount: amt });
  };

  if (!isStaff(me?.role)) return <p className="text-sm text-slate-500">Akses ditolak.</p>;

  return (
    <div className="space-y-6 max-w-7xl">
      <div><h1 className="text-2xl font-bold text-slate-900">Approval Job Log</h1><p className="text-sm text-slate-500">Tinjau laporan garapan & klaim reparasi karyawan</p></div>
      <Card>
        <CardHeader><CardTitle className="text-base">Antrian ({logs?.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {/* Mobile cards */}
          <div className="md:hidden space-y-3 p-3">
            {logs?.map((l) => (
              <div key={l.id} className={`rounded-xl border p-3 shadow-sm space-y-2 ${l.is_repair ? "border-orange-200 bg-orange-50/40" : "border-slate-200 bg-white"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {l.is_repair && <Badge className="bg-orange-500 text-white text-[10px]"><Wrench className="h-3 w-3 mr-0.5" />Reparasi</Badge>}
                      <span className="font-semibold text-slate-900 truncate">{l.employee?.full_name}</span>
                    </div>
                    <div className="text-xs text-slate-500">{format(new Date(l.log_date), "EEE, dd MMM yyyy", { locale: idLocale })}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-slate-900">{fmtIDR(Number(l.amount))}</div>
                    <div className="text-xs text-slate-500">{l.qty} × {l.rate?.unit}</div>
                  </div>
                </div>
                {l.is_repair && l.order && (
                  <div className="text-xs leading-tight rounded-md bg-orange-100/60 px-2 py-1.5">
                    <span className="text-orange-700 font-medium">Order #{l.order.order_no}</span> · <span className="text-slate-800">{l.order.text_neon}</span>
                  </div>
                )}
                {!l.is_repair && l.project && (
                  <div className="text-xs leading-tight rounded-md bg-slate-50 px-2 py-1.5">
                    <span className="font-mono text-slate-500">{l.project.code}</span> · <span className="font-medium text-slate-800">{l.project.title}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">{l.rate?.name}</Badge>
                </div>
                {(l.repair_reason || l.note) && (
                  <div className="text-xs text-slate-600 italic border-t border-dashed border-slate-200 pt-2">"{l.repair_reason || l.note}"</div>
                )}
                <div className="flex gap-1 flex-wrap">
                  <Button size="sm" variant="outline" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={() => decide.mutate({ id: l.id, status: "approved" })}>
                    <Check className="h-4 w-4 mr-1" /> Setuju
                  </Button>
                  <Button size="sm" variant="outline" className="border-amber-200 text-amber-700 hover:bg-amber-50" onClick={() => openPartial(l)}>
                    <SlidersHorizontal className="h-4 w-4 mr-1" /> Sebagian
                  </Button>
                  <Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => decide.mutate({ id: l.id, status: "rejected" })}>
                    <X className="h-4 w-4 mr-1" /> Tolak
                  </Button>
                </div>
              </div>
            ))}
            {!logs?.length && <div className="text-center py-8"><Badge variant="secondary">Tidak ada antrian</Badge></div>}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>Karyawan</TableHead><TableHead>Jenis</TableHead><TableHead>Project / Order</TableHead><TableHead>Tarif</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Upah</TableHead><TableHead>Catatan</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow></TableHeader>
              <TableBody>
                {logs?.map((l) => (
                  <TableRow key={l.id} className={l.is_repair ? "bg-orange-50/40" : ""}>
                    <TableCell>{format(new Date(l.log_date), "EEE, dd MMM", { locale: idLocale })}</TableCell>
                    <TableCell className="font-medium">{l.employee?.full_name}</TableCell>
                    <TableCell>
                      {l.is_repair
                        ? <Badge className="bg-orange-500 text-white"><Wrench className="h-3 w-3 mr-1" />Reparasi</Badge>
                        : <Badge variant="outline">Garapan</Badge>}
                    </TableCell>
                    <TableCell>
                      {l.is_repair && l.order ? (
                        <div className="leading-tight">
                          <div className="text-xs text-orange-700 font-mono">#{l.order.order_no}</div>
                          <div className="font-medium text-slate-900">{l.order.text_neon}</div>
                        </div>
                      ) : l.project ? (
                        <div className="leading-tight">
                          <div className="font-mono text-xs text-slate-500">{l.project.code}</div>
                          <div className="font-medium text-slate-900">{l.project.title}</div>
                        </div>
                      ) : "—"}
                    </TableCell>
                    <TableCell>{l.rate?.name}</TableCell>
                    <TableCell className="text-right">{l.qty}</TableCell>
                    <TableCell className="text-right font-medium">{fmtIDR(Number(l.amount))}</TableCell>
                    <TableCell className="text-xs text-slate-500 max-w-xs truncate">{l.repair_reason || l.note || ""}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" title="Setuju penuh" onClick={() => decide.mutate({ id: l.id, status: "approved" })}><Check className="h-4 w-4 text-emerald-600" /></Button>
                      <Button size="sm" variant="ghost" title="Setujui sebagian" onClick={() => openPartial(l)}><SlidersHorizontal className="h-4 w-4 text-amber-600" /></Button>
                      <Button size="sm" variant="ghost" title="Tolak" onClick={() => decide.mutate({ id: l.id, status: "rejected" })}><X className="h-4 w-4 text-red-600" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!logs?.length && <TableRow><TableCell colSpan={9} className="text-center py-8 text-slate-500"><Badge variant="secondary">Tidak ada antrian</Badge></TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={partialOpen} onOpenChange={setPartialOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Setujui Sebagian</DialogTitle>
            <DialogDescription>
              Sesuaikan qty dan/atau nominal upah final. Kosongkan nominal jika mau dihitung otomatis (qty × tarif).
            </DialogDescription>
          </DialogHeader>
          {partialLog && (
            <div className="space-y-3">
              <div className="rounded-md bg-slate-50 p-2 text-xs leading-tight">
                <div><span className="text-slate-500">Karyawan:</span> <span className="font-medium">{partialLog.employee?.full_name}</span></div>
                <div><span className="text-slate-500">Tarif:</span> {partialLog.rate?.name} ({fmtIDR(Number(partialLog.rate?.rate_per_unit || 0))}/{partialLog.rate?.unit})</div>
                <div><span className="text-slate-500">Qty awal:</span> {partialLog.qty} · <span className="text-slate-500">Upah awal:</span> {fmtIDR(Number(partialLog.amount))}</div>
              </div>
              <div>
                <Label>Qty Disetujui</Label>
                <Input type="number" step="0.01" min="0" value={partialQty} onChange={(e) => setPartialQty(e.target.value)} />
              </div>
              <div>
                <Label>Override Nominal Upah (opsional)</Label>
                <Input type="number" step="1" min="0" placeholder="Kosongkan untuk auto" value={partialAmount} onChange={(e) => setPartialAmount(e.target.value)} />
                {partialAmount.trim() === "" && partialLog.rate && (
                  <p className="text-xs mt-1 text-slate-500">Akan dihitung: {fmtIDR((Number(partialQty) || 0) * Number(partialLog.rate.rate_per_unit))}</p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPartialOpen(false)}>Batal</Button>
            <Button className="bg-emerald-500 hover:bg-emerald-600 text-white" onClick={submitPartial} disabled={decide.isPending}>
              <Check className="h-4 w-4 mr-1" /> Setujui Sebagian
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
