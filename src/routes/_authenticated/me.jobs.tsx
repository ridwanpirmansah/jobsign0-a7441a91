import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Trash2, CheckCheck, ShieldCheck, Search, FolderOpen, ChevronDown, Check, Package, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/me/jobs")({ component: MyJobs });

function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
}

function MyJobs() {
  const { data: me } = useCurrentUser();
  const staff = isStaff(me?.role);
  const qc = useQueryClient();

  const [projectId, setProjectId] = useState<string>("");
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [note, setNote] = useState("");
  const [qtyMap, setQtyMap] = useState<Record<string, string>>({});
  const [onBehalfEmpId, setOnBehalfEmpId] = useState<string>("");



  // Active employees (for admin/owner on-behalf submission)
  const { data: employees } = useQuery({
    enabled: staff,
    queryKey: ["employees-borongan-active"],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("id, full_name, type").eq("active", true).order("full_name");
      return data ?? [];
    },
  });

  const effectiveEmpId = staff && onBehalfEmpId ? onBehalfEmpId : me?.employee?.id;

  const { data: projects } = useQuery({
    queryKey: ["available-projects"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_available_projects");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; code: string; title: string; status: string; total_points: number; claimed_points: number; remaining_points: number }>;
    },
  });

  const { data: rateAvail } = useQuery({
    enabled: !!projectId,
    queryKey: ["project-rate-availability", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_project_rate_availability", { _project_id: projectId });
      if (error) throw error;
      return (data ?? []) as Array<{ rate_id: string; rate_name: string; unit: string; rate_per_unit: number; total_points: number; claimed_points: number; remaining_points: number }>;
    },
  });

  const { data: rates } = useQuery({
    queryKey: ["rates-active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("job_rates")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      return data ?? [];
    },
  });

  const { data: logs } = useQuery({
    enabled: !!effectiveEmpId,
    queryKey: ["my-logs", effectiveEmpId],
    queryFn: async () => {
      const { data } = await supabase.from("job_logs")
        .select("*, project:projects(code,title), rate:job_rates(name,unit,rate_per_unit)")
        .eq("employee_id", effectiveEmpId!).order("log_date", { ascending: false }).limit(50);
      return data ?? [];
    },
  });

  // Auto akrilik dimensions from project's parent order (for area-based rates)
  const { data: projectAkrilik } = useQuery({
    enabled: !!projectId,
    queryKey: ["project-akrilik", projectId],
    queryFn: async () => {
      const { data: proj } = await supabase.from("projects").select("parent_order_id").eq("id", projectId).maybeSingle();
      const parentId = proj?.parent_order_id;
      if (!parentId) return { p: 0, l: 0 };
      const { data: ord } = await supabase.from("orders").select("akrilik_p, akrilik_l").eq("id", parentId).maybeSingle();
      let p = Number(ord?.akrilik_p ?? 0);
      let l = Number(ord?.akrilik_l ?? 0);
      if (!p || !l) {
        const { data: items } = await supabase.from("order_items").select("akrilik_p, akrilik_l").eq("order_id", parentId);
        const it = (items ?? []).find((i) => Number(i.akrilik_p) > 0 && Number(i.akrilik_l) > 0);
        if (it) { p = Number(it.akrilik_p); l = Number(it.akrilik_l); }
      }
      return { p, l };
    },
  });

  const selectedProject = projects?.find((p) => p.id === projectId);

  const filteredProjects = useMemo(() => {
    const list = projects ?? [];
    const q = projectSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) =>
      `${p.code} ${p.title}`.toLowerCase().includes(q)
    );
  }, [projects, projectSearch]);

  // Colorful accents so the list matches the vibe of the attendance history page
  const projectPalette = [
    { ring: "ring-sky-200", bg: "bg-sky-50", chip: "bg-sky-100 text-sky-700 border-sky-200", dot: "bg-sky-500" },
    { ring: "ring-violet-200", bg: "bg-violet-50", chip: "bg-violet-100 text-violet-700 border-violet-200", dot: "bg-violet-500" },
    { ring: "ring-emerald-200", bg: "bg-emerald-50", chip: "bg-emerald-100 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
    { ring: "ring-amber-200", bg: "bg-amber-50", chip: "bg-amber-100 text-amber-700 border-amber-200", dot: "bg-amber-500" },
    { ring: "ring-rose-200", bg: "bg-rose-50", chip: "bg-rose-100 text-rose-700 border-rose-200", dot: "bg-rose-500" },
    { ring: "ring-teal-200", bg: "bg-teal-50", chip: "bg-teal-100 text-teal-700 border-teal-200", dot: "bg-teal-500" },
  ];


  // Build a unified list of rate rows for display
  type Row = { rate_id: string; rate_name: string; unit: string; rate_per_unit: number; remaining: number | null; total: number | null; claimed: number | null; pricing_mode: "per_unit" | "area"; min_amount: number };
  const ratesMeta = useMemo(() => {
    const m = new Map<string, { pricing_mode: "per_unit" | "area"; min_amount: number }>();
    (rates ?? []).forEach((r) => {
      const anyR = r as typeof r & { pricing_mode?: "per_unit" | "area"; min_amount?: number | string };
      m.set(r.id, { pricing_mode: (anyR.pricing_mode ?? "per_unit") as "per_unit" | "area", min_amount: Number(anyR.min_amount ?? 0) });
    });
    return m;
  }, [rates]);
  const rateRows: Row[] = useMemo(() => {
    if (projectId) {
      return (rateAvail ?? []).map((r) => {
        const meta = ratesMeta.get(r.rate_id) ?? { pricing_mode: "per_unit" as const, min_amount: 0 };
        return {
          rate_id: r.rate_id,
          rate_name: r.rate_name,
          unit: r.unit,
          rate_per_unit: Number(r.rate_per_unit),
          // For area rates, "remaining" acts as "0 if already claimed, 1 if still available"
          remaining: meta.pricing_mode === "area" ? (Number(r.claimed_points) > 0 ? 0 : 1) : Number(r.remaining_points),
          total: meta.pricing_mode === "area" ? null : Number(r.total_points),
          claimed: meta.pricing_mode === "area" ? Number(r.claimed_points) : Number(r.claimed_points),
          pricing_mode: meta.pricing_mode,
          min_amount: meta.min_amount,
        };
      });
    }
    return (rates ?? []).map((r) => {
      const anyR = r as typeof r & { pricing_mode?: "per_unit" | "area"; min_amount?: number | string };
      return {
        rate_id: r.id,
        rate_name: r.name,
        unit: r.unit,
        rate_per_unit: Number(r.rate_per_unit),
        remaining: null,
        total: null,
        claimed: null,
        pricing_mode: (anyR.pricing_mode ?? "per_unit") as "per_unit" | "area",
        min_amount: Number(anyR.min_amount ?? 0),
      };
    });
  }, [projectId, rateAvail, rates, ratesMeta]);



  const submitMut = useMutation({
    mutationFn: async (args: { rateId: string; qty: number }) => {
      if (!effectiveEmpId) throw new Error("Pilih karyawan terlebih dahulu");
      if (!args.qty || args.qty <= 0) throw new Error("Qty harus lebih dari 0");
      const row = rateRows.find((r) => r.rate_id === args.rateId);
      if (row?.pricing_mode !== "area" && row?.remaining !== null && row && args.qty > row.remaining!) {
        throw new Error(`Sisa titik ${row.rate_name} hanya ${row.remaining}`);
      }
      const { error } = await supabase.from("job_logs").insert({
        employee_id: effectiveEmpId,
        project_id: projectId || null,
        rate_id: args.rateId,
        qty: args.qty,
        note: note || null,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: (_d, args) => {
      toast.success("Laporan tersimpan");
      setQtyMap((m) => ({ ...m, [args.rateId]: "" }));
      qc.invalidateQueries({ queryKey: ["my-logs"] });
      qc.invalidateQueries({ queryKey: ["available-projects"] });
      qc.invalidateQueries({ queryKey: ["project-rate-availability"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitAllForTypeMut = useMutation({
    mutationFn: async (rateId: string) => {
      if (!effectiveEmpId) throw new Error("Pilih karyawan terlebih dahulu");
      const row = rateRows.find((r) => r.rate_id === rateId);
      if (!row) throw new Error("Tarif tidak ditemukan");
      if (row.remaining === null || row.remaining === undefined) throw new Error("Pilih project terlebih dahulu untuk mengetahui sisa titik");
      if (row.remaining <= 0) throw new Error(`Sisa titik ${row.rate_name} sudah habis`);
      const { error } = await supabase.from("job_logs").insert({
        employee_id: effectiveEmpId,
        project_id: projectId || null,
        rate_id: rateId,
        qty: row.remaining,
        note: note || null,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: (_d, rateId) => {
      toast.success("Semua titik berhasil diklaim");
      setQtyMap((m) => ({ ...m, [rateId]: "" }));
      qc.invalidateQueries({ queryKey: ["my-logs"] });
      qc.invalidateQueries({ queryKey: ["available-projects"] });
      qc.invalidateQueries({ queryKey: ["project-rate-availability"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitAllMut = useMutation({
    mutationFn: async () => {
      if (!effectiveEmpId) throw new Error("Pilih karyawan terlebih dahulu");
      const rows = rateRows.filter((r) => r.remaining !== null && r.remaining !== undefined && r.remaining > 0);
      if (!rows.length) throw new Error("Tidak ada titik tersisa untuk diklaim");
      const inserts = rows.map((r) => ({
        employee_id: effectiveEmpId,
        project_id: projectId || null,
        rate_id: r.rate_id,
        qty: r.remaining!,
        note: note || null,
        status: "pending" as const,
      }));
      const { error } = await supabase.from("job_logs").insert(inserts);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Seluruh pekerjaan berhasil diklaim");
      setQtyMap({});
      qc.invalidateQueries({ queryKey: ["my-logs"] });
      qc.invalidateQueries({ queryKey: ["available-projects"] });
      qc.invalidateQueries({ queryKey: ["project-rate-availability"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("job_logs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Laporan dihapus");
      qc.invalidateQueries({ queryKey: ["my-logs"] });
      qc.invalidateQueries({ queryKey: ["available-projects"] });
      qc.invalidateQueries({ queryKey: ["project-rate-availability"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Input Garapan Borongan</h1>
        <p className="text-sm text-slate-500">Catat hasil garapan per titik. Admin akan meninjau & menyetujui.</p>
      </div>

      {staff && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-900">
              <ShieldCheck className="h-4 w-4" /> Mode Admin — Input atas nama karyawan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <Label>Karyawan</Label>
                <Select value={onBehalfEmpId} onValueChange={setOnBehalfEmpId}>
                  <SelectTrigger><SelectValue placeholder={me?.employee ? "Diri sendiri (default)" : "Pilih karyawan"} /></SelectTrigger>
                  <SelectContent>
                    {me?.employee && <SelectItem value={me.employee.id}>{me.employee.full_name} (saya)</SelectItem>}
                    {employees?.filter((e) => e.id !== me?.employee?.id).map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.full_name} {e.type ? `· ${e.type}` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs mt-1 text-amber-800">Laporan akan tercatat atas nama karyawan terpilih.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Laporan Baru</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Project</Label>
              <Popover open={projectOpen} onOpenChange={(o) => { setProjectOpen(o); if (!o) setProjectSearch(""); }}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between h-auto min-h-11 py-2 px-3 bg-gradient-to-r from-sky-50 via-white to-violet-50 border-sky-200 hover:from-sky-100 hover:to-violet-100"
                  >
                    {selectedProject ? (
                      <div className="flex items-start gap-2 min-w-0 text-left">
                        <FolderOpen className="h-4 w-4 mt-0.5 text-sky-600 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-sky-700">{selectedProject.code}</div>
                          <div className="text-sm text-slate-900 leading-tight whitespace-normal break-words">
                            {selectedProject.title}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Sisa <span className="font-semibold text-emerald-600">{selectedProject.remaining_points}</span>/{selectedProject.total_points} titik
                          </div>
                        </div>
                      </div>
                    ) : (
                      <span className="flex items-center gap-2 text-slate-500">
                        <FolderOpen className="h-4 w-4" /> Pilih project
                      </span>
                    )}
                    <ChevronDown className="h-4 w-4 text-slate-400 shrink-0 ml-2" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="p-0 w-[calc(100vw-2rem)] sm:w-[440px] max-w-[540px]"
                  align="start"
                  sideOffset={6}
                >
                  <div className="p-2 border-b bg-gradient-to-r from-sky-50 to-violet-50 sticky top-0 z-10">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input
                        autoFocus
                        value={projectSearch}
                        onChange={(e) => setProjectSearch(e.target.value)}
                        placeholder="Cari kode atau nama project..."
                        className="pl-8 pr-8 h-10 bg-white"
                      />
                      {projectSearch && (
                        <button
                          type="button"
                          onClick={() => setProjectSearch("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                          aria-label="Bersihkan pencarian"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="mt-1.5 text-[11px] text-slate-500 px-1">
                      {filteredProjects.length} project ditemukan
                    </div>
                  </div>
                  <div className="max-h-[60vh] overflow-y-auto p-2 space-y-1.5">
                    {filteredProjects.map((p, idx) => {
                      const rem = Number(p.remaining_points);
                      const full = rem <= 0;
                      const active = p.id === projectId;
                      const c = projectPalette[idx % projectPalette.length];
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={full}
                          onClick={() => { setProjectId(p.id); setProjectOpen(false); setProjectSearch(""); }}
                          className={`w-full text-left rounded-lg border p-2.5 transition ${
                            full
                              ? "opacity-50 cursor-not-allowed bg-slate-50 border-slate-200"
                              : active
                                ? `${c.bg} ring-2 ${c.ring} border-transparent`
                                : `${c.bg} border-transparent hover:ring-2 hover:${c.ring}`
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <div className={`h-8 w-8 rounded-md ${c.dot} text-white grid place-items-center shrink-0 shadow-sm`}>
                              <Package className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded border ${c.chip}`}>
                                  {p.code}
                                </span>
                                {full && <span className="text-[10px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">PENUH</span>}
                                {active && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                              </div>
                              <div className="text-sm font-semibold text-slate-900 leading-snug mt-1 whitespace-normal break-words">
                                {p.title}
                              </div>
                              <div className="text-[11px] text-slate-600 mt-1 flex items-center gap-1.5">
                                <span className={`inline-block h-1.5 w-1.5 rounded-full ${full ? "bg-rose-500" : "bg-emerald-500"}`} />
                                Sisa <span className="font-semibold text-slate-900">{rem}</span> / {p.total_points} titik
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    {!filteredProjects.length && (
                      <div className="px-3 py-8 text-center text-sm text-slate-500">
                        {projects?.length ? "Project tidak ditemukan" : "Belum ada project tersedia"}
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              {selectedProject && (
                <p className="text-xs mt-1 text-slate-500">
                  Total sisa garapan: <span className="font-semibold text-slate-900">{selectedProject.remaining_points}</span> dari <span className="font-semibold text-slate-900">{selectedProject.total_points}</span> titik gabungan
                </p>
              )}
            </div>
            <div>
              <Label>Beri Catatan Untuk Project ini</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Jenis Garapan</Label>
              {projectId && rateRows.some((r) => r.remaining !== null && r.remaining > 0) && (
                <Button
                  type="button"
                  size="sm"
                  className="bg-red-500 hover:bg-red-600 text-white"
                  disabled={submitAllMut.isPending || !effectiveEmpId}
                  onClick={() => submitAllMut.mutate()}
                  title="Klaim seluruh titik untuk semua jenis garapan sekaligus"
                >
                  <CheckCheck className="h-4 w-4 mr-1" /> Klaim Semua Pekerjaan
                </Button>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {rateRows.map((r) => {
                const isArea = r.pricing_mode === "area";
                const pNum = isArea ? Number(projectAkrilik?.p ?? 0) : 0;
                const lNum = isArea ? Number(projectAkrilik?.l ?? 0) : 0;
                const areaQty = pNum * lNum;
                const qty = qtyMap[r.rate_id] ?? "";
                const qtyNum = isArea ? areaQty : (Number(qty) || 0);
                const rawPreview = qtyNum * r.rate_per_unit;
                const preview = r.min_amount > 0 ? Math.max(rawPreview, r.min_amount) : rawPreview;
                const minApplied = r.min_amount > 0 && qtyNum > 0 && rawPreview < r.min_amount;
                const full = !isArea && r.remaining !== null && r.remaining <= 0;
                const areaClaimed = isArea && projectId && Number(r.claimed ?? 0) > 0;
                const hasRemaining = !isArea && r.remaining !== null && r.remaining > 0;
                const areaMissing = isArea && projectId && !areaClaimed && (!pNum || !lNum);
                const areaNoProject = isArea && !projectId;
                const areaClaimable = isArea && !!projectId && !areaClaimed && !areaMissing;
                const disabledClaim = full || areaClaimed || areaMissing || areaNoProject;
                return (
                  <div key={r.rate_id} className={`rounded-lg border p-3 ${(full || areaClaimed) ? "bg-slate-50 opacity-60" : "bg-white"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-900">{r.rate_name}</div>
                        <div className="text-xs text-slate-500">
                          {fmtIDR(r.rate_per_unit)}/{r.unit}
                          {r.min_amount > 0 && <> · min {fmtIDR(r.min_amount)}</>}
                        </div>
                      </div>
                      {isArea ? (
                        areaClaimed
                          ? <Badge variant="secondary" className="text-xs">Sudah diklaim</Badge>
                          : <Badge variant="outline" className="text-xs">P × L (otomatis)</Badge>
                      ) : r.remaining !== null && (
                        <Badge variant={full ? "secondary" : "outline"} className="text-xs">
                          Sisa {r.remaining}/{r.total}
                        </Badge>
                      )}
                    </div>
                    {isArea ? (
                      <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 p-2 text-xs space-y-1">
                        {areaNoProject ? (
                          <div className="text-amber-700">Pilih project terlebih dahulu untuk mengambil ukuran akrilik.</div>
                        ) : areaClaimed ? (
                          <div className="text-slate-600">Sudah diklaim oleh karyawan lain. Hanya 1 orang yang boleh mengklaim jenis garapan ini per project.</div>
                        ) : areaMissing ? (
                          <div className="text-amber-700">Ukuran akrilik pada order belum diisi. Hubungi admin untuk melengkapi Akrilik P/L pada order.</div>
                        ) : (
                          <div className="flex items-center justify-between text-slate-700">
                            <span>Panjang: <span className="font-semibold text-slate-900">{pNum}</span> cm</span>
                            <span>Lebar: <span className="font-semibold text-slate-900">{lNum}</span> cm</span>
                            <span>Qty: <span className="font-semibold text-slate-900">{areaQty}</span> {r.unit}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center gap-2">
                        <Input
                          type="number" step="0.01" min="0" max={r.remaining ?? undefined}
                          placeholder="Qty"
                          value={qty}
                          onChange={(e) => setQtyMap((m) => ({ ...m, [r.rate_id]: e.target.value }))}
                          disabled={full}
                          className="h-9"
                        />
                        {hasRemaining && (
                          <Button
                            type="button" size="sm" variant="outline"
                            className="bg-sky-400 hover:bg-sky-500 text-white border-sky-400 hover:border-sky-500"
                            onClick={() => setQtyMap((m) => ({ ...m, [r.rate_id]: String(r.remaining) }))}
                            title="Isi otomatis seluruh sisa titik"
                          >
                            <CheckCheck className="h-4 w-4 mr-1" /> Semua
                          </Button>
                        )}
                      </div>
                    )}

                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-xs text-slate-500">
                        Upah: <span className="font-semibold text-slate-900">{fmtIDR(preview)}</span>
                        {minApplied && <span className="ml-1 text-amber-600">(min)</span>}
                      </div>
                      <div className="flex gap-2">
                        {hasRemaining && (
                          <Button
                            type="button" size="sm" variant="outline"
                            className="bg-yellow-400 hover:bg-yellow-500 text-white border-yellow-400 hover:border-yellow-500"
                            disabled={submitAllForTypeMut.isPending || !effectiveEmpId}
                            onClick={() => submitAllForTypeMut.mutate(r.rate_id)}
                            title={`Langsung klaim seluruh ${r.remaining} ${r.unit} ${r.rate_name}`}
                          >
                            Klaim Semua
                          </Button>
                        )}
                        {(!isArea || areaClaimable) && (
                          <Button
                            type="button" size="sm"
                            className="bg-green-500 hover:bg-green-600 text-white"
                            disabled={!qtyNum || disabledClaim || submitMut.isPending || !effectiveEmpId}
                            onClick={() => submitMut.mutate({ rateId: r.rate_id, qty: qtyNum })}
                          >
                            {isArea ? "Klaim" : "Simpan"}
                          </Button>
                        )}

                      </div>
                    </div>
                  </div>
                );
              })}


              {!rateRows.length && <div className="text-sm text-slate-500 py-4">Belum ada tarif aktif.</div>}
            </div>
            {!effectiveEmpId && (
              <p className="mt-3 text-xs text-rose-600">
                {staff
                  ? "Pilih karyawan terlebih dahulu untuk menyimpan laporan."
                  : "Akun Anda belum terhubung ke data karyawan. Silakan hubungi admin/owner."}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Riwayat Laporan {staff && onBehalfEmpId && onBehalfEmpId !== me?.employee?.id ? "Karyawan Terpilih" : "Saya"}</CardTitle></CardHeader>
        <CardContent className="p-0 sm:p-6">
          {/* Mobile: cards */}
          <div className="md:hidden space-y-3 p-3">
            {logs?.map((l) => (
              <div key={l.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500">{format(new Date(l.log_date), "EEE, dd MMM yyyy", { locale: idLocale })}</div>
                    {l.project && <div className="text-sm font-medium text-slate-900 truncate">{l.project.title}</div>}
                    {l.project && <div className="font-mono text-[10px] text-slate-400">{l.project.code}</div>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {l.is_repair && <Badge className="bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100 text-[10px]">🔧 Reparasi</Badge>}
                    <Badge variant={l.status === "approved" ? "default" : l.status === "rejected" ? "destructive" : "secondary"}>{l.status}</Badge>
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm border-t border-dashed border-slate-200 pt-2">
                  <span className="text-slate-600">{l.rate?.name} <span className="text-slate-400">× {l.qty}</span></span>
                  <span className="font-bold text-emerald-600">{fmtIDR(Number(l.amount))}</span>
                </div>
                {(l.status === "pending" || staff) && (
                  <div className="flex justify-end">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50">
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Hapus
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Hapus laporan ini?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Laporan {l.qty} × {l.rate?.name} ({fmtIDR(Number(l.amount))}) akan dihapus permanen.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Batal</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMut.mutate(l.id)} className="bg-rose-600 hover:bg-rose-700">Hapus</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </div>
            ))}
            {!logs?.length && <div className="text-center text-slate-500 py-6 text-sm">Belum ada laporan</div>}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Tarif</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Upah</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12 text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs?.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{format(new Date(l.log_date), "EEE, dd MMM yyyy", { locale: idLocale })}</TableCell>
                    <TableCell>
                      {l.project ? (
                        <div className="leading-tight">
                          <div className="font-mono text-xs text-slate-500">{l.project.code}</div>
                          <div className="font-medium text-slate-900">{l.project.title}</div>
                        </div>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span>{l.rate?.name}</span>
                        {l.is_repair && <Badge className="bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100 text-[10px]">🔧 Reparasi</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{l.qty}</TableCell>
                    <TableCell className="text-right font-medium">{fmtIDR(Number(l.amount))}</TableCell>
                    <TableCell>
                      <Badge variant={l.status === "approved" ? "default" : l.status === "rejected" ? "destructive" : "secondary"}>{l.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {(l.status === "pending" || staff) ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50" title="Hapus laporan">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Hapus laporan ini?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Laporan {l.qty} × {l.rate?.name} ({fmtIDR(Number(l.amount))}) akan dihapus permanen.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Batal</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteMut.mutate(l.id)} className="bg-rose-600 hover:bg-rose-700">Hapus</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!logs?.length && <TableRow><TableCell colSpan={7} className="text-center text-slate-500 py-6">Belum ada laporan</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
