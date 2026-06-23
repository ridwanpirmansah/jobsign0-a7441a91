import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/me/attendance")({ component: MyAttendance });

function MyAttendance() {
  const { data: me } = useCurrentUser();
  const empId = me?.employee?.id;
  const qc = useQueryClient();
  const [editId, setEditId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");

  const { data } = useQuery({
    enabled: !!empId,
    queryKey: ["my-att", empId],
    queryFn: async () => {
      const { data } = await supabase.from("attendances").select("*").eq("employee_id", empId!).order("date", { ascending: false }).limit(60);
      return data ?? [];
    },
  });

  const saveNote = useMutation({
    mutationFn: async (args: { id: string; note: string }) => {
      const { error } = await supabase.rpc("set_attendance_note", { _attendance_id: args.id, _note: args.note });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Catatan tersimpan");
      setEditId(null);
      qc.invalidateQueries({ queryKey: ["my-att"] });
    },
    onError: (e: Error) => toast.error(e.message),
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
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((r) => {
                const isEditing = editId === r.id;
                return (
                  <TableRow key={r.id}>
                    <TableCell>{format(new Date(r.date), "EEE, dd MMM yyyy", { locale: idLocale })}</TableCell>
                    <TableCell>{r.check_in ? format(new Date(r.check_in), "HH:mm") : "—"}</TableCell>
                    <TableCell>{r.check_out ? format(new Date(r.check_out), "HH:mm") : "—"}</TableCell>
                    <TableCell><Badge variant={r.status === "hadir" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                    <TableCell className="text-sm text-slate-600 min-w-[220px]">
                      {isEditing ? (
                        <Textarea rows={2} value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="Mis. terlambat karena hujan deras..." />
                      ) : (
                        <span className="whitespace-pre-wrap">{r.note ?? <span className="text-slate-400 italic">— belum ada catatan</span>}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isEditing ? (
                        <div className="flex gap-1 justify-end">
                          <Button size="icon" variant="ghost" disabled={saveNote.isPending} onClick={() => saveNote.mutate({ id: r.id, note: editNote })}><Save className="h-4 w-4 text-emerald-600" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => setEditId(null)}><X className="h-4 w-4" /></Button>
                        </div>
                      ) : (
                        <Button size="icon" variant="ghost" onClick={() => { setEditId(r.id); setEditNote(r.note ?? ""); }}><Pencil className="h-4 w-4" /></Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!data?.length && <TableRow><TableCell colSpan={6} className="text-center text-slate-500 py-6">Belum ada data</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
