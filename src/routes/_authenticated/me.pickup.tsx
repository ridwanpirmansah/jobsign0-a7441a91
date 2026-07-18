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
import { beepSuccess, beepError } from "@/lib/scan-feedback";

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
      beepSuccess();
      toast.success(`Paket ${res.order_no} berhasil diambil${res.ekspedisi ? ` (${res.ekspedisi})` : ""}`);
      setResiInput(""); setNote("");
      qc.invalidateQueries({ queryKey: ["pickup-ready"] });
      qc.invalidateQueries({ queryKey: ["pickup-mine"] });
    },
    onError: (e: Error) => { beepError(); toast.error(e.message); },
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
    <div className="edge-to-edge p-0 sm:p-4 space-y-3 sm:space-y-5 max-w-5xl">
      <div className="flex items-center gap-2 px-3 sm:px-0 pt-3 sm:pt-0">

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
          <ResiScanner onScan={(t) => { if (!pickupMut.isPending) pickupMut.mutate(t); }} />
          <div className="text-center text-xs text-muted-foreground">— atau ketik manual —</div>
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

      <PickupHistory rows={mineQ.data ?? []} loading={mineQ.isLoading} />
    </div>
  );
}

type MineRow = { id: string; order_no: string; no_resi: string | null; ekspedisi: string | null; username: string | null; kota: string | null; text_neon: string | null; ready_pickup_at: string | null; picked_up_at: string | null };

function PickupHistory({ rows, loading }: { rows: MineRow[]; loading: boolean }) {
  const [range, setRange] = useState<"today" | "yesterday" | "7d" | "30d" | "all">("7d");
  const [carrier, setCarrier] = useState<string>("all");

  const now = new Date();
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const today0 = startOfDay(now).getTime();
  const yesterday0 = today0 - 86400000;
  const d7 = today0 - 6 * 86400000;
  const d30 = today0 - 29 * 86400000;

  const inRange = (ts: string | null) => {
    if (!ts) return false;
    const t = new Date(ts).getTime();
    switch (range) {
      case "today": return t >= today0;
      case "yesterday": return t >= yesterday0 && t < today0;
      case "7d": return t >= d7;
      case "30d": return t >= d30;
      case "all": return true;
    }
  };

  const filtered = useMemo(() => {
    return rows.filter((r) => inRange(r.picked_up_at) && (carrier === "all" || (r.ekspedisi || "Lainnya") === carrier));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, range, carrier]);

  const carriersAll = useMemo(() => {
    const set = new Set<string>();
    rows.filter((r) => inRange(r.picked_up_at)).forEach((r) => set.add(r.ekspedisi || "Lainnya"));
    return Array.from(set).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, range]);

  const perCarrier = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((r) => { const k = r.ekspedisi || "Lainnya"; m.set(k, (m.get(k) ?? 0) + 1); });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const grouped = useMemo(() => {
    const map = new Map<string, MineRow[]>();
    filtered.forEach((r) => {
      const d = r.picked_up_at ? startOfDay(new Date(r.picked_up_at)).getTime() : 0;
      let label = "—";
      if (d === today0) label = "Hari ini";
      else if (d === yesterday0) label = "Kemarin";
      else if (d) label = new Date(d).toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
      const arr = map.get(label) ?? [];
      arr.push(r); map.set(label, arr);
    });
    return Array.from(map.entries());
  }, [filtered]);

  const RANGES: { key: typeof range; label: string }[] = [
    { key: "today", label: "Hari ini" },
    { key: "yesterday", label: "Kemarin" },
    { key: "7d", label: "7 hari" },
    { key: "30d", label: "30 hari" },
    { key: "all", label: "Semua" },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <PackageCheck className="h-4 w-4"/> Riwayat Pickup
            <Badge variant="secondary">{filtered.length} paket</Badge>
          </CardTitle>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-2">
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${range === r.key ? "bg-cyan-600 text-white border-cyan-600" : "bg-white text-slate-600 border-slate-200 hover:border-cyan-300"}`}>
              {r.label}
            </button>
          ))}
        </div>
        {carriersAll.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button onClick={() => setCarrier("all")}
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${carrier === "all" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
              Semua ekspedisi
            </button>
            {carriersAll.map((c) => (
              <button key={c} onClick={() => setCarrier(c)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${carrier === c ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
                {c}
              </button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">Memuat…</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">Belum ada riwayat pickup untuk rentang ini.</div>
        ) : (
          <>
            {perCarrier.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {perCarrier.map(([name, count]) => (
                  <div key={name} className="rounded-xl border border-cyan-100 bg-gradient-to-br from-cyan-50 to-white p-2.5">
                    <div className="text-[10px] uppercase tracking-wide text-cyan-700 font-semibold truncate">{name}</div>
                    <div className="text-lg font-bold text-cyan-900">{count} <span className="text-xs font-normal text-slate-500">paket</span></div>
                  </div>
                ))}
              </div>
            )}
            {grouped.map(([label, list]) => (
              <div key={label}>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-2">
                  {label} <span className="text-muted-foreground normal-case tracking-normal">· {list.length} paket</span>
                </div>
                <div className="space-y-1.5">
                  {list.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2 text-sm bg-white hover:border-cyan-300 transition">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs text-muted-foreground">#{r.order_no}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{r.ekspedisi || "—"}</Badge>
                        </div>
                        <div className="font-medium truncate">{r.text_neon || "—"}</div>
                        <div className="font-mono text-xs text-emerald-700 truncate">{r.no_resi}</div>
                      </div>
                      <div className="text-[11px] text-muted-foreground text-right shrink-0">
                        {r.picked_up_at ? new Date(r.picked_up_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
