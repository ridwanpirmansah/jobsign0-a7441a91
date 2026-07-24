import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { featureForPath, hasFeature, FEATURES } from "@/lib/features";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthLayout,
});

function AuthLayout() {
  const { data: me } = useCurrentUser();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  useEffect(() => {
    if (!me) return;
    if (me.role === "owner") return; // owner has full access
    // Owner-only areas
    if (path.startsWith("/owner") || path === "/users" || path === "/payroll" || path === "/reports") {
      toast.error("Halaman ini khusus owner");
      navigate({ to: fallbackPathFor(me.role, me.overrides), replace: true });
      return;
    }
    const key = featureForPath(path);
    if (!key) return; // unknown/uncontrolled path, allow
    if (!hasFeature(me.role, key, me.overrides)) {
      toast.error("Anda tidak memiliki akses ke fitur ini");
      navigate({ to: fallbackPathFor(me.role, me.overrides), replace: true });
    }
  }, [me, path]);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-slate-50">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b bg-white px-4 sticky top-0 z-30">
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

function fallbackPathFor(role: any, overrides: Record<string, boolean>): string {
  // pick first accessible feature; fall back to /auth
  for (const f of FEATURES) {
    if (hasFeature(role, f.key, overrides)) return f.path;
  }
  return "/auth";
}
