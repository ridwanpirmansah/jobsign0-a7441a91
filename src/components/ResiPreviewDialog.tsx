import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { printResiPdf, generateBarcodeDataUrl, type ResiPayload } from "@/lib/resi-pdf";
import { printResiThermal, printPdfUrlThermal, isThermalPrintSupported } from "@/lib/thermal-print";

export type ResiPreviewPayload = ResiPayload & { order_id?: string; is_shopee?: boolean };

/** Dialog preview resi (manual & Shopee) dengan tombol Download + Cetak termal Bluetooth. */
export function ResiPreviewDialog({
  payload,
  onClose,
}: {
  payload: ResiPreviewPayload | null;
  onClose: () => void;
}) {
  const [barcodeUrl, setBarcodeUrl] = useState<string | null>(null);
  const [shopeeUrl, setShopeeUrl] = useState<string | null>(null);
  const [shopeeErr, setShopeeErr] = useState<string | null>(null);
  const [loadingShopee, setLoadingShopee] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (payload?.no_resi) {
      setBarcodeUrl(generateBarcodeDataUrl(payload.no_resi));
    } else {
      setBarcodeUrl(null);
    }
  }, [payload]);

  useEffect(() => {
    let revoke: string | null = null;
    setShopeeUrl(null);
    setShopeeErr(null);
    if (payload?.is_shopee && payload.order_id) {
      setLoadingShopee(true);
      import("@/lib/shopee-label")
        .then((m) => m.fetchShopeeLabelUrl(payload.order_id!))
        .then((url) => {
          revoke = url;
          setShopeeUrl(url);
        })
        .catch((e: any) => setShopeeErr(e?.message ?? "Gagal mengambil resi Shopee"))
        .finally(() => setLoadingShopee(false));
    }
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [payload?.order_id, payload?.is_shopee]);

  if (!payload) return null;
  const tgl = payload.co_date
    ? new Date(payload.co_date).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
    : "-";

  const printThermal = async (fn: () => Promise<void>) => {
    if (!isThermalPrintSupported()) {
      toast.error("Bluetooth cetak hanya didukung Chrome/Edge di Android — gunakan Download sebagai alternatif");
      return;
    }
    setPrinting(true);
    try {
      await fn();
      toast.success("Perintah cetak terkirim — periksa printer");
    } catch (e: any) {
      toast.error(e?.message ?? "Gagal mencetak ke printer Bluetooth");
    } finally {
      setPrinting(false);
    }
  };

  if (payload.is_shopee) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Resi Shopee</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {loadingShopee && <p className="text-sm text-muted-foreground">Mengambil resi dari Shopee...</p>}
            {shopeeErr && <p className="text-sm text-destructive">{shopeeErr}</p>}
            {shopeeUrl && (
              <>
                <iframe src={shopeeUrl} title="Resi Shopee" className="h-[60vh] w-full rounded-lg border" />
                <div className="flex gap-2">
                  <Button asChild variant="outline" className="flex-1 gap-2">
                    <a href={shopeeUrl} download={`resi-shopee-${payload.no_resi || payload.order_no || "label"}.pdf`}>
                      <Download className="h-4 w-4" /> Download
                    </a>
                  </Button>
                  <Button
                    className="flex-1 gap-2"
                    disabled={printing}
                    onClick={() => printThermal(() => printPdfUrlThermal(shopeeUrl))}
                  >
                    <Printer className="h-4 w-4" /> {printing ? "Mencetak..." : "Cetak"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={!!payload} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Preview Resi</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-xl border border-slate-300 bg-white p-3 text-[8px] shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-300 pb-1">
              <span className="font-bold text-[10px]">FUJI ELECTRIC</span>
              <span className="text-[7px] text-slate-500">NEON SIGN WORKSHOP</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[9px] font-bold">
              <span>{(payload.ekspedisi || "REGULER").toUpperCase()}</span>
              <span className="font-normal text-slate-600">Tgl: {tgl}</span>
            </div>
            {barcodeUrl ? (
              <img src={barcodeUrl} alt="barcode" className="mx-auto my-1 h-12 object-contain" />
            ) : (
              <div className="my-1 h-12 bg-slate-100" />
            )}
            <div className="text-center font-mono text-[10px] font-bold">{payload.no_resi}</div>
            <div className="my-1 border-t border-slate-300" />
            <div className="text-[7px] font-bold text-slate-500">PENGIRIM</div>
            <div className="flex items-center justify-between text-[8px]">
              <span className="font-bold">Fuji Electric</span>
              <span>0877-7980-3435</span>
            </div>
            <div className="text-[8px]">Tasikmalaya</div>
            <div className="my-1 border-t border-slate-300" />
            <div className="text-[7px] font-bold text-slate-500">PENERIMA</div>
            <div className="flex items-center justify-between text-[9px] font-bold">
              <span>{payload.username || "-"}</span>
              <span className="font-normal text-[8px]">{payload.phone || ""}</span>
            </div>
            <div className="text-[8px]">{payload.kota || "-"}</div>
            <div className="my-1 border-t border-slate-300" />
            <div className="text-[7px] font-bold text-slate-500">DETAIL</div>
            <div className="text-[8px]">Neon: {payload.text_neon || "-"}</div>
            <div className="text-[7px] text-slate-500">No. Order: {payload.order_no || "-"}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 gap-2" onClick={() => printResiPdf(payload)}>
              <Download className="h-4 w-4" /> Download
            </Button>
            <Button
              className="flex-1 gap-2"
              disabled={printing}
              onClick={() => printThermal(() => printResiThermal(payload))}
            >
              <Printer className="h-4 w-4" /> {printing ? "Mencetak..." : "Cetak"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
