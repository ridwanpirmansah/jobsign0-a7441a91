import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import {
  getShopeeStatus,
  previewShopeeOrders,
  importShopeeOrders,
} from "@/lib/shopee.functions";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Download, Eye, RefreshCw, ShoppingBag, Plug } from "lucide-react";
import { Link } from "@tanstack/react-router";

const rupiah = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");

export function ShopeeImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImported?: () => void;
}) {
  const statusFn = useServerFn(getShopeeStatus);
  const previewFn = useServerFn(previewShopeeOrders);
  const importFn = useServerFn(importShopeeOrders);

  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<any[] | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [connected, setConnected] = useState<boolean | null>(null);

  const previewMut = useMutation({
    mutationFn: () => previewFn({ data: { days } }),
    onSuccess: (r: any) => {
      if (!r?.ok) {
        setRows(null);
        toast.error(r?.error ?? "Gagal ambil pesanan Shopee");
        return;
      }
      setRows(r.rows);
      const next: Record<string, boolean> = {};
      for (const row of r.rows) if (!row.already_imported) next[row.order_sn] = true;
      setPicked(next);
      toast.success(`${r.rows.length} pesanan ditemukan`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Gagal ambil pesanan Shopee"),
  });

  const importMut = useMutation({
    mutationFn: (order_sns: string[]) => importFn({ data: { order_sns } }),
    onSuccess: (r: any) => {
      if (r.ok) toast.success(r.message);
      else toast.error(r.message || "Import gagal");
      onImported?.();
      previewMut.mutate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Import gagal"),
  });

  const selected = useMemo(
    () => Object.entries(picked).filter(([, v]) => v).map(([k]) => k),
    [picked],
  );

  const handleOpen = async (v: boolean) => {
    onOpenChange(v);
    if (v && connected === null) {
      try {
        const s: any = await statusFn();
        setConnected(!!s?.connected);
        if (s?.connected) previewMut.mutate();
      } catch {
        setConnected(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-y-auto p-4 sm:p-6 w-[calc(100vw-0.75rem)]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-orange-500" /> Import Orderan Shopee
          </DialogTitle>
        </DialogHeader>

        {connected === false && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
            <Plug className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              Toko Shopee belum terhubung. Hubungkan dulu melalui menu{" "}
              <Link to="/owner/shopee" className="font-semibold underline">
                Integrasi Shopee
              </Link>
              .
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">Rentang hari</Label>
            <Input
              type="number"
              min={1}
              max={90}
              className="w-24"
              value={days}
              onChange={(e) => setDays(Math.min(90, Math.max(1, parseInt(e.target.value) || 7)))}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => previewMut.mutate()}
            disabled={previewMut.isPending || connected !== true}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${previewMut.isPending ? "animate-spin" : ""}`} />
            {previewMut.isPending ? "Memuat..." : "Muat Ulang"}
          </Button>
          <Button
            size="sm"
            onClick={() => importMut.mutate(selected)}
            disabled={importMut.isPending || selected.length === 0}
          >
            <Download className="h-4 w-4 mr-1" />
            {importMut.isPending ? "Mengimport..." : `Import Terpilih (${selected.length})`}
          </Button>
        </div>

        {previewMut.isPending && !rows && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Eye className="h-4 w-4" /> Mengambil daftar pesanan dari Shopee...
          </p>
        )}

        {rows && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Tidak ada pesanan pada {days} hari terakhir.
          </p>
        )}

        {rows && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.order_sn} className="flex gap-3 items-start rounded-lg border p-3">
                <Checkbox
                  className="mt-1"
                  checked={!!picked[r.order_sn]}
                  onCheckedChange={(v) => setPicked((m) => ({ ...m, [r.order_sn]: !!v }))}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium truncate">{r.product}</span>
                    {r.already_imported && (
                      <Badge variant="secondary">
                        Sudah diimport{r.order_no ? ` · #${r.order_no}` : ""}
                      </Badge>
                    )}
                    <Badge variant="outline">{r.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 break-all">
                    {r.order_sn} · {r.buyer || "-"} · {r.kota || "-"} · {r.co_date ?? "-"}
                  </p>
                  <p className="text-xs mt-1">
                    {rupiah(r.total)}{" "}
                    <span className="text-muted-foreground">(penghasilan akhir)</span>
                    {r.ekspedisi ? ` · ${r.ekspedisi}` : ""}
                    {r.no_resi ? ` · ${r.no_resi}` : ""}
                    {r.deadline ? ` · DL: ${r.deadline}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
