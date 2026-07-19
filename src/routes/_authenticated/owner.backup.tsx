import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import Papa from "papaparse";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Download, Upload, Database, Loader2, AlertTriangle, FileArchive } from "lucide-react";
import { listBackupTables, backupTable, restoreTable, BACKUP_TABLES } from "@/lib/backup.functions";

export const Route = createFileRoute("/_authenticated/owner/backup")({
  component: BackupPage,
});

function toCsv(rows: any[]): string {
  if (rows.length === 0) return "";
  // Normalize objects/arrays to JSON strings so CSV stays flat.
  const normalized = rows.map((r) => {
    const out: any = {};
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (v !== null && typeof v === "object") out[k] = JSON.stringify(v);
      else out[k] = v;
    }
    return out;
  });
  return Papa.unparse(normalized);
}

function parseCsv(text: string): any[] {
  const parsed = Papa.parse(text, { header: true, dynamicTyping: false, skipEmptyLines: true });
  return (parsed.data as any[]).map((row) => {
    const out: any = {};
    for (const k of Object.keys(row)) {
      let v = row[k];
      if (v === "" || v === undefined) { out[k] = null; continue; }
      // Try parse JSON (for jsonb columns / arrays)
      if (typeof v === "string" && (v.startsWith("{") || v.startsWith("["))) {
        try { out[k] = JSON.parse(v); continue; } catch {}
      }
      out[k] = v;
    }
    return out;
  });
}

function BackupPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listBackupTables);
  const backupFn = useServerFn(backupTable);
  const restoreFn = useServerFn(restoreTable);
  const [selected, setSelected] = useState<string>(BACKUP_TABLES[0].name);
  const [mode, setMode] = useState<"upsert" | "replace">("upsert");
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);

  const { data: tables = [], isLoading } = useQuery({
    queryKey: ["backup-tables"],
    queryFn: () => listFn(),
  });

  const backupOne = useMutation({
    mutationFn: async (name: string) => {
      const res = await backupFn({ data: { table: name } });
      const csv = toCsv(res.rows);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      saveAs(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `${name}_${stamp}.csv`);
      return res.rows.length;
    },
    onSuccess: (n, name) => toast.success(`Backup ${name}: ${n} baris`),
    onError: (e: any) => toast.error(e.message),
  });

  const backupAll = async () => {
    setBusy("backup-all");
    try {
      const zip = new JSZip();
      let total = 0;
      for (const t of BACKUP_TABLES) {
        const res = await backupFn({ data: { table: t.name } });
        zip.file(`${t.name}.csv`, toCsv(res.rows));
        total += res.rows.length;
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      saveAs(blob, `backup_all_${stamp}.zip`);
      toast.success(`Backup selesai: ${total} baris dari ${BACKUP_TABLES.length} tabel`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const onRestoreCsv = async (file: File) => {
    setBusy("restore-one");
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const res = await restoreFn({ data: { table: selected, rows, mode } });
      toast.success(`Restore ${res.table}: ${res.inserted} baris`);
      qc.invalidateQueries({ queryKey: ["backup-tables"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onRestoreZip = async (file: File) => {
    setBusy("restore-all");
    try {
      const zip = await JSZip.loadAsync(file);
      let total = 0;
      // Restore in declared order to respect FK dependencies.
      for (const t of BACKUP_TABLES) {
        const entry = zip.file(`${t.name}.csv`);
        if (!entry) continue;
        const text = await entry.async("string");
        const rows = parseCsv(text);
        if (rows.length === 0) continue;
        const res = await restoreFn({ data: { table: t.name, rows, mode } });
        total += res.inserted;
      }
      toast.success(`Restore selesai: ${total} baris`);
      qc.invalidateQueries({ queryKey: ["backup-tables"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
      if (zipRef.current) zipRef.current.value = "";
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Database className="h-6 w-6" />
        <h1 className="text-2xl font-semibold">Backup &amp; Restore Data</h1>
      </div>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Perhatian</AlertTitle>
        <AlertDescription>
          Restore mode <b>Upsert</b> memperbarui/menambahkan baris tanpa menghapus data lain.
          Mode <b>Replace</b> menghapus seluruh isi tabel terlebih dahulu — pastikan file backup lengkap
          sebelum menggunakan mode ini. Restore semua (.zip) mengikuti urutan tabel untuk menjaga
          relasi antar data.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" /> Backup / Restore Semua Tabel
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button onClick={backupAll} disabled={busy !== null}>
            {busy === "backup-all" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Backup Semua (.zip)
          </Button>
          <div className="flex items-center gap-2">
            <Select value={mode} onValueChange={(v) => setMode(v as any)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="upsert">Mode: Upsert</SelectItem>
                <SelectItem value="replace">Mode: Replace</SelectItem>
              </SelectContent>
            </Select>
            <input
              ref={zipRef}
              type="file"
              accept=".zip"
              hidden
              onChange={(e) => e.target.files?.[0] && onRestoreZip(e.target.files[0])}
            />
            <Button variant="outline" onClick={() => zipRef.current?.click()} disabled={busy !== null}>
              {busy === "restore-all" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Restore Semua (.zip)
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backup / Restore Per Tabel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="w-full sm:w-72"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BACKUP_TABLES.map((t) => (
                  <SelectItem key={t.name} value={t.name}>{t.label} ({t.name})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              hidden
              onChange={(e) => e.target.files?.[0] && onRestoreCsv(e.target.files[0])}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
              {busy === "restore-one" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Restore CSV
            </Button>
          </div>

          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-2 text-left">Tabel</th>
                  <th className="p-2 text-left">Nama Teknis</th>
                  <th className="p-2 text-right">Jumlah Baris</th>
                  <th className="p-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </td></tr>
                )}
                {tables.map((t) => (
                  <tr key={t.name} className="border-t">
                    <td className="p-2">{BACKUP_TABLES.find((b) => b.name === t.name)?.label ?? t.name}</td>
                    <td className="p-2 font-mono text-xs text-muted-foreground">{t.name}</td>
                    <td className="p-2 text-right">
                      <Badge variant="secondary">{t.count.toLocaleString("id-ID")}</Badge>
                    </td>
                    <td className="p-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={backupOne.isPending}
                        onClick={() => backupOne.mutate(t.name)}
                      >
                        <Download className="mr-1 h-3.5 w-3.5" /> CSV
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
