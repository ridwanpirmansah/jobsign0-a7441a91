import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, ClipboardList, CalendarCheck, Wallet,
  FolderKanban, Users, DollarSign, BadgeCheck, UserCog,
  BarChart3, Building2, LogOut, Zap, QrCode, ScanLine, FileSpreadsheet,
  ShoppingBag, Tags, Sparkles, BadgeDollarSign, Package, Wrench, Receipt, Utensils, Truck,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, isStaff } from "@/hooks/useCurrentUser";
import { useQueryClient } from "@tanstack/react-query";

const meItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Scan Absensi", url: "/me/scan", icon: ScanLine },
  { title: "Input Garapan", url: "/me/jobs", icon: ClipboardList },
  { title: "Klaim Reparasi", url: "/me/repairs", icon: Wrench },
  { title: "Absensi Saya", url: "/me/attendance", icon: CalendarCheck },
  { title: "Pendapatan Saya", url: "/me/earnings", icon: Wallet },
  { title: "Cashbon", url: "/cashbon", icon: BadgeDollarSign },
];
const adminItems = [
  { title: "Order", url: "/orders", icon: ShoppingBag },
  { title: "Ready Stock", url: "/ready-stock", icon: Package },
  { title: "Project", url: "/projects", icon: FolderKanban },
  { title: "Karyawan", url: "/employees", icon: Users },
  { title: "Tarif Borongan", url: "/rates", icon: DollarSign },
  { title: "Approval", url: "/approvals", icon: BadgeCheck },
  { title: "Konsumsi Karyawan", url: "/consumption", icon: Utensils },
  { title: "Customer", url: "/customers", icon: Building2 },
];
const ownerItems = [
  { title: "QR Absensi", url: "/owner/attendance-qr", icon: QrCode },
  { title: "Riwayat Absensi", url: "/owner/attendance-history", icon: CalendarCheck },
  { title: "Master Harga", url: "/owner/prices", icon: Tags },
  { title: "Sync Project", url: "/owner/sync", icon: FileSpreadsheet },
  { title: "Kelola User", url: "/users", icon: UserCog },
  { title: "Payroll", url: "/payroll", icon: Wallet },
  { title: "Analitik Owner", url: "/owner/analytics", icon: Sparkles },
  { title: "Catatan Pengeluaran", url: "/owner/expenses", icon: Receipt },
  { title: "Laporan", url: "/reports", icon: BarChart3 },
];


export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data } = useCurrentUser();
  const role = data?.role;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const handleNav = () => {
    if (isMobile) setOpenMobile(false);
  };

  const handleLogout = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const isActive = (url: string) => path === url || path.startsWith(url + "/");

  return (
    <Sidebar collapsible="icon" className="border-r border-slate-800 bg-slate-950 text-slate-200">
      <SidebarHeader className="border-b border-slate-800 bg-slate-950">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">Neon Workflow</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">{role ?? "—"}</div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="bg-slate-950">
        {role === "owner" && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-amber-400/80">Owner</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {ownerItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}
                      className="data-[active=true]:bg-slate-800 data-[active=true]:text-white text-slate-300 hover:bg-slate-800 hover:text-white">
                      <Link to={item.url} onClick={handleNav}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {isStaff(role) && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-slate-500">Operasional</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}
                      className="data-[active=true]:bg-slate-800 data-[active=true]:text-white text-slate-300 hover:bg-slate-800 hover:text-white">
                      <Link to={item.url} onClick={handleNav}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel className="text-slate-500">Karyawan</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {meItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}
                    className="data-[active=true]:bg-slate-800 data-[active=true]:text-white text-slate-300 hover:bg-slate-800 hover:text-white">
                    <Link to={item.url} onClick={handleNav}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-slate-800 bg-slate-950 p-2">
        {!collapsed && data?.profile && (
          <div className="px-2 pb-2 text-xs text-slate-400 truncate">{data.profile.full_name}</div>
        )}
        <Button variant="ghost" size="sm" onClick={handleLogout}
          className="w-full justify-start text-slate-300 hover:bg-slate-800 hover:text-white">
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Keluar</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
