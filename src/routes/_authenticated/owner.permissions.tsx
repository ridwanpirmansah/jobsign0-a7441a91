import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, type AppRole } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FEATURES, hasFeature, type FeatureKey } from "@/lib/features";
import { Shield, RotateCcw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/owner/permissions")({
  component: PermissionsPage,
  head: () => ({ meta: [{ title: "Setelan Akses Fitur" }] }),
});

type UserRow = {
  id: string;
  full_name: string | null;
  role: AppRole;
  overrides: Record<string, boolean>;
};

function PermissionsPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");

  const usersQ = useQuery({
    queryKey: ["perm-users"],
    queryFn: async (): Promise<UserRow[]> => {
      const [profiles, roles, perms] = await Promise.all([
        supabase.from("profiles").select("id,full_name"),
        supabase.from("user_roles").select("user_id,role"),
        (supabase as any).from("user_feature_permissions").select("user_id,feature_key,enabled"),
      ]);
      const roleMap = new Map<string, AppRole[]>();
      for (const r of roles.data ?? []) {
        const arr = roleMap.get(r.user_id) ?? [];
        arr.push(r.role as AppRole);
        roleMap.set(r.user_id, arr);
      }
      const permMap = new Map<string, Record<string, boolean>>();
      for (const p of (perms.data as any[]) ?? []) {
        const o = permMap.get(p.user_id) ?? {};
        o[p.feature_key] = p.enabled;
        permMap.set(p.user_id, o);
      }
      return (profiles.data ?? []).map((p) => {
        const rs = roleMap.get(p.id) ?? [];
        const role: AppRole = rs.includes("owner") ? "owner" : rs.includes("admin") ? "admin" : rs.includes("kurir") ? "kurir" : "karyawan";
        return { id: p.id, full_name: p.full_name, role, overrides: permMap.get(p.id) ?? {} };
      });
    },
    enabled: me?.role === "owner",
  });

  const setPerm = useMutation({
    mutationFn: async ({ user_id, feature_key, enabled }: { user_id: string; feature_key: FeatureKey; enabled: boolean }) => {
      const { error } = await (supabase as any)
        .from("user_feature_permissions")
        .upsert({ user_id, feature_key, enabled }, { onConflict: "user_id,feature_key" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["perm-users"] });
      qc.invalidateQueries({ queryKey: ["current-user"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetPerm = useMutation({
    mutationFn: async ({ user_id, feature_key }: { user_id: string; feature_key: FeatureKey }) => {
      const { error } = await (supabase as any)
        .from("user_feature_permissions")
        .delete()
        .eq("user_id", user_id)
        .eq("feature_key", feature_key);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["perm-users"] });
      qc.invalidateQueries({ queryKey: ["current-user"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const grouped = useMemo(() => {
    const g: Record<string, typeof FEATURES> = {};
    for (const f of FEATURES) {
      (g[f.group] ??= [] as any).push(f);
    }
    return g;
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return usersQ.data ?? [];
    return (usersQ.data ?? []).filter((u) => (u.full_name ?? "").toLowerCase().includes(q));
  }, [usersQ.data, filter]);

  if (me && me.role !== "owner") {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardHeader><CardTitle>Akses ditolak</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-slate-500">Halaman ini hanya untuk owner.</p></CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center gap-2">
        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center text-white shadow">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Setelan Akses Fitur</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Atur fitur mana yang bisa diakses oleh masing-masing user. Toggle aktif = user bisa melihat & mengakses halaman.
            Klik ikon reset untuk mengembalikan ke default role.
          </p>
        </div>
      </div>

      <Input placeholder="Cari nama user…" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-sm" />

      {usersQ.isLoading && <p className="text-sm text-slate-500">Memuat…</p>}

      <div className="space-y-4">
        {filtered.map((u) => (
          <Card key={u.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <span>{u.full_name || "—"}</span>
                <Badge variant={u.role === "owner" ? "default" : u.role === "admin" ? "secondary" : "outline"}>{u.role}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {u.role === "owner" ? (
                <p className="text-xs text-slate-500">Owner memiliki akses penuh ke semua fitur.</p>
              ) : (
                Object.entries(grouped).map(([groupName, feats]) => (
                  <div key={groupName}>
                    <div className="text-xs font-semibold uppercase text-slate-500 mb-2">{groupName}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {feats.map((f) => {
                        const effective = hasFeature(u.role, f.key, u.overrides);
                        const isOverride = Object.prototype.hasOwnProperty.call(u.overrides, f.key);
                        return (
                          <div key={f.key} className="flex items-center justify-between rounded-md border px-3 py-2">
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{f.label}</div>
                              <div className="text-[10px] text-slate-400">
                                {isOverride ? "Override manual" : "Mengikuti default role"}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isOverride && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  title="Reset ke default"
                                  onClick={() => resetPerm.mutate({ user_id: u.id, feature_key: f.key })}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <Switch
                                checked={effective}
                                onCheckedChange={(v) => setPerm.mutate({ user_id: u.id, feature_key: f.key, enabled: v })}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        ))}
        {!usersQ.isLoading && filtered.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-6">Tidak ada user.</p>
        )}
      </div>
    </div>
  );
}
