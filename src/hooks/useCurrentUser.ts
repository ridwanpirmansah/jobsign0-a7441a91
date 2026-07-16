import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "owner" | "admin" | "karyawan" | "kurir";

export function useCurrentUser() {
  return useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const [{ data: profile }, { data: roles }, { data: emp }, { data: perms }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase.from("employees").select("*").eq("profile_id", user.id).maybeSingle(),
        (supabase as any).from("user_feature_permissions").select("feature_key,enabled").eq("user_id", user.id),
      ]);
      const roleList = (roles ?? []).map((r) => r.role as AppRole);
      const role: AppRole = roleList.includes("owner")
        ? "owner"
        : roleList.includes("admin")
        ? "admin"
        : roleList.includes("kurir")
        ? "kurir"
        : "karyawan";
      const overrides: Record<string, boolean> = {};
      for (const p of (perms as any[]) ?? []) overrides[p.feature_key] = p.enabled;
      return { user, profile, role, roles: roleList, employee: emp, overrides };
    },
    staleTime: 30_000,
  });
}

export function isStaff(role: AppRole | undefined) {
  return role === "admin" || role === "owner";
}

export function isKurir(role: AppRole | undefined) {
  return role === "kurir";
}
