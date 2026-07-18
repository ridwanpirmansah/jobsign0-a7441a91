import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResiScanner } from "@/components/ResiScanner";
import { Scissors, Zap, Cable, Sparkles, PackageCheck, Truck, Clock, Ruler, RefreshCw, AlertTriangle, ScanLine } from "lucide-react";
import { format, differenceInCalendarDays } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { toast } from "sonner";
import { beepSuccess, beepError } from "@/lib/scan-feedback";

export const Route = createFileRoute("/_authenticated/status")({
  component: StatusPage,
  head: () => ({ meta: [{ title: "Status Orderan" }] }),
});

type Step = "waiting" | "cutting" | "potong" | "solder" | "tempel" | "kabel" | "packing" | "shipping";
type Row = {
  project_id: string; project_code: string; project_title: string;
  customer_name: string | null; total_points: number;
  deadline: string | null;
  order_id: string | null; order_no: string | null; order_status: string | null;
  co_date: string | null; ekspedisi: string | null; no_resi: string | null;
  ready_pickup_at: string | null; picked_up_at: string | null;
  has_cut: boolean; has_potong: boolean; has_solder: boolean; has_kabel: boolean; has_tempel: boolean;
  cut_qty: number; potong_qty: number; solder_qty: number; kabel_qty: number; tempel_qty: number;
  current_step: Step;
};

const STEPS: { key: Step; label: string; short: string; icon: React.ComponentType<{ className?: string }>; color: string }[] = [
  { key: "waiting",  label: "Menunggu pengrajin", short: "Antrian",    icon: Clock,         color: "bg-slate-400" },
  { key: "cutting",  label: "Cutting Akrilik", short: "Potong Akrlk", icon: Scissors,      color: "bg-orange-500" },
  { key: "potong",   label: "Potong",          short: "Potong LED", icon: Ruler,         color: "bg-blue-500" },
  { key: "solder",   label: "Solder",          short: "Solder", icon: Zap,           color: "bg-amber-500" },
  { key: "tempel",   label: "Tempel LED",      short: "Tempel", icon: Sparkles,      color: "bg-emerald-500" },
  { key: "kabel",    label: "Proses Pengkabelan", short: "Pengkabelan",  icon: Cable,         color: "bg-purple-500" },
  { key: "packing",  label: "Sedang dikemas",  short: "Dikemas", icon: PackageCheck,  color: "bg-teal-500" },
  { key: "shipping", label: "Dikirim",         short: "Dikirim", icon: Truck,         color: "bg-green-600" },
];

const STEP_INDEX: Record<Step, number> = STEPS.reduce((acc, s, i) => ({ ...acc, [s.key]: i }), {} as Record<Step, number>);

function deadlineMeta(deadline: string | null) {
  if (!deadline) return null;
  const days = differenceInCalendarDays(new Date(deadline), new Date());
  let tone = "bg-slate-100 text-slate-600 border-slate-200";
  let label = `${days} hari lagi`;
  if (days < 0) { tone = "bg-red-100 text-red-700 border-red-200"; label = `Lewat ${Math.abs(days)}h`; }
  else if (days === 0) { tone = "bg-red-100 text-red-700 border-red-200"; label = "Hari ini"; }
  else if (days <= 2) { tone = "bg-orange-100 text-orange-700 border-orange-200"; label = `${days} hari lagi`; }
  else if (days <= 5) { tone = "bg-amber-100 text-amber-700 border-amber-200"; }
  return { days, tone, label };
}

