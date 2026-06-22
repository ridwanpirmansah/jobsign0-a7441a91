import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getSyncSettings,
  updateSyncSettings,
  previewSheetFn,
  syncProjectsNow,
} from "@/lib/sync.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { RefreshCw, Eye, Save, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/owner/sync")({
  component: SyncPage,
  head: () => ({ meta: [{ title: "Sync Project dari Google Sheets" }] }),
});

const FIELDS: { key: keyof Mapping; label: string; required?: boolean }[] = [
  { key: "code", label: "Kode Project", required: true },
  { key: "title", label: "Nama Project", required: true },
  { key: "total_points", label: "Total Titik" },
  { key: "customer_name", label: "Nama Customer" },
  { key: "status", label: "Status (draft/active/completed/cancelled)" },
  { key: "deadline", label: "Deadline (tanggal)" },
  { key: "description", label: "Deskripsi" },
  { key: "contract_value", label: "Nilai Kontrak (Rp)" },
];

type Mapping = {
  code?: string;
  title?: string;
  total_points?: string;
  customer_name?: string;
  status?: string;
  deadline?: string;
  description?: string;
  contract_value?: string;
};

function SyncPage() {
  const router = useRouter();
  const fetchSettings = useServerFn(getSyncSettings);
  const saveSettings = useServerFn(updateSyncSettings);
  const previewFn = useServerFn(previewSheetFn);
  const syncFn = useServerFn(syncProjectsNow);

  const { data: settings, isLoading, refetch } = useQuery({
    queryKey: ["sync-settings"],
    queryFn: () => fetchSettings(),
  });

  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const [enabled, setEnabled] = useState(true);
  const [mapping, setMapping] = useState<Mapping>({});
  const [preview, setPreview] = useState<{ headers: string[]; rows: string[][] } | null>(null);

  useEffect(() => {
    if (settings) {
      setSpreadsheetId(settings.spreadsheet_id ?? "");
      setSheetName(settings.sheet_name ?? "");
      setHeaderRow(settings.header_row ?? 1);
      setEnabled(settings.enabled ?? true);
      setMapping((settings.mapping as Mapping) ?? {});
    }
  }, [settings]);

  const previewMut = useMutation({
    mutationFn: () => previewFn({ data: { spreadsheet_id: spreadsheetId, sheet_name: sheetName } }),
    onSuccess: (d: any) => {
      if (!d?.ok) {
        setPreview(null);
        toast.error(d?.error ?? "Gagal preview");
        return;
      }
      setPreview({ headers: d.headers, rows: d.rows });
      toast.success(`Preview ${d.rows.length} baris. Sekarang atur mapping kolom di bawah.`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Gagal preview"),
  });

  const saveMut = useMutation({
    mutationFn: () =>
      saveSettings({
        data: {
          spreadsheet_id: spreadsheetId,
          sheet_name: sheetName,
          header_row: headerRow,
          enabled,
          mapping,
        },
      }),
    onSuccess: () => {
      toast.success("Pengaturan tersimpan");
      refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Gagal simpan"),
  });

  const syncMut = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: (r: any) => {
      if (r.ok) toast.success(r.message);
      else toast.error(r.message || "Sync gagal");
      refetch();
      router.invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Sync gagal"),
  });

  if (isLoading) return <div className="p-4">Memuat...</div>;

  const headerOptions = preview?.headers ?? [];

  return (
    <div className="p-4 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileSpreadsheet className="h-6 w-6" /> Sync Project dari Google Sheets
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Data project otomatis disinkronkan setiap jam, atau klik tombol "Sync Sekarang" kapan saja.
        </p>
      </div>

      {settings?.last_sync_at && (
        <Card>
          <CardContent className="pt-6 flex flex-wrap gap-4 items-center">
            {settings.last_sync_status === "ok" ? (
              <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Sukses</Badge>
            ) : (
              <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> Error</Badge>
            )}
            <span className="text-sm text-muted-foreground">
              Terakhir: {new Date(settings.last_sync_at).toLocaleString("id-ID")}
            </span>
            <span className="text-sm">
              +{settings.last_sync_inserted ?? 0} baru, ~{settings.last_sync_updated ?? 0} update, {settings.last_sync_skipped ?? 0} dilewati
            </span>
            {settings.last_sync_message && (
              <p className="w-full text-xs text-muted-foreground">{settings.last_sync_message}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Sumber Data</CardTitle>
          <CardDescription>
            Pastikan file sudah berupa <b>Google Sheets asli</b> (bukan .xlsx upload). Akun Google yang terhubung minimal harus punya akses Viewer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>Spreadsheet ID</Label>
              <Input
                value={spreadsheetId}
                onChange={(e) => setSpreadsheetId(e.target.value)}
                placeholder="dari URL: /d/XXXXX/edit"
              />
            </div>
            <div>
              <Label>Nama Tab</Label>
              <Input value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
            </div>
            <div>
              <Label>Baris Header</Label>
              <Input
                type="number" min={1}
                value={headerRow}
                onChange={(e) => setHeaderRow(parseInt(e.target.value) || 1)}
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={enabled} onCheckedChange={setEnabled} id="en" />
              <Label htmlFor="en">Aktifkan sync otomatis tiap jam</Label>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => previewMut.mutate()} disabled={previewMut.isPending} variant="outline">
              <Eye className="h-4 w-4 mr-2" />
              {previewMut.isPending ? "Memuat..." : "Preview Sheet"}
            </Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              <Save className="h-4 w-4 mr-2" />
              Simpan Pengaturan
            </Button>
          </div>
        </CardContent>
      </Card>

      {headerOptions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Mapping Kolom</CardTitle>
            <CardDescription>Pilih kolom sheet yang sesuai untuk tiap field project.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {FIELDS.map((f) => (
              <div key={f.key} className="grid grid-cols-2 gap-3 items-center">
                <Label>
                  {f.label} {f.required && <span className="text-destructive">*</span>}
                </Label>
                <Select
                  value={mapping[f.key] ?? "__none"}
                  onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === "__none" ? undefined : v }))}
                >
                  <SelectTrigger><SelectValue placeholder="(tidak dipakai)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">(tidak dipakai)</SelectItem>
                    {headerOptions.map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              <Save className="h-4 w-4 mr-2" /> Simpan Mapping
            </Button>
          </CardContent>
        </Card>
      )}

      {preview && preview.rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Preview ({preview.rows.length} baris)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>{preview.headers.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((r, i) => (
                  <TableRow key={i}>
                    {preview.headers.map((_, j) => <TableCell key={j}>{r[j] ?? ""}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Sync Sekarang</CardTitle>
          <CardDescription>
            Tarik data terbaru dari Google Sheets. Project baru akan dibuat; project lama dengan kode sama akan diperbarui.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => syncMut.mutate()} disabled={syncMut.isPending} size="lg">
            <RefreshCw className={`h-4 w-4 mr-2 ${syncMut.isPending ? "animate-spin" : ""}`} />
            {syncMut.isPending ? "Sinkronisasi..." : "Sync Sekarang"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
