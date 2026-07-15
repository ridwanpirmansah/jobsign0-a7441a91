import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Scissors, Zap, Cable, Sparkles, PackageCheck, Truck, Clock, Ruler, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/status")({
  component: StatusPage,
  head: () => ({ meta: [{ title: "Status Orderan" }] }),
});

type Step = "waiting" | "cutting" | "potong" | "solder" | "kabel" | "tempel" | "packing" | "shipping";
type Row = {
  project_id: string; project_code: string; project_title: string;
  customer_name: string | null; total_points: number;
  order_id: string | null; order_no: string | null; order_status: string | null;
  co_date: string | null; ekspedisi: string | null; no_resi: string | null;
  ready_pickup_at: string | null; picked_up_at: string | null;
  has_cut: boolean; has_potong: boolean; has_solder: boolean; has_kabel: boolean; has_tempel: boolean;
  cut_qty: number; potong_qty: number; solder_qty: number; kabel_qty: number; tempel_qty: number;
  current_step: Step;
};

const STEPS: { key: Step; label: string; short: string; icon: React.ComponentType<{ className?: string }>; color: string }[] = [
  { key: "waiting",  label: "Waiting",         short: "Wait",   icon: Clock,         color: "bg-slate-400" },
  { key: "cutting",  label: "Cutting Akrilik", short: "Cut",    icon: Scissors,      color: "bg-orange-500" },
  { key: "potong",   label: "Potong",          short: "Potong", icon: Ruler,         color: "bg-blue-500" },
  { key: "solder",   label: "Solder",          short: "Solder", icon: Zap,           color: "bg-amber-500" },
  { key: "kabel",    label: "Kabel",           short: "Kabel",  icon: Cable,         color: "bg-purple-500" },
  { key: "tempel",   label: "Tempel LED",      short: "Tempel", icon: Sparkles,      color: "bg-emerald-500" },
  { key: "packing",  label: "Packing",         short: "Pack",   icon: PackageCheck,  color: "bg-teal-500" },
  { key: "shipping", label: "Dikirim",         short: "Kirim",  icon: Truck,         color: "bg-green-600" },
];

const STEP_INDEX: Record<Step, number> = STEPS.reduce((acc, s, i) => ({ ...acc, [s.key]: i }), {} as Record<Step, number>);

function StatusPage() {
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: rows, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["active-pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_active_pipeline" as never);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
    refetchInterval: 30000,
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter((r) =>
      [r.project_code, r.project_title, r.order_no, r.customer_name, r.no_resi]
        .some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [rows, filter]);

  const stepCounts = useMemo(() => {
    const m: Record<Step, number> = { waiting: 0, cutting: 0, potong: 0, solder: 0, kabel: 0, tempel: 0, packing: 0, shipping: 0 };
    (rows ?? []).forEach((r) => { m[r.current_step] = (m[r.current_step] ?? 0) + 1; });
    return m;
  }, [rows]);

  return (
    <div className="mx-auto max-w-6xl p-3 sm:p-6 space-y-4 pb-24">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Status Orderan</h1>
          <p className="text-xs sm:text-sm text-slate-500">Pantau progres pengerjaan setiap orderan secara real-time.</p>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Step legend / summary chips */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {STEPS.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.key} className="rounded-xl border border-slate-200 bg-white p-2 text-center">
              <div className={`mx-auto grid h-8 w-8 place-items-center rounded-lg ${s.color} text-white`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="mt-1 text-[10px] font-medium text-slate-600 leading-tight">{s.short}</div>
              <div className="text-sm font-bold text-slate-900">{stepCounts[s.key] ?? 0}</div>
            </div>
          );
        })}
      </div>

      <Input
        placeholder="Cari no order / project / customer / resi..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="max-w-md"
      />

      {isLoading ? (
        <div className="text-sm text-slate-500 py-8 text-center">Memuat…</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-slate-500">Tidak ada orderan aktif saat ini.</CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((r) => (
            <ProjectCard key={r.project_id} row={r} onClick={() => setSelectedId(r.project_id)} />
          ))}
        </div>
      )}

      <DetailDialog projectId={selectedId} onOpenChange={(o) => !o && setSelectedId(null)} />
    </div>
  );
}

