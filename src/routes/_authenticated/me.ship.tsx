import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { markReadyPickupByResi } from "@/lib/orders.functions";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ResiScanner } from "@/components/ResiScanner";
import { PackageCheck, ScanLine, Truck } from "lucide-react";
import { toast } from "sonner";
import { beepSuccess, beepError } from "@/lib/scan-feedback";

export const Route = createFileRoute("/_authenticated/me/ship")({
  component: ShipPage,
  head: () => ({ meta: [{ title: "Scan Siap Kirim" }] }),
});

function ShipPage() {
  const { data: me, isLoading } = useCurrentUser();
  const qc = useQueryClient();
  const mark = useServerFn(markReadyPickupByResi);
  const [manual, setManual] = useState("");
  const [history, setHistory] = useState<{ order_no: string; no_resi: string; ekspedisi: string | null; ts: number }[]>([]);

  const mut = useMutation({
    mutationFn: (no_resi: string) => mark({ data: { no_resi } }),
    onSuccess: (res) => {
      beepSuccess();
      toast.success(`#${res.order_no} ditandai siap kirim${res.ekspedisi ? ` (${res.ekspedisi})` : ""}`);
      setHistory((h) => [{ order_no: res.order_no, no_resi: res.no_resi, ekspedisi: res.ekspedisi, ts: Date.now() }, ...h].slice(0, 20));
      setManual("");
      qc.invalidateQueries({ queryKey: ["pickup-ready"] });
    },
    onError: (e: Error) => { beepError(); toast.error(e.message); },
  });

  if (isLoading) return <p className="p-4 text-sm text-slate-500">Memuat…</p>;
  if (!me || !isStaff(me.role)) {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardHeader><CardTitle>Akses ditolak</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-slate-500">Halaman ini hanya untuk staff workshop.</p></CardContent>
      </Card>
    );
  }

  return (
    <div className="p-0 sm:p-4 space-y-3 sm:space-y-5 max-w-4xl">
      <div className="flex items-center gap-2 px-3 sm:px-0 pt-3 sm:pt-0">

        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white shadow">
          <ScanLine className="h-5 w-5"/>
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Scan Siap Kirim</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Scan barcode pada resi paket untuk menandai paket siap dipickup kurir.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Truck className="h-4 w-4"/> Scan Barcode Resi</CardTitle></CardHeader>
        <CardContent>
          <ResiScanner onScan={(t) => { if (!mut.isPending) mut.mutate(t); }} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Input Manual</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>No Resi</Label>
            <Input
              autoFocus placeholder="Ketik atau tempel nomor resi"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && manual.trim()) mut.mutate(manual.trim()); }}
              className="text-base font-mono"
            />
          </div>
          <Button className="w-full" disabled={!manual.trim() || mut.isPending} onClick={() => mut.mutate(manual.trim())}>
            <PackageCheck className="h-4 w-4 mr-2"/> Tandai Siap Kirim
          </Button>
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Baru Ditandai</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {history.map((h, i) => (
              <div key={i} className="flex items-center justify-between border rounded-md px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-mono text-xs text-muted-foreground">#{h.order_no} · {h.ekspedisi || "—"}</div>
                  <div className="font-mono text-emerald-700 truncate">{h.no_resi}</div>
                </div>
                <div className="text-xs text-muted-foreground">{new Date(h.ts).toLocaleTimeString("id-ID")}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
