import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Neon Workflow | Fuji Electric" },
    { name: "description", content: "Pengelolaan pesanan dan produksi neon sign Fuji Electric." },
    { property: "og:title", content: "Neon Workflow | Fuji Electric" },
    { property: "og:description", content: "Pengelolaan pesanan dan produksi neon sign Fuji Electric." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      const roleList = (roles ?? []).map((r) => r.role);
      const isStaffRole = roleList.includes("owner") || roleList.includes("admin");
      // Kurir (non-staff) langsung diarahkan ke halaman Pickup Paket agar bisa scan cepat
      if (roleList.includes("kurir") && !isStaffRole) {
        throw redirect({ to: "/me/pickup" });
      }
    }
    throw redirect({ to: "/dashboard" });
  },
});
