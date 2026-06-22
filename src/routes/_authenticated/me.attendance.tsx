import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/me/attendance")({ component: MyAttendance });

function MyAttendance() {
  const { data: me } = useCurrentUser();
  const empId = me?.employee?.id;
  const { data } = useQuery({
    enabled: !!empId,
    queryKey: ["my-att", empId],
    queryFn: async () => {
      const { data } = await supabase.from("attendances").select("*").eq("employee_id", empId!).order("date", { ascending: false }).limit(60);
      return data ?? [];
    },
  });

  const hadir = data?.filter((d) => d.status === "hadir").length ?? 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Absensi Saya</h1>
        <p className="text-sm text-slate-500">60 hari terakhir · {hadir} hari hadir</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Riwayat</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Check In</TableHead>
                <TableHead>Check Out</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Catatan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{format(new Date(r.date), "EEE, dd MMM yyyy")}</TableCell>
                  <TableCell>{r.check_in ? format(new Date(r.check_in), "HH:mm") : "—"}</TableCell>
                  <TableCell>{r.check_out ? format(new Date(r.check_out), "HH:mm") : "—"}</TableCell>
                  <TableCell><Badge variant={r.status === "hadir" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                  <TableCell className="text-sm text-slate-500">{r.note ?? ""}</TableCell>
                </TableRow>
              ))}
              {!data?.length && <TableRow><TableCell colSpan={5} className="text-center text-slate-500 py-6">Belum ada data</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
