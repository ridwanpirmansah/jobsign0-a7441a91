import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listPickupReady, listMyPickups, courierPickup } from "@/lib/orders.functions";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ResiScanner } from "@/components/ResiScanner";
import { Truck, PackageCheck, Search, ScanLine } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/me/pickup")({
  component: PickupPage,
  head: () => ({ meta: [{ title: "Pickup Paket · Kurir" }] }),
});

function PickupPage() {
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const qc = useQueryClient();
  const fetchReady = useServerFn(listPickupReady);
  const fetchMine = useServerFn(listMyPickups);
  const doPickup = useServerFn(courierPickup);

  const [resiInput, setResiInput] = useState("");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("");

  const readyQ = useQuery({ queryKey: ["pickup-ready"], queryFn: () => fetchReady() });
  const mineQ = useQuery({ queryKey: ["pickup-mine"], queryFn: () => fetchMine() });

  const pickupMut = useMutation({
    mutationFn: (no_resi: string) => doPickup({ data: { no_resi, note: note.trim() || null } }),
    onSuccess: (res) => {
      toast.success(`Paket ${res.order_no} berhasil diambil${res.ekspedisi ? ` (${res.ekspedisi})` : ""}`);
      setResiInput(""); setNote("");
      qc.invalidateQueries({ queryKey: ["pickup-ready"] });
      qc.invalidateQueries({ queryKey: ["pickup-mine"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const rows = readyQ.data ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r: any) =>
      (r.no_resi ?? "").toLowerCase().includes(q) ||
      (r.order_no ?? "").toLowerCase().includes(q) ||
      (r.ekspedisi ?? "").toLowerCase().includes(q) ||
      (r.text_neon ?? "").toLowerCase().includes(q),
    );
  }, [readyQ.data, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const r of filtered) {
      const k = r.ekspedisi || "Lainnya";
      const arr = map.get(k) ?? [];
      arr.push(r); map.set(k, arr);
    }
    return Array.from(map.entries()).sort(([a],[b]) => a.localeCompare(b));
  }, [filtered]);

  if (meLoading) return <p className="p-4 text-sm text-slate-500">Memuat…</p>;
  if (!me) return <p className="p-4 text-sm text-slate-500">Silakan login.</p>;
  const allowed = me.role === "kurir" || isStaff(me.role);
  if (!allowed) {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardHeader><CardTitle>Akses ditolak</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-slate-500">Halaman ini hanya untuk kurir.</p></CardContent>
      </Card>
    );
  }

  return (
    <div className="p-3 sm:p-4 space-y-5 max-w-5xl">
      <div className="flex items-center gap-2">
        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 grid place-items-center text-white shadow">
          <Truck className="h-5 w-5"/>
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Pickup Paket</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Ambil paket yang sudah ditandai siap kirim oleh admin, lalu scan resi setelah drop ke ekspedisi.</p>
        </div>
      </div>

      {/* Scan / input resi */}
      <Card className="border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-blue-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><ScanLine className="h-4 w-4"/> Konfirmasi Pickup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>No Resi</Label>
            <Input
              autoFocus placeholder="Ketik atau scan nomor resi"
              value={resiInput}
              onChange={(e) => setResiInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && resiInput.trim()) pickupMut.mutate(resiInput.trim()); }}
              className="text-base font-mono"
            />
          </div>
          <div>
            <Label>Catatan (opsional)</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Misal: diambil di gudang B" />
          </div>
          <Button
            className="w-full bg-cyan-600 hover:bg-cyan-700"
            disabled={!resiInput.trim() || pickupMut.isPending}
            onClick={() => pickupMut.mutate(resiInput.trim())}
          >
            <PackageCheck className="h-4 w-4 mr-2"/> Konfirmasi Pickup
          </Button>
        </CardContent>
      </Card>

      {/* Daftar siap pickup */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Truck className="h-4 w-4"/> Siap Pickup
              <Badge variant="secondary">{filtered.length}</Badge>
            </CardTitle>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"/>
              <Input placeholder="Cari resi/order/ekspedisi..." value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-7 h-8 w-56" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {readyQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Memuat…</div>
          ) : grouped.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Tidak ada paket siap pickup.</div>
          ) : grouped.map(([exp, rows]) => (
            <div key={exp}>
              <div className="text-xs font-semibold text-cyan-700 uppercase tracking-wide mb-2 flex items-center gap-2">
                <Badge className="bg-cyan-600 text-white">{exp}</Badge>
                <span className="text-muted-foreground normal-case tracking-normal">{rows.length} paket</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                {rows.map((r: any) => (
                  <div key={r.id} className="border rounded-lg p-3 bg-white hover:border-cyan-400 transition">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-muted-foreground">#{r.order_no}</div>
                        <div className="font-semibold truncate">{r.text_neon || "—"}</div>
                        <div className="text-xs text-muted-foreground truncate">{r.username || "—"} · {r.kota || "—"}</div>
                      </div>
                      <Badge variant="outline" className="shrink-0">{r.ekspedisi || "—"}</Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="font-mono text-sm text-cyan-700 truncate">{r.no_resi || "—"}</div>
                      <Button size="sm" variant="outline" className="border-cyan-400 text-cyan-700 hover:bg-cyan-50" onClick={() => setResiInput(r.no_resi || "")}>
                        Pilih
                      </Button>
                    </div>
                    {r.ready_pickup_at && (
                      <div className="text-[10px] text-muted-foreground mt-1">Siap sejak {new Date(r.ready_pickup_at).toLocaleString("id-ID")}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Riwayat pickup saya */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><PackageCheck className="h-4 w-4"/> Riwayat Pickup Saya</CardTitle>
        </CardHeader>
        <CardContent>
          {mineQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Memuat…</div>
          ) : (mineQ.data ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-6">Belum ada riwayat pickup.</div>
          ) : (
            <div className="space-y-2">
              {(mineQ.data ?? []).map((r: any) => (
                <div key={r.id} className="flex items-center justify-between gap-3 border rounded-md px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-muted-foreground">#{r.order_no} · {r.ekspedisi || "—"}</div>
                    <div className="font-medium truncate">{r.text_neon || "—"}</div>
                    <div className="font-mono text-xs text-emerald-700 truncate">{r.no_resi}</div>
                  </div>
                  <div className="text-xs text-muted-foreground text-right shrink-0">
                    {r.picked_up_at ? new Date(r.picked_up_at).toLocaleString("id-ID") : "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
