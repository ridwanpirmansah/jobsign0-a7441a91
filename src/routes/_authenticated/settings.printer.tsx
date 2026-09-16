import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bluetooth, Printer, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isThermalPrintSupported, printTestThermal, setPrinterSettingsCache } from "@/lib/thermal-print";
import {
  DEFAULT_PRINTER_SETTINGS,
  getPrinterSettings,
  updatePrinterSettings,
  type PrinterSettings,
} from "@/lib/printer-settings.functions";

export const Route = createFileRoute("/_authenticated/settings/printer")({
  component: PrinterSettingsPage,
  head: () => ({ meta: [
    { title: "Pengaturan Printer | Neon Workflow" },
    { name: "description", content: "Atur ukuran dan kualitas cetak printer Bluetooth untuk seluruh pengguna." },
    { property: "og:title", content: "Pengaturan Printer | Neon Workflow" },
    { property: "og:description", content: "Atur ukuran dan kualitas cetak printer Bluetooth untuk seluruh pengguna." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
});

function PrinterSettingsPage() {
  const queryClient = useQueryClient();
  const { data = DEFAULT_PRINTER_SETTINGS, isLoading } = useQuery({
    queryKey: ["printer-settings"],
    queryFn: () => getPrinterSettings(),
  });
  const [settings, setSettings] = useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS);
  const [customMm, setCustomMm] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setSettings(data);
    setPrinterSettingsCache(data);
    setCustomMm(![58, 80].includes(data.widthMm) ? String(data.widthMm) : "");
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => updatePrinterSettings({ data: settings }),
    onSuccess: (saved) => {
      setPrinterSettingsCache(saved);
      queryClient.setQueryData(["printer-settings"], saved);
      toast.success("Pengaturan printer berlaku untuk seluruh pengguna");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const preset = settings.widthMm === 58 ? "58" : settings.widthMm === 80 ? "80" : "custom";
  const update = (patch: Partial<PrinterSettings>) => setSettings((current) => ({ ...current, ...patch }));

  const choosePreset = (value: string) => {
    if (value === "58") update({ widthMm: 58, paperDots: settings.dots58, contentDots: Math.min(settings.contentDots || settings.dots58, settings.dots58) });
    else if (value === "80") update({ widthMm: 80, paperDots: settings.dots80, contentDots: Math.min(settings.contentDots || settings.dots80, settings.dots80) });
    else update({ widthMm: Math.max(30, Math.min(120, Math.round(Number(customMm) || 76))) });
  };

  const applyCustom = () => {
    const widthMm = Math.round(Number(customMm));
    if (widthMm < 30 || widthMm > 120) return toast.error("Ukuran kertas harus 30–120 mm");
    update({ widthMm });
  };

  const runTest = async () => {
    if (!isThermalPrintSupported()) return toast.error("Bluetooth cetak hanya didukung Chrome/Edge di Android");
    setTesting(true);
    try {
      setPrinterSettingsCache(settings);
      await printTestThermal();
      toast.success("Perintah cetak terkirim — periksa printer");
    } catch (error: any) {
      toast.error(error?.message ?? "Gagal mencetak");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="edge-to-edge max-w-2xl space-y-3 p-0 sm:space-y-5 sm:p-4">
      <div className="flex items-center gap-2 px-3 pt-3 sm:px-0 sm:pt-0">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground shadow">
          <Bluetooth className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">Pengaturan Printer</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">Pengaturan ini berlaku untuk semua pengguna.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Printer className="h-4 w-4" /> Ukuran Kertas</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Jenis kertas</Label>
            <Select value={preset} onValueChange={choosePreset} disabled={isLoading}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="58">58 mm — area cetak 384 titik</SelectItem>
                <SelectItem value="80">80 mm — area cetak 576 titik</SelectItem>
                <SelectItem value="custom">Ukuran lain</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {preset === "custom" && (
            <div>
              <Label>Lebar kertas (mm)</Label>
              <div className="mt-1 flex gap-2">
                <Input type="number" min={30} max={120} value={customMm} onChange={(event) => setCustomMm(event.target.value)} className="max-w-[140px]" />
                <Button variant="outline" onClick={applyCustom}>Terapkan</Button>
              </div>
            </div>
          )}
          <div>
            <Label>Kepekatan cetak</Label>
            <Select value={String(settings.density)} onValueChange={(value) => update({ density: Number(value) as 1 | 2 | 3 })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Terang</SelectItem><SelectItem value="2">Normal</SelectItem><SelectItem value="3">Gelap</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            Resi dicetak sebagai gambar tetap dengan batas aman {settings.insetDots} titik agar sisi kanan tidak terpotong.
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button onClick={() => saveMutation.mutate()} disabled={isLoading || saveMutation.isPending}>
              <Save className="mr-1 h-4 w-4" /> {saveMutation.isPending ? "Menyimpan..." : "Simpan untuk Semua"}
            </Button>
            <Button variant="outline" onClick={runTest} disabled={testing || isLoading}>
              <Bluetooth className="mr-1 h-4 w-4" /> {testing ? "Mengirim..." : "Tes Cetak"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Cara pakai</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. Pilih ukuran kertas, lalu simpan untuk semua pengguna.</p>
          <p>2. Nyalakan Bluetooth ponsel dan printer.</p>
          <p>3. Tekan Tes Cetak dan pilih printer saat daftar Bluetooth muncul.</p>
          <p className="text-xs">Cetak langsung tersedia di Chrome/Edge Android. Tombol Download tetap dapat dipakai sebagai alternatif.</p>
        </CardContent>
      </Card>
    </div>
  );
}