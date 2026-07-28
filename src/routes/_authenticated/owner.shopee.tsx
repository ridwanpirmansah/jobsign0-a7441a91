import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getShopeeStatus,
  saveShopeeSettings,
  getShopeeAuthUrl,
  previewShopeeOrders,
  importShopeeOrders,
  syncShopeeNow,
  disconnectShopee,
} from "@/lib/shopee.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  AlertCircle, CheckCircle2, Download, Eye, Link2, Plug, RefreshCw, Save, ShoppingBag, Unplug,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/owner/shopee")({
  component: ShopeePage,
  head: () => ({
    meta: [
      { title: "Integrasi Shopee — Tarik Pesanan Otomatis" },
      { name: "description", content: "Hubungkan toko Shopee dan tarik data pesanan menjadi order baru secara otomatis." },
      { property: "og:title", content: "Integrasi Shopee" },
      { property: "og:description", content: "Tarik pesanan Shopee menjadi order produksi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const rupiah = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");

function ShopeePage() {
  const router = useRouter();
  const fetchStatus = useServerFn(getShopeeStatus);
  const saveFn = useServerFn(saveShopeeSettings);
  const authUrlFn = useServerFn(getShopeeAuthUrl);
  const previewFn = useServerFn(previewShopeeOrders);
  const importFn = useServerFn(importShopeeOrders);
  const syncFn = useServerFn(syncShopeeNow);
  const disconnectFn = useServerFn(disconnectShopee);

  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ["shopee-status"],
    queryFn: () => fetchStatus(),
  });

  const [partnerId, setPartnerId] = useState("");
  const [partnerKey, setPartnerKey] = useState("");
  const [days, setDays] = useState(7);
  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!status) return;
    setPartnerId(status.partner_id ?? "");
    setDays(status.lookback_days ?? 7);
    setEnabled(!!status.enabled);
  }, [status]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const s = p.get("shopee");
    if (s === "connected") toast.success("Toko Shopee berhasil terhubung");
    if (s === "error") toast.error(p.get("msg") ?? "Gagal menghubungkan toko Shopee");
    if (s) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const saveMut = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          partner_id: partnerId.trim(),
          partner_key: partnerKey.trim() || undefined,
          lookback_days: days,
          enabled,
        },
      }),
    onSuccess: () => {
      setPartnerKey("");
      toast.success("Pengaturan Shopee tersimpan");
      refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Gagal simpan"),
  });

  const connectMut = useMutation({
    mutationFn: () => authUrlFn({ data: { origin: window.location.origin } }),
    onSuccess: (r: any) => {
      if (!r?.ok || !r.url) {
        toast.error(r?.error ?? "Gagal membuat link otorisasi");
        return;
      }
      window.location.href = r.url;
    },
    onError: (e: any) => toast.error(e?.message ?? "Gagal membuat link otorisasi"),
  });

  const previewMut = useMutation({
    mutationFn: () => previewFn({ data: { days } }),
    onSuccess: (r: any) => {
      if (!r?.ok) {
        setRows(null);
        toast.error(r?.error ?? "Gagal ambil pesanan");
        return;
      }
      setRows(r.rows);
      const next: Record<string, boolean> = {};
      for (const row of r.rows) if (!row.already_imported) next[row.order_sn] = true;
      setPicked(next);
      toast.success(`${r.rows.length} pesanan ditemukan`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Gagal ambil pesanan"),
  });

  const selected = useMemo(
    () => Object.entries(picked).filter(([, v]) => v).map(([k]) => k),
    [picked],
  );

  const importMut = useMutation({
    mutationFn: () => importFn({ data: { order_sns: selected } }),
    onSuccess: (r: any) => {
      if (r.ok) toast.success(r.message);
      else toast.error(r.message || "Import gagal");
      refetch();
      previewMut.mutate();
      router.invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Import gagal"),
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

  const disconnectMut = useMutation({
    mutationFn: () => disconnectFn(),
    onSuccess: () => {
      toast.success("Toko Shopee diputuskan");
      setRows(null);
      refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Gagal memutus koneksi"),
  });

  if (isLoading) return <div className="p-4">Memuat...</div>;

  const callbackUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/public/shopee/callback` : "";

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingBag className="h-6 w-6 text-orange-500" /> Integrasi Shopee
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Tarik pesanan dari toko Shopee menjadi order baru. Semua data tetap bisa diedit manual.
        </p>
      </div>

      {/* Status */}
      <Card>
        <CardContent className="pt-6 flex flex-wrap gap-3 items-center">
          {status?.connected ? (
            <Badge className="gap-1 bg-emerald-600"><CheckCircle2 className="h-3 w-3" /> Toko terhubung</Badge>
          ) : (
            <Badge variant="secondary" className="gap-1"><AlertCircle className="h-3 w-3" /> Belum terhubung</Badge>
          )}
          {status?.shop_id && <span className="text-sm text-muted-foreground">Shop ID: {status.shop_id}</span>}
          {status?.last_sync_at && (
            <span className="text-sm text-muted-foreground">
              Sync terakhir: {new Date(status.last_sync_at).toLocaleString("id-ID")} · +{status.last_sync_inserted} baru, ~{status.last_sync_updated} update
            </span>
          )}
          {status?.last_sync_message && (
            <p className="w-full text-xs text-muted-foreground">{status.last_sync_message}</p>
          )}
        </CardContent>
      </Card>

      {/* Kredensial */}
      <Card>
        <CardHeader>
          <CardTitle>Kredensial Shopee Open Platform</CardTitle>
          <CardDescription>
            Daftar di open.shopee.com → buat App → salin Partner ID & Partner Key. Isi <b>Redirect URL</b> di App
            Shopee dengan alamat berikut:
            <code className="block mt-2 p-2 rounded bg-muted text-xs break-all">{callbackUrl}</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>Partner ID</Label>
              <Input
                value={partnerId}
                inputMode="numeric"
                onChange={(e) => setPartnerId(e.target.value)}
                placeholder="contoh: 1234567"
              />
            </div>
            <div>
              <Label>Partner Key</Label>
              <Input
                type="password"
                value={partnerKey}
                onChange={(e) => setPartnerKey(e.target.value)}
                placeholder={status?.has_partner_key ? "•••••• (tersimpan, isi untuk ganti)" : "tempel Partner Key"}
              />
            </div>
            <div>
              <Label>Rentang hari pesanan</Label>
              <Input
                type="number" min={1} max={90}
                value={days}
                onChange={(e) => setDays(Math.min(90, Math.max(1, parseInt(e.target.value) || 7)))}
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch id="sh-en" checked={enabled} onCheckedChange={setEnabled} />
              <Label htmlFor="sh-en">Aktifkan sync otomatis tiap jam</Label>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              <Save className="h-4 w-4 mr-2" /> Simpan Pengaturan
            </Button>
            <Button
              variant="outline"
              onClick={() => connectMut.mutate()}
              disabled={connectMut.isPending || !partnerId}
            >
              <Link2 className="h-4 w-4 mr-2" />
              {status?.connected ? "Hubungkan Ulang Toko" : "Hubungkan Toko Shopee"}
            </Button>
            {status?.connected && (
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => disconnectMut.mutate()}
                disabled={disconnectMut.isPending}
              >
                <Unplug className="h-4 w-4 mr-2" /> Putuskan
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tarik pesanan */}
      <Card>
        <CardHeader>
          <CardTitle>Tarik Pesanan</CardTitle>
          <CardDescription>
            Preview dulu untuk memilih pesanan mana yang jadi order, atau langsung sync semua pesanan pada rentang hari di atas.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => previewMut.mutate()} disabled={previewMut.isPending || !status?.connected}>
            <Eye className="h-4 w-4 mr-2" />
            {previewMut.isPending ? "Memuat..." : "Preview Pesanan"}
          </Button>
          <Button onClick={() => syncMut.mutate()} disabled={syncMut.isPending || !status?.connected}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncMut.isPending ? "animate-spin" : ""}`} />
            {syncMut.isPending ? "Sinkronisasi..." : "Sync Sekarang"}
          </Button>
          {!status?.connected && (
            <p className="text-sm text-muted-foreground w-full flex items-center gap-1">
              <Plug className="h-4 w-4" /> Hubungkan toko terlebih dahulu.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Preview list */}
      {rows && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle>Pesanan Shopee ({rows.length})</CardTitle>
              <CardDescription>{selected.length} dipilih untuk diimport</CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => importMut.mutate()}
              disabled={importMut.isPending || selected.length === 0}
            >
              <Download className="h-4 w-4 mr-2" /> Import Terpilih
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground">Tidak ada pesanan pada rentang tanggal tersebut.</p>
            )}
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
                      <Badge variant="secondary">Sudah diimport{r.order_no ? ` · #${r.order_no}` : ""}</Badge>
                    )}
                    <Badge variant="outline">{r.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 break-all">
                    {r.order_sn} · {r.buyer || "-"} · {r.kota || "-"} · {r.co_date ?? "-"}
                  </p>
                  <p className="text-xs mt-1">
                    {rupiah(r.total)}
                    {r.ekspedisi ? ` · ${r.ekspedisi}` : ""}
                    {r.no_resi ? ` · ${r.no_resi}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
