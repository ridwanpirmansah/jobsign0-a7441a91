import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  LayoutDashboard, ClipboardList, CalendarCheck, Wallet,
  FolderKanban, Users, DollarSign, BadgeCheck, UserCog,
  BarChart3, Building2, LogOut, Zap, QrCode, ScanLine, FileSpreadsheet,
  ShoppingBag, Tags, Sparkles, BadgeDollarSign, Wrench, Receipt, Utensils, Truck, Activity, Shield, DatabaseBackup,
  Settings, ChevronDown,
} from "lucide-react";

import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useQueryClient } from "@tanstack/react-query";
import { hasFeature, type FeatureKey } from "@/lib/features";

type NavItem = { title: string; url: string; icon: any; feature?: FeatureKey };

const meItems: NavItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, feature: "dashboard" },
  { title: "Status Orderan", url: "/status", icon: Activity, feature: "status" },
  { title: "Scan Absensi", url: "/me/scan", icon: ScanLine, feature: "me/scan" },
  { title: "Input Garapan", url: "/me/jobs", icon: ClipboardList, feature: "me/jobs" },
  { title: "Klaim Reparasi", url: "/me/repairs", icon: Wrench, feature: "me/repairs" },
  { title: "Absensi Saya", url: "/me/attendance", icon: CalendarCheck, feature: "me/attendance" },
  { title: "Pendapatan Saya", url: "/me/earnings", icon: Wallet, feature: "me/earnings" },
  { title: "Cashbon", url: "/cashbon", icon: BadgeDollarSign, feature: "cashbon" },
  { title: "Scan Siap Kirim", url: "/me/ship", icon: ScanLine, feature: "me/ship" },
];
const adminItems: NavItem[] = [
  { title: "Order", url: "/orders", icon: ShoppingBag, feature: "orders" },
  { title: "Project", url: "/projects", icon: FolderKanban, feature: "projects" },
  { title: "Karyawan", url: "/employees", icon: Users, feature: "employees" },
  { title: "Tarif Borongan", url: "/rates", icon: DollarSign, feature: "rates" },
  { title: "Approval", url: "/approvals", icon: BadgeCheck, feature: "approvals" },
  { title: "Konsumsi Karyawan", url: "/consumption", icon: Utensils, feature: "consumption" },
  { title: "Customer", url: "/customers", icon: Building2, feature: "customers" },
  { title: "Pickup Paket", url: "/me/pickup", icon: Truck, feature: "me/pickup" },
];

const ownerItems: NavItem[] = [
  { title: "QR Absensi", url: "/owner/attendance-qr", icon: QrCode },
  { title: "Riwayat Absensi", url: "/owner/attendance-history", icon: CalendarCheck },
  { title: "Payroll", url: "/payroll", icon: Wallet },
  { title: "Analitik & Performa", url: "/owner/analytics", icon: Sparkles },
  { title: "Catatan Pengeluaran", url: "/owner/expenses", icon: Receipt },
  { title: "Laporan", url: "/reports", icon: BarChart3 },
];

const settingsItems: NavItem[] = [
  { title: "Master Harga", url: "/owner/prices", icon: Tags },
  { title: "Master Ekspedisi", url: "/owner/carriers", icon: Truck },
  { title: "Sync Project", url: "/owner/sync", icon: FileSpreadsheet },
  { title: "Kelola User", url: "/users", icon: UserCog },
  { title: "Setelan Akses Fitur", url: "/owner/permissions", icon: Shield },
  { title: "Backup & Restore", url: "/owner/backup", icon: DatabaseBackup },
];


export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data } = useCurrentUser();
  const role = data?.role;
  const overrides = data?.overrides ?? {};
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

  const filterItems = (items: NavItem[]) =>
    items.filter((i) => !i.feature || hasFeature(role, i.feature, overrides));

  const visibleMe = filterItems(meItems);
  const visibleAdmin = filterItems(adminItems);

  const settingsActive = settingsItems.some((i) => isActive(i.url));
  const [settingsOpen, setSettingsOpen] = useState(settingsActive);

  const renderItems = (items: NavItem[]) =>
    items.map((item) => (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton asChild isActive={isActive(item.url)}
          className="data-[active=true]:bg-slate-800 data-[active=true]:text-white text-slate-300 hover:bg-slate-800 hover:text-white">
          <Link to={item.url} onClick={handleNav}>
            <item.icon className="h-4 w-4" />
            <span>{item.title}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

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
                {renderItems(ownerItems)}

                <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        isActive={settingsActive}
                        className="data-[active=true]:bg-slate-800 data-[active=true]:text-white text-slate-300 hover:bg-slate-800 hover:text-white"
                      >
                        <Settings className="h-4 w-4" />
                        <span>Pengaturan</span>
                        <ChevronDown
                          className={`ml-auto h-4 w-4 transition-transform ${settingsOpen ? "rotate-180" : ""}`}
                        />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                  </SidebarMenuItem>
                  <CollapsibleContent>
                    <div className="ml-3 border-l border-slate-800 pl-2">
                      <SidebarMenu>
                        {renderItems(settingsItems)}
                      </SidebarMenu>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {visibleAdmin.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-slate-500">Operasional</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(visibleAdmin)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {visibleMe.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-slate-500">Karyawan</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(visibleMe)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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
