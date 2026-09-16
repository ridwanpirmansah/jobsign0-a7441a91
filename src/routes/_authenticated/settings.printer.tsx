import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  getPrinterSettings,
  savePrinterSettings,
  printTestThermal,
  isThermalPrintSupported,
  type PrinterSettings,
} from "@/lib/thermal-print";
import { Bluetooth, Printer, Save } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings/printer")({
  component: PrinterSettingsPage,
  head: () => ({ meta: [{ title: "Pengaturan Printer" }] }),
});

function PrinterSettingsPage() {
  const [settings, setSettings] = useState<PrinterSettings>(() => getPrinterSettings());
  const [customMm, setCustomMm] = useState<string>(
    ![58, 80].includes(getPrinterSettings().widthMm) ? String(getPrinterSettings().widthMm) : ""
  );
  const [testing, setTesting] = useState(false);

  const preset = settings.widthMm === 58 ? "58" : settings.widthMm === 80 ? "80" : "custom";

  const update = (patch: Partial<PrinterSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    savePrinterSettings(next);
  };

  const choosePreset = (v: string) => {
    if (v === "58") update({ widthMm: 58 });
    else if (v === "80") update({ widthMm: 80 });
    else {
      const mm = Math.round(Number(customMm));
      if (mm >= 30 && mm <= 120) update({ widthMm: mm });
      else toast.error("Isi ukuran custom 30–120 mm terlebih dahulu");
    }
  };

  const saveCustom = () => {
    const mm = Math.round(Number(customMm));
    if (mm >= 30 && mm <= 120) update({ widthMm: mm });
    else toast.error("Ukuran kertas harus 30–120 mm");
  };

  const runTest = async () => {
    if (!isThermalPrintSupported()) {
      toast.error("Bluetooth cetak hanya didukung Chrome/Edge di Android");
      return;
    }
    setTesting(true);
    try {
      await printTestThermal();
      toast.success("Perintah cetak terkirim — periksa printer");
    } catch (e: any) {
      toast.error(e?.message ?? "Gagal mencetak");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="edge-to-edge p-0 sm:p-4 space-y-3 sm:space-y-5 max-w-2xl">
      <div className="flex items-center gap-2 px-3 sm:px-0 pt-3 sm:pt-0">
        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 grid place-items-center text-white shadow">
          <Bluetooth className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Pengaturan Printer</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Atur printer termal Bluetooth untuk cetak resi langsung dari ponsel.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Printer className="h-4 w-4" /> Ukuran Kertas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Jenis kertas</Label>
            <Select value={preset} onValueChange={choosePreset}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Pilih ukuran" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="58">58 mm (umum, mini printer)</SelectItem>
                <SelectItem value="80">80 mm</SelectItem>
                <SelectItem value="custom">Ukuran lain (custom)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {preset === "custom" && (
            <div>
              <Label>Lebar kertas (mm)</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="number"
                  min={30}
                  max={120}
                  placeholder="mis. 76"
                  value={customMm}
                  onChange={(e) => setCustomMm(e.target.value)}
                  className="max-w-[140px]"
                />
                <Button variant="outline" onClick={saveCustom}>
                  <Save className="h-4 w-4 mr-1" /> Simpan
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Isi lebar kertas 30–120 mm.</p>
            </div>
          )}
          <div>
            <Label>Kepekatan cetak</Label>
            <Select
              value={String(settings.density)}
              onValueChange={(v) => update({ density: Number(v) as 1 | 2 | 3 })}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Terang (hemat tinta/panas)</SelectItem>
                <SelectItem value="2">Normal</SelectItem>
                <SelectItem value="3">Gelap (lebih pekat)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <Button onClick={runTest} disabled={testing}>
              <Bluetooth className="h-4 w-4 mr-1" /> {testing ? "Mengirim..." : "Tes Cetak"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Pengaturan tersimpan otomatis di ponsel ini.
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cara pakai</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. Nyalakan Bluetooth di ponsel dan printer.</p>
          <p>2. Klik Tes Cetak — pilih printer saat Chrome menampilkan daftar Bluetooth.</p>
          <p>3. Setelah terpasang, resi dari halaman Status/Order bisa dicetak langsung lewat tombol Cetak.</p>
          <p className="text-xs">
            Catatan: cetak langsung hanya di Chrome/Edge Android dengan printer Bluetooth yang didukung browser.
            Jika gagal, gunakan tombol Download lalu cetak dari aplikasi printer.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
