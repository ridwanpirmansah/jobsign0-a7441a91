import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Save, X, LogIn, LogOut, StickyNote, Coffee } from "lucide-react";
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
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Absensi Saya</h1>
        <p className="text-sm text-slate-500">60 hari terakhir · {hadir} hari hadir</p>
      </div>
      <Card className="border-0 shadow-none bg-transparent sm:border sm:shadow-sm sm:bg-card">
        <CardHeader className="px-0 sm:px-6"><CardTitle className="text-base">Riwayat</CardTitle></CardHeader>
        <CardContent className="space-y-3 px-0 sm:px-6">
          {data?.map((r) => {
            const isEditing = editId === r.id;
            const d = new Date(r.date);
            const day = format(d, "dd", { locale: idLocale });
            const mon = format(d, "MMM", { locale: idLocale });
            const wk = format(d, "EEEE", { locale: idLocale });
            const yr = format(d, "yyyy");
            const statusColor =
              r.status === "hadir"
                ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                : "bg-slate-100 text-slate-600 border-slate-200";
            return (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-2.5 sm:p-4 shadow-sm">
                <div className="flex items-stretch gap-3">
                  {/* Date block */}
                  <div className="flex flex-col items-center justify-center shrink-0 w-14 sm:w-16 rounded-lg bg-gradient-to-b from-indigo-50 to-white border border-indigo-100 py-2">
                    <span className="text-[10px] uppercase font-semibold text-indigo-500 tracking-wide">{mon}</span>
                    <span className="text-2xl font-black leading-none text-slate-900">{day}</span>
                    <span className="text-[10px] text-slate-400 mt-0.5">{yr}</span>
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-700 truncate capitalize">{wk}</p>
                      <Badge variant="outline" className={`text-[10px] uppercase tracking-wide ${statusColor}`}>{r.status}</Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1.5 min-w-0">
                        <LogIn className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[10px] text-emerald-700/70 leading-none">Check In</p>
                          <p className="text-sm font-bold text-emerald-700 leading-tight">{r.check_in ? format(new Date(r.check_in), "HH:mm") : "—"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-1.5 min-w-0">
                        <LogOut className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[10px] text-rose-700/70 leading-none">Check Out</p>
                          <p className="text-sm font-bold text-rose-700 leading-tight">{r.check_out ? format(new Date(r.check_out), "HH:mm") : "—"}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Note section */}
                <div className="mt-3 pt-3 border-t border-dashed border-slate-200">
                  {isEditing ? (
                    <div className="space-y-2">
                      <Textarea
                        rows={2}
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        placeholder="Mis. terlambat karena hujan deras..."
                        className="text-sm"
                      />
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>
                          <X className="h-4 w-4 mr-1" /> Batal
                        </Button>
                        <Button size="sm" disabled={saveNote.isPending} onClick={() => saveNote.mutate({ id: r.id, note: editNote })}>
                          <Save className="h-4 w-4 mr-1" /> Simpan
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <StickyNote className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
                      <p className="flex-1 text-xs text-slate-600 whitespace-pre-wrap min-w-0">
                        {r.note || <span className="text-slate-400 italic">Belum ada catatan</span>}
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 shrink-0"
                        onClick={() => { setEditId(r.id); setEditNote(r.note ?? ""); }}
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        {r.note ? "Edit" : "Tambah"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!data?.length && (
            <div className="text-center text-slate-500 py-10 text-sm">Belum ada data</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
