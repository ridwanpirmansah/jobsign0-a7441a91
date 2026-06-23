import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarCheck, ClipboardList, Wallet, FolderKanban, ScanLine } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
}

function Dashboard() {
  const { data: me } = useCurrentUser();
  const today = format(new Date(), "yyyy-MM-dd");
  const monthStart = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd");
  const empId = me?.employee?.id;

  const { data: attToday } = useQuery({
    enabled: !!empId,
    queryKey: ["att-today", empId, today],
    queryFn: async () => {
      const { data } = await supabase.from("attendances").select("*").eq("employee_id", empId!).eq("date", today).maybeSingle();
      return data;
    },
  });

  const { data: monthLogs } = useQuery({
    enabled: !!empId,
    queryKey: ["month-logs", empId, monthStart],
    queryFn: async () => {
      const { data } = await supabase.from("job_logs").select("amount,status,log_date")
        .eq("employee_id", empId!).gte("log_date", monthStart);
      return data ?? [];
    },
  });

  const { data: myProjects } = useQuery({
    enabled: !!empId,
    queryKey: ["my-projects", empId],
    queryFn: async () => {
      const { data } = await supabase.from("project_assignments")
        .select("project:projects(id,code,title,status,deadline)").eq("employee_id", empId!);
      return (data ?? []).map((r: { project: unknown }) => r.project).filter(Boolean) as Array<{ id: string; code: string; title: string; status: string; deadline: string | null }>;
    },
  });

  const { data: staffStats } = useQuery({
    enabled: isStaff(me?.role),
    queryKey: ["staff-stats"],
    queryFn: async () => {
      const [p, pending, emps] = await Promise.all([
        supabase.from("projects").select("id,status"),
        supabase.from("job_logs").select("id").eq("status", "pending"),
        supabase.from("employees").select("id").eq("active", true),
      ]);
      return {
        activeProjects: (p.data ?? []).filter((x) => x.status === "active").length,
        totalProjects: (p.data ?? []).length,
        pendingApprovals: (pending.data ?? []).length,
        activeEmployees: (emps.data ?? []).length,
      };
    },
  });


  const approvedMonth = (monthLogs ?? []).filter((l) => l.status === "approved").reduce((s, l) => s + Number(l.amount), 0);
  const pendingMonth = (monthLogs ?? []).filter((l) => l.status === "pending").reduce((s, l) => s + Number(l.amount), 0);

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Halo, {me?.profile?.full_name || "—"}</h1>
        <p className="text-sm text-slate-500">{format(new Date(), "EEEE, dd MMMM yyyy", { locale: idLocale })}</p>
      </div>

      {/* Check-in card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><CalendarCheck className="h-4 w-4" /> Absensi Hari Ini</CardTitle>
        </CardHeader>
        <CardContent>
          {!empId ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
              Akun Anda belum terhubung ke data karyawan. Minta admin/owner menambahkan Anda di menu <strong>Karyawan</strong> dan menyambungkan ke akun ini.
            </p>
          ) : (
            <div className="flex items-center gap-4 flex-wrap">
              <div className="text-sm">
                <div className="text-slate-500">Check-in</div>
                <div className="font-semibold">{attToday?.check_in ? format(new Date(attToday.check_in), "HH:mm") : "—"}</div>
              </div>
              <div className="text-sm">
                <div className="text-slate-500">Check-out</div>
                <div className="font-semibold">{attToday?.check_out ? format(new Date(attToday.check_out), "HH:mm") : "—"}</div>
              </div>
              <div className="ml-auto">
                {attToday?.check_in && attToday?.check_out ? (
                  <Badge variant="secondary">Selesai hari ini</Badge>
                ) : (
                  <Button asChild size="lg">
                    <Link to="/me/scan">
                      <ScanLine className="h-4 w-4 mr-2" />
                      {attToday?.check_in ? "Scan untuk Check-Out" : "Scan untuk Check-In"}
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Personal stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Stat icon={<Wallet className="h-4 w-4" />} label="Pendapatan disetujui (bulan ini)" value={fmtIDR(approvedMonth)} tint="bg-emerald-50 text-emerald-700" />
        <Stat icon={<ClipboardList className="h-4 w-4" />} label="Menunggu approval" value={fmtIDR(pendingMonth)} tint="bg-amber-50 text-amber-700" />
        <Stat icon={<FolderKanban className="h-4 w-4" />} label="Project saya" value={String(myProjects?.length ?? 0)} tint="bg-sky-50 text-sky-700" />
      </div>

      {/* My projects */}
      <Card>
        <CardHeader><CardTitle className="text-base">Project Aktif Saya</CardTitle></CardHeader>
        <CardContent>
          {!myProjects?.length ? <p className="text-sm text-slate-500">Belum ada project yang ditugaskan.</p> : (
            <div className="grid gap-2 md:grid-cols-2">
              {myProjects.map((p) => (
                <div key={p.id} className="border rounded-lg p-3 flex items-center gap-3 bg-white">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{p.title}</div>
                    <div className="text-xs text-slate-500">{p.code} · deadline {p.deadline ?? "—"}</div>
                  </div>
                  <Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3"><Link to="/me/jobs" className="text-sm text-primary hover:underline">+ Input laporan garapan</Link></div>
        </CardContent>
      </Card>

      {/* Staff stats */}
      {isStaff(me?.role) && staffStats && (
        <div>
          <h2 className="text-sm font-semibold text-slate-500 mb-3 mt-6">Ringkasan Operasional</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="Project aktif" value={String(staffStats.activeProjects)} sub={`dari ${staffStats.totalProjects} total`} />
            <Stat label="Job log perlu approve" value={String(staffStats.pendingApprovals)} tint="bg-amber-50 text-amber-700" />
            <Stat label="Karyawan aktif" value={String(staffStats.activeEmployees)} />
            <Stat label="Role Anda" value={me!.role} />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value, sub, tint }: { icon?: React.ReactNode; label: string; value: string; sub?: string; tint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500">{label}</div>
          {icon && <div className={`p-1.5 rounded ${tint ?? "bg-slate-100 text-slate-600"}`}>{icon}</div>}
        </div>
        <div className="text-xl font-bold mt-1 text-slate-900">{value}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
