import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    // Restrict role kurir: hanya boleh akses halaman pickup
    const { data: roles } = await supabase
      .from("user_roles").select("role").eq("user_id", data.user.id);
    const roleList = (roles ?? []).map((r: any) => r.role);
    const isOnlyKurir = roleList.length > 0 && roleList.every((r: string) => r === "kurir");
    if (isOnlyKurir && !location.pathname.startsWith("/me/pickup")) {
      throw redirect({ to: "/me/pickup" });
    }
    return { user: data.user };
  },
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-slate-50">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b bg-white px-4 sticky top-0 z-10">
            <SidebarTrigger />
            <div className="text-sm font-medium text-slate-700">Neon Workflow System</div>
          </header>
          <main className="flex-1 p-3 sm:p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
      <Toaster richColors position="top-right" />
    </SidebarProvider>
  );
}
