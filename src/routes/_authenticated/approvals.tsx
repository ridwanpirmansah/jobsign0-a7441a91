import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/approvals")({ component: ApprovalsPage });

function fmtIDR(n: number) { return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0); }

function ApprovalsPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();

  const { data: logs } = useQuery({
    queryKey: ["pending-logs"],
    queryFn: async () => (await supabase.from("job_logs")
      .select("*, employee:employees(full_name,employee_code), project:projects(code,title), rate:job_rates(name,unit)")
      .eq("status", "pending").order("created_at", { ascending: false })).data ?? [],
  });

  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const { error } = await supabase.from("job_logs").update({
        status, approved_by: me!.user.id, approved_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Status diperbarui"); qc.invalidateQueries({ queryKey: ["pending-logs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isStaff(me?.role)) return <p className="text-sm text-slate-500">Akses ditolak.</p>;

  return (
    <div className="space-y-6 max-w-7xl">
      <div><h1 className="text-2xl font-bold text-slate-900">Approval Job Log</h1><p className="text-sm text-slate-500">Tinjau laporan garapan karyawan</p></div>
      <Card>
        <CardHeader><CardTitle className="text-base">Antrian ({logs?.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>Karyawan</TableHead><TableHead>Project</TableHead><TableHead>Tarif</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Upah</TableHead><TableHead>Catatan</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {logs?.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{format(new Date(l.log_date), "dd MMM")}</TableCell>
                  <TableCell className="font-medium">{l.employee?.full_name}</TableCell>
                  <TableCell>{l.project?.code ?? "—"}</TableCell>
                  <TableCell>{l.rate?.name}</TableCell>
                  <TableCell className="text-right">{l.qty}</TableCell>
                  <TableCell className="text-right font-medium">{fmtIDR(Number(l.amount))}</TableCell>
                  <TableCell className="text-xs text-slate-500 max-w-xs truncate">{l.note ?? ""}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: l.id, status: "approved" })}><Check className="h-4 w-4 text-emerald-600" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: l.id, status: "rejected" })}><X className="h-4 w-4 text-red-600" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {!logs?.length && <TableRow><TableCell colSpan={8} className="text-center py-8 text-slate-500"><Badge variant="secondary">Tidak ada antrian</Badge></TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
