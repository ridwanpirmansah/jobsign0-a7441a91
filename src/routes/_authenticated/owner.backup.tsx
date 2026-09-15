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
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Download, Upload, Database, Loader2, AlertTriangle, FileArchive } from "lucide-react";
import {
  listBackupTables, backupTable, restoreChunk, restoreBegin, restoreFinish, clearTable, BACKUP_TABLES,
} from "@/lib/backup.functions";

export const Route = createFileRoute("/_authenticated/owner/backup")({
  component: BackupPage,
});

const CHUNK = 100;

function toCsv(rows: any[]): string {
  if (rows.length === 0) return "";
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
      const v = row[k];
      if (v === "" || v === undefined) { out[k] = null; continue; }
      if (typeof v === "string" && (v.startsWith("{") || v.startsWith("["))) {
        try { out[k] = JSON.parse(v); continue; } catch { /* keep raw text */ }
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
  const chunkFn = useServerFn(restoreChunk);
  const beginFn = useServerFn(restoreBegin);
  const finishFn = useServerFn(restoreFinish);
  const clearFn = useServerFn(clearTable);
  const [selected, setSelected] = useState<string>(BACKUP_TABLES[0].key);
  const [mode, setMode] = useState<"upsert" | "replace">("upsert");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);

  const { data: tables = [], isLoading } = useQuery({
    queryKey: ["backup-tables"],
    queryFn: () => listFn(),
  });

  const sendRows = async (key: string, rows: any[], label: string, base: { done: number; total: number }) => {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const res = await chunkFn({ data: { table: key, rows: rows.slice(i, i + CHUNK) } });
      inserted += res.inserted;
      setProgress({ label, done: base.done + Math.min(i + CHUNK, rows.length), total: base.total });
    }
    return inserted;
  };

  const backupOne = useMutation({
    mutationFn: async (key: string) => {
      const res = await backupFn({ data: { table: key } });
      const cfg = BACKUP_TABLES.find((b) => b.key === key)!;
      const csv = toCsv(res.rows);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      saveAs(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `${cfg.file}_${stamp}.csv`);
      return res.rows.length;
    },
    onSuccess: (n, key) => toast.success(`Backup ${key}: ${n} baris`),
    onError: (e: any) => toast.error(e.message),
  });

  const backupAll = async () => {
    setBusy("backup-all");
    try {
      const zip = new JSZip();
      let total = 0;
      for (const t of BACKUP_TABLES) {
        setProgress({ label: `Backup ${t.label}`, done: 0, total: 1 });
        const res = await backupFn({ data: { table: t.key } });
        zip.file(`${t.file}.csv`, toCsv(res.rows));
        total += res.rows.length;
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      saveAs(blob, `backup_full_${stamp}.zip`);
      toast.success(`Backup selesai: ${total} baris dari ${BACKUP_TABLES.length} tabel`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const onRestoreCsv = async (file: File) => {
    setBusy("restore-one");
    const cfg = BACKUP_TABLES.find((b) => b.key === selected)!;
    try {
      const rows = parseCsv(await file.text());
      await beginFn({ data: {} as any });
      try {
        if (mode === "replace" && cfg.schema === "public") await clearFn({ data: { table: cfg.key } });
        const inserted = await sendRows(cfg.key, rows, `Restore ${cfg.label}`, { done: 0, total: rows.length });
        toast.success(`Restore ${cfg.label}: ${inserted} baris`);
      } finally {
        await finishFn({ data: {} as any });
      }
      qc.invalidateQueries({ queryKey: ["backup-tables"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onRestoreZip = async (file: File) => {
    setBusy("restore-all");
    try {
      const zip = await JSZip.loadAsync(file);
      const payload: { cfg: (typeof BACKUP_TABLES)[number]; rows: any[] }[] = [];
      for (const t of BACKUP_TABLES) {
        const entry = zip.file(`${t.file}.csv`) ?? zip.file(`${t.name}.csv`);
        if (!entry) continue;
        const rows = parseCsv(await entry.async("string"));
        if (rows.length > 0) payload.push({ cfg: t, rows });
      }
      const grandTotal = payload.reduce((a, p) => a + p.rows.length, 0);
      if (grandTotal === 0) { toast.error("File zip tidak berisi data yang dikenali"); return; }

      await beginFn({ data: {} as any });
      let total = 0;
      let done = 0;
      try {
        if (mode === "replace") {
          for (const p of [...payload].reverse()) {
            if (p.cfg.schema === "public") await clearFn({ data: { table: p.cfg.key } });
          }
        }
        for (const p of payload) {
          total += await sendRows(p.cfg.key, p.rows, `Restore ${p.cfg.label}`, { done, total: grandTotal });
          done += p.rows.length;
        }
      } finally {
        const fin = await finishFn({ data: {} as any });
        if (fin.failed?.length) toast.warning(`Sebagian relasi gagal dipasang ulang: ${fin.failed.length}`);
      }
      toast.success(`Restore selesai: ${total} baris dari ${payload.length} tabel (termasuk akun login).`);
      qc.invalidateQueries({ queryKey: ["backup-tables"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
      setProgress(null);
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
          Backup Semua (.zip) menyalin <b>seluruh data</b> termasuk akun login karyawan, draft, order, project,
          absensi, dan riwayat kirim. Saat restore, pemeriksaan relasi dan perhitungan otomatis dimatikan sementara
          lalu dipasang kembali setelah selesai, sehingga urutan data tidak lagi menyebabkan error.
          Mode <b>Upsert</b> memperbarui/menambah data; mode <b>Replace</b> mengosongkan tabel terlebih dahulu.
          Jangan menutup halaman selama proses berjalan.
        </AlertDescription>
      </Alert>

      {progress && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex justify-between text-sm">
              <span>{progress.label}</span>
              <span className="text-muted-foreground">{progress.done}/{progress.total}</span>
            </div>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" /> Backup / Restore Semua Data
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Cara yang benar untuk memindahkan database ke server baru. Data dikirim bertahap agar file besar tidak ditolak server.
          </p>
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
                  <SelectItem key={t.key} value={t.key}>{t.label} ({t.key})</SelectItem>
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
                  <tr key={t.key} className="border-t">
                    <td className="p-2">{t.label}</td>
                    <td className="p-2 font-mono text-xs text-muted-foreground">{t.key}</td>
                    <td className="p-2 text-right">
                      <Badge variant="secondary">{t.count.toLocaleString("id-ID")}</Badge>
                    </td>
                    <td className="p-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={backupOne.isPending || busy !== null}
                        onClick={() => backupOne.mutate(t.key)}
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
