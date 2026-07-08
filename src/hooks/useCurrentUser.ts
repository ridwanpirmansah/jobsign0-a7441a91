import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "owner" | "admin" | "karyawan" | "kurir";

export function useCurrentUser() {
  return useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const [{ data: profile }, { data: roles }, { data: emp }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase.from("employees").select("*").eq("profile_id", user.id).maybeSingle(),
      ]);
      const roleList = (roles ?? []).map((r) => r.role as AppRole);
      const role: AppRole = roleList.includes("owner")
        ? "owner"
        : roleList.includes("admin")
        ? "admin"
        : roleList.includes("kurir")
        ? "kurir"
        : "karyawan";
      return { user, profile, role, roles: roleList, employee: emp };
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
