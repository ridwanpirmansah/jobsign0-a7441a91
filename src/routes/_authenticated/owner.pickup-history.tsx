import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listAllPickups } from "@/lib/orders.functions";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Truck, Search, PackageCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/owner/pickup-history")({
  component: PickupHistoryPage,
  head: () => ({ meta: [{ title: "Riwayat Pickup · Owner" }] }),
});

type Row = {
  id: string; order_no: string; no_resi: string | null; ekspedisi: string | null;
  username: string | null; kota: string | null; text_neon: string | null;
  ready_pickup_at: string | null; picked_up_at: string | null;
  picked_up_by: string | null; courier_name: string;
};

function PickupHistoryPage() {
  const { data: me } = useCurrentUser();
  const fetchAll = useServerFn(listAllPickups);
  const q = useQuery({ queryKey: ["pickup-all"], queryFn: () => fetchAll(), enabled: isStaff(me?.role) });

  const [filter, setFilter] = useState("");
  const [courier, setCourier] = useState<string>("all");
  const [range, setRange] = useState<"today" | "yesterday" | "7d" | "30d" | "all">("7d");

  const rows: Row[] = (q.data as any[]) ?? [];

  const inRange = (d: string | null) => {
    if (!d) return false;
    if (range === "all") return true;
    const now = new Date();
    const t = new Date(d).getTime();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (range === "today") return t >= startToday;
    if (range === "yesterday") return t >= startToday - 86400000 && t < startToday;
    if (range === "7d") return t >= startToday - 6 * 86400000;
    if (range === "30d") return t >= startToday - 29 * 86400000;
    return true;
  };

  const couriers = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.courier_name && s.add(r.courier_name));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const qs = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (!inRange(r.picked_up_at)) return false;
      if (courier !== "all" && r.courier_name !== courier) return false;
      if (!qs) return true;
      return (
        (r.no_resi ?? "").toLowerCase().includes(qs) ||
        (r.order_no ?? "").toLowerCase().includes(qs) ||
        (r.ekspedisi ?? "").toLowerCase().includes(qs) ||
        (r.text_neon ?? "").toLowerCase().includes(qs) ||
        (r.username ?? "").toLowerCase().includes(qs) ||
        (r.courier_name ?? "").toLowerCase().includes(qs)
      );
    });
  }, [rows, filter, courier, range]);

  const perCourier = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((r) => map.set(r.courier_name, (map.get(r.courier_name) ?? 0) + 1));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  if (!isStaff(me?.role)) {
    return <p className="text-sm text-slate-500">Halaman ini khusus admin/owner.</p>;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Truck className="h-6 w-6 text-sky-600" /> Riwayat Pickup Kurir</h1>
        <p className="text-sm text-slate-500">Pantau paket yang sudah diambil kurir per karyawan.</p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Filter</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Cari resi / order / kurir…" className="pl-8" />
          </div>
          <Select value={courier} onValueChange={setCourier}>
            <SelectTrigger><SelectValue placeholder="Semua kurir" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua kurir</SelectItem>
              {couriers.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={(v) => setRange(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Hari ini</SelectItem>
              <SelectItem value="yesterday">Kemarin</SelectItem>
              <SelectItem value="7d">7 hari terakhir</SelectItem>
              <SelectItem value="30d">30 hari terakhir</SelectItem>
              <SelectItem value="all">Semua</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {perCourier.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Ringkasan per Kurir</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {perCourier.map(([name, count]) => (
              <Badge key={name} variant="secondary" className="text-sm py-1 px-3">
                {name}: <span className="ml-1 font-bold">{count}</span>
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <PackageCheck className="h-4 w-4 text-emerald-600" />
            Daftar Pickup ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {filtered.map((r) => (
              <div key={r.id} className="p-3 sm:p-4 grid gap-1 sm:grid-cols-6 sm:items-center text-sm">
                <div className="sm:col-span-2">
                  <div className="font-semibold text-slate-900">#{r.order_no}</div>
                  <div className="text-xs text-slate-500 truncate">{r.text_neon || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Resi</div>
                  <div className="font-mono text-xs">{r.no_resi || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Ekspedisi</div>
                  <Badge variant="outline">{r.ekspedisi || "—"}</Badge>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Kurir</div>
                  <div className="font-medium text-slate-800">{r.courier_name}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Diambil</div>
                  <div className="text-xs">{r.picked_up_at ? new Date(r.picked_up_at).toLocaleString("id-ID") : "—"}</div>
                </div>
              </div>
            ))}
            {!filtered.length && (
              <div className="p-8 text-center text-sm text-slate-500">Belum ada pickup untuk filter ini.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
