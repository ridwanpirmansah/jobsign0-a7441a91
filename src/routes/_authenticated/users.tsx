import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/users")({ component: UsersPage });

type Role = "owner" | "admin" | "karyawan";

function UsersPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();

  const { data: rows } = useQuery({
    queryKey: ["all-users"],
    queryFn: async () => {
      const [profiles, roles] = await Promise.all([
        supabase.from("profiles").select("id,full_name,phone"),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      const map = new Map<string, Role[]>();
      (roles.data ?? []).forEach((r) => {
        const arr = map.get(r.user_id) ?? [];
        arr.push(r.role as Role); map.set(r.user_id, arr);
      });
      return (profiles.data ?? []).map((p) => {
        const rs = map.get(p.id) ?? [];
        const top: Role = rs.includes("owner") ? "owner" : rs.includes("admin") ? "admin" : "karyawan";
        return { ...p, role: top, roles: rs };
      });
    },
  });

  const setRole = useMutation({
    mutationFn: async ({ user_id, role }: { user_id: string; role: Role }) => {
      const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", user_id);
      if (delErr) throw delErr;
      const { error } = await supabase.from("user_roles").insert({ user_id, role });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Role diperbarui"); qc.invalidateQueries({ queryKey: ["all-users"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (me?.role !== "owner") return <p className="text-sm text-slate-500">Hanya owner yang bisa mengelola user.</p>;

  return (
    <div className="space-y-6 max-w-5xl">
      <div><h1 className="text-2xl font-bold text-slate-900">Kelola User & Role</h1><p className="text-sm text-slate-500">Tetapkan akses owner, admin, atau karyawan</p></div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Nama</TableHead><TableHead>User ID</TableHead><TableHead>Role saat ini</TableHead><TableHead>Ubah role</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows?.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                <TableCell className="font-mono text-xs text-slate-500">{u.id.slice(0, 8)}…</TableCell>
                <TableCell><Badge variant={u.role === "owner" ? "default" : u.role === "admin" ? "secondary" : "outline"}>{u.role}</Badge></TableCell>
                <TableCell>
                  <Select value={u.role} onValueChange={(v) => setRole.mutate({ user_id: u.id, role: v as Role })} disabled={u.id === me!.user.id}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">owner</SelectItem>
                      <SelectItem value="admin">admin</SelectItem>
                      <SelectItem value="karyawan">karyawan</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
            {!rows?.length && <TableRow><TableCell colSpan={4} className="text-center py-8 text-slate-500">Belum ada user</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
