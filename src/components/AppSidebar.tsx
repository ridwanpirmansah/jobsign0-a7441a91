import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  UserCog, LogOut, Zap, QrCode, FileSpreadsheet,
  ShoppingBag, Tags, Truck, Shield, DatabaseBackup,
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
import { hasFeature } from "@/lib/features";
import { NAV_ITEMS, GROUP_LABELS, GROUP_ORDER, type NavItem, type NavGroup } from "@/lib/nav-items";
import { useMenuLayout } from "@/hooks/useMenuLayout";

const settingsItems: NavItem[] = [
  { title: "Master Harga", url: "/owner/prices", icon: Tags, group: "owner" },
  { title: "Master Ekspedisi", url: "/owner/carriers", icon: Truck, group: "owner" },
  { title: "Susunan Menu", url: "/owner/menu-order", icon: QrCode, group: "owner" },
  { title: "Sync Project", url: "/owner/sync", icon: FileSpreadsheet, group: "owner" },
  { title: "Integrasi Shopee", url: "/owner/shopee", icon: ShoppingBag, group: "owner" },
  { title: "Kelola User", url: "/users", icon: UserCog, group: "owner" },
  { title: "Setelan Akses Fitur", url: "/owner/permissions", icon: Shield, group: "owner" },
  { title: "Backup & Restore", url: "/owner/backup", icon: DatabaseBackup, group: "owner" },
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