function ProjectCard({ row, onClick }: { row: Row; onClick: () => void }) {
  const cur = STEP_INDEX[row.current_step];
  const stepMeta = STEPS[cur];
  const Icon = stepMeta.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition-all active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-wide text-slate-400">{row.order_no ?? row.project_code}</div>
          <div className="font-semibold text-slate-900 truncate">{row.project_title}</div>
          {row.customer_name && (
            <div className="text-xs text-slate-500 truncate">👤 {row.customer_name}</div>
          )}
        </div>
        <Badge className={`${stepMeta.color} text-white border-transparent shrink-0 gap-1`}>
          <Icon className="h-3 w-3" /> {stepMeta.short}
        </Badge>
      </div>

      {/* Pipeline progress */}
      <div className="mt-3 flex items-center gap-1">
        {STEPS.map((s, i) => {
          const done = i < cur || (i === cur && cur === STEPS.length - 1);
          const active = i === cur;
          return (
            <div
              key={s.key}
              className={`h-1.5 flex-1 rounded-full ${done ? s.color : active ? s.color : "bg-slate-200"} ${active ? "ring-2 ring-offset-1 ring-slate-300" : ""}`}
              title={s.label}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
        <span>{stepMeta.label}</span>
        <span>{cur + 1}/{STEPS.length}</span>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>{row.co_date ? format(new Date(row.co_date), "dd MMM yyyy", { locale: idLocale }) : "-"}</span>
        {row.no_resi && <span className="font-mono">📦 {row.no_resi}</span>}
      </div>
    </button>
  );
}

function DetailDialog({ projectId, onOpenChange }: { projectId: string | null; onOpenChange: (o: boolean) => void }) {
  const { data } = useQuery({
    enabled: !!projectId,
    queryKey: ["project-worker-detail", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_project_detail_for_worker" as never, { _project_id: projectId } as never);
      if (error) throw error;
      return data as unknown as {
        project: { id: string; code: string; title: string; status: string; total_points: number; contract_value: number; deadline: string | null; description: string | null };
        customer: { name: string | null; phone: string | null };
        order: { id: string; order_no: string; status: string; co_date: string | null; text_neon: string | null; kota: string | null; username: string | null; ekspedisi: string | null; no_resi: string | null; ready_pickup_at: string | null; picked_up_at: string | null; akrilik_p: number | null; akrilik_l: number | null; led_meter: number | null; titik: number | null; notes: string | null } | null;
        claims: Array<{ rate_name: string; unit: string; qty: number; status: string; is_repair: boolean; employee_name: string; log_date: string }>;
      };
    },
  });

  return (
    <Dialog open={!!projectId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detail Orderan</DialogTitle>
        </DialogHeader>
        {!data ? (
          <div className="py-8 text-center text-sm text-slate-500">Memuat…</div>
        ) : (
          <div className="space-y-4 text-sm">
            <section className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <div className="font-mono text-[11px] text-slate-500">{data.order?.order_no ?? data.project.code}</div>
              <div className="font-semibold text-slate-900">{data.project.title}</div>
              {data.order?.text_neon && <div className="text-xs text-slate-600 mt-1">Text: {data.order.text_neon}</div>}
            </section>

            <section className="grid grid-cols-2 gap-2 text-xs">
              <Info label="Customer" value={data.customer.name ?? "-"} />
              <Info label="No. HP" value={data.customer.phone ?? "🔒 Dirahasiakan"} />
              <Info label="Kota" value={data.order?.kota ?? "-"} />
              <Info label="Tgl CO" value={data.order?.co_date ? format(new Date(data.order.co_date), "dd MMM yyyy", { locale: idLocale }) : "-"} />
              <Info label="Titik" value={String(data.order?.titik ?? data.project.total_points)} />
              <Info label="LED (m)" value={String(data.order?.led_meter ?? "-")} />
              <Info label="Akrilik P" value={data.order?.akrilik_p ? `${data.order.akrilik_p} cm` : "-"} />
              <Info label="Akrilik L" value={data.order?.akrilik_l ? `${data.order.akrilik_l} cm` : "-"} />
              <Info label="Ekspedisi" value={data.order?.ekspedisi ?? "-"} />
              <Info label="No. Resi" value={data.order?.no_resi ?? "-"} />
            </section>

            <section>
              <div className="text-xs font-semibold text-slate-700 mb-2">Progres Pengerjaan</div>
              {data.claims.length === 0 ? (
                <div className="text-xs text-slate-500 italic">Belum ada klaim garapan.</div>
              ) : (
                <ul className="space-y-1.5">
                  {data.claims.map((c, i) => (
                    <li key={i} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 p-2 text-xs">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-800">
                          {c.rate_name} {c.is_repair && <span className="text-orange-600">🔧</span>}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {c.employee_name} · {format(new Date(c.log_date), "dd MMM yyyy", { locale: idLocale })}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-semibold">{c.qty} {c.unit}</div>
                        <Badge variant={c.status === "approved" ? "default" : c.status === "rejected" ? "destructive" : "secondary"} className="text-[10px] mt-0.5">
                          {c.status}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {(data.order?.ready_pickup_at || data.order?.picked_up_at) && (
              <section className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs space-y-1">
                {data.order?.ready_pickup_at && (
                  <div>📦 Siap pickup: <span className="font-medium">{format(new Date(data.order.ready_pickup_at), "dd MMM yyyy HH:mm", { locale: idLocale })}</span></div>
                )}
                {data.order?.picked_up_at && (
                  <div>🚚 Diambil kurir: <span className="font-medium">{format(new Date(data.order.picked_up_at), "dd MMM yyyy HH:mm", { locale: idLocale })}</span></div>
                )}
              </section>
            )}

            {data.order?.notes && (
              <section className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs">
                <div className="font-semibold text-amber-900 mb-1">Catatan</div>
                <div className="text-amber-800 whitespace-pre-wrap">{data.order.notes}</div>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-slate-900 truncate" title={value}>{value}</div>
    </div>
  );
}