function StatusPage() {
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [sortBy, setSortBy] = useState<"co_date_desc" | "co_date_asc" | "deadline_asc" | "deadline_desc" | "progress_asc" | "progress_desc">("co_date_desc");
  const [stepFilter, setStepFilter] = useState<Step | "all">("all");

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
    let list = (rows ?? []).filter((r) => {
      // Exclude ready-stock orders from active pipeline
      if ((r.order_status ?? "") === "ready_stock") return false;
      if (String(r.order_no ?? "").toUpperCase().startsWith("RS-")) return false;
      if (stepFilter !== "all" && r.current_step !== stepFilter) return false;
      if (!q) return true;
      return [r.project_code, r.project_title, r.order_no, r.customer_name, r.no_resi]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
    });
    const cmp = (a: Row, b: Row): number => {
      switch (sortBy) {
        case "co_date_asc":
          return (a.co_date ?? "").localeCompare(b.co_date ?? "");
        case "co_date_desc":
          return (b.co_date ?? "").localeCompare(a.co_date ?? "");
        case "deadline_asc":
          return (a.deadline ?? "9999-12-31").localeCompare(b.deadline ?? "9999-12-31");
        case "deadline_desc":
          return (b.deadline ?? "0000-01-01").localeCompare(a.deadline ?? "0000-01-01");
        case "progress_asc":
          return STEP_INDEX[a.current_step] - STEP_INDEX[b.current_step];
        case "progress_desc":
          return STEP_INDEX[b.current_step] - STEP_INDEX[a.current_step];
      }
    };
    return [...list].sort(cmp);
  }, [rows, filter, stepFilter, sortBy]);

  const stepCounts = useMemo(() => {
    const m: Record<Step, number> = { waiting: 0, cutting: 0, potong: 0, solder: 0, tempel: 0, kabel: 0, packing: 0, shipping: 0 };
    (rows ?? []).forEach((r) => {
      if ((r.order_status ?? "") === "ready_stock") return;
      if (String(r.order_no ?? "").toUpperCase().startsWith("RS-")) return;
      m[r.current_step] = (m[r.current_step] ?? 0) + 1;
    });
    return m;
  }, [rows]);

  const handleScan = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const match = (rows ?? []).find((r) => {
      const resi = String(r.no_resi ?? "").trim();
      const orderNo = String(r.order_no ?? "").trim();
      return resi && text === resi
        || (resi && text.toLowerCase() === resi.toLowerCase())
        || (orderNo && text.toLowerCase() === orderNo.toLowerCase());
    });
    if (match) {
      beepSuccess();
      toast.success(`Ditemukan #${match.order_no ?? match.project_code}`);
      setSelectedId(match.project_id);
      setScanOpen(false);
    } else {
      beepError();
      toast.error(`Resi/order "${text}" tidak ditemukan pada orderan aktif`);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-3 sm:p-6 space-y-4 pb-24">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Status Orderan</h1>
          <p className="text-xs sm:text-sm text-slate-500">Pantau progres pengerjaan setiap orderan secara real-time.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setScanOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-xs font-medium text-cyan-800 hover:bg-cyan-100"
          >
            <ScanLine className="h-3.5 w-3.5" /> Scan Resi
          </button>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />Refresh
          </button>
        </div>
      </div>

      {/* Step legend / summary chips — click to filter */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {STEPS.map((s) => {
          const Icon = s.icon;
          const active = stepFilter === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setStepFilter((cur) => cur === s.key ? "all" : s.key)}
              className={`rounded-xl border p-2 text-center min-w-0 transition ${active ? "border-slate-900 bg-slate-50 ring-2 ring-slate-900" : "border-slate-200 bg-white hover:border-slate-300"}`}
            >
              <div className={`mx-auto grid h-8 w-8 place-items-center rounded-lg ${s.color} text-white`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="mt-1 text-[10px] font-medium text-slate-600 leading-tight truncate">{s.short}</div>
              <div className="text-sm font-bold text-slate-900">{stepCounts[s.key] ?? 0}</div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="Cari no order / project / customer / resi..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-md"
        />
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="co_date_desc">Tanggal CO — Terbaru</SelectItem>
            <SelectItem value="co_date_asc">Tanggal CO — Terlama</SelectItem>
            <SelectItem value="deadline_asc">Deadline — Terdekat</SelectItem>
            <SelectItem value="deadline_desc">Deadline — Terjauh</SelectItem>
            <SelectItem value="progress_asc">Progress — Terkecil dulu</SelectItem>
            <SelectItem value="progress_desc">Progress — Terbesar dulu</SelectItem>
          </SelectContent>
        </Select>
        {stepFilter !== "all" && (
          <button
            onClick={() => setStepFilter("all")}
            className="text-xs text-slate-500 underline hover:text-slate-800"
          >Reset filter tahap</button>
        )}
      </div>

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

      <Dialog open={scanOpen} onOpenChange={setScanOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ScanLine className="h-4 w-4"/> Scan Resi Paket</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Scan barcode resi untuk membuka detail orderan tanpa harus mencari manual.</p>
          <ResiScanner onScan={handleScan} active={scanOpen} />
          <div>
            <Input
              autoFocus placeholder="Atau ketik nomor resi / order lalu Enter"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = (e.target as HTMLInputElement).value;
                  handleScan(v);
                }
              }}
              className="font-mono"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProjectCard({ row, onClick }: { row: Row; onClick: () => void }) {
  const cur = STEP_INDEX[row.current_step];
  const stepMeta = STEPS[cur];
  const Icon = stepMeta.icon;
  const dl = deadlineMeta(row.deadline);
  const urgent = dl && dl.days <= 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full min-w-0 overflow-hidden text-left rounded-2xl border bg-white p-3 sm:p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition-all active:scale-[0.99] ${urgent ? "border-red-300 ring-1 ring-red-200" : "border-slate-200"}`}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-wide text-slate-400 truncate">{row.order_no ?? row.project_code}</div>
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
              className={`h-1.5 flex-1 min-w-0 rounded-full ${done ? s.color : active ? s.color : "bg-slate-200"} ${active ? "ring-2 ring-offset-1 ring-slate-300" : ""}`}
              title={s.label}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-slate-500 min-w-0">
        <span className="truncate">{stepMeta.label}</span>
        <span className="shrink-0">{cur + 1}/{STEPS.length}</span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500 min-w-0">
        <span className="truncate">{row.co_date ? format(new Date(row.co_date), "dd MMM yyyy", { locale: idLocale }) : "-"}</span>
        {row.no_resi && (
          <span className="font-mono truncate max-w-[55%] text-right" title={row.no_resi}>📦 {row.no_resi}</span>
        )}
      </div>

      {dl && (
        <div className={`mt-2 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium ${dl.tone}`}>
          {urgent && <AlertTriangle className="h-3 w-3" />}
          Deadline: {format(new Date(row.deadline!), "dd MMM", { locale: idLocale })} · {dl.label}
        </div>
      )}
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
        order: { id: string; order_no: string; status: string; co_date: string | null; text_neon: string | null; kota: string | null; username: string | null; ekspedisi: string | null; no_resi: string | null; ready_pickup_at: string | null; picked_up_at: string | null; akrilik_p: number | null; akrilik_l: number | null; led_meter: number | null; titik: number | null; kabel_meter: number | null; kabel_socket_meter: number | null; notes: string | null } | null;
        claims: Array<{ rate_name: string; unit: string; qty: number; status: string; is_repair: boolean; employee_name: string; log_date: string }>;
      };
    },
  });

  const dl = data ? deadlineMeta(data.project.deadline) : null;

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
              {dl && (
                <div className={`mt-2 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${dl.tone}`}>
                  {dl.days <= 0 && <AlertTriangle className="h-3 w-3" />}
                  Deadline: {format(new Date(data.project.deadline!), "dd MMM yyyy", { locale: idLocale })} · {dl.label}
                </div>
              )}
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
              <Info label="Kabel (m)" value={data.order?.kabel_meter != null ? `${data.order.kabel_meter} m` : "-"} />
              <Info label="Kabel Socket (m)" value={data.order?.kabel_socket_meter != null ? `${data.order.kabel_socket_meter} m` : "-"} />
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
    <div className="rounded-lg border border-slate-200 bg-white p-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-slate-900 truncate" title={value}>{value}</div>
    </div>
  );
}
