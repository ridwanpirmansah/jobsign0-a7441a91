import {
  LayoutDashboard, ClipboardList, CalendarCheck, Wallet,
  FolderKanban, Users, DollarSign, BadgeCheck, UserCog,
  BarChart3, Building2, QrCode, ScanLine,
  ShoppingBag, Sparkles, BadgeDollarSign, Wrench, Receipt, Utensils, Truck, Activity,
  ShoppingCart,
} from "lucide-react";
import type { FeatureKey } from "@/lib/features";

export type NavGroup = "owner" | "operasional" | "karyawan";

export type NavItem = {
  title: string;
  url: string;
  icon: any;
  feature?: FeatureKey;
  /** owner-only items are hidden for non-owner roles regardless of ordering */
  ownerOnly?: boolean;
  group: NavGroup;
};

export const GROUP_LABELS: Record<NavGroup, string> = {
  owner: "Owner",
  operasional: "Operasional",
  karyawan: "Karyawan",
};

export const GROUP_ORDER: NavGroup[] = ["owner", "operasional", "karyawan"];

/** Default order & grouping of all sidebar menus (excluding the "Pengaturan" dropdown). */
export const NAV_ITEMS: NavItem[] = [
  // Owner
  { title: "QR Absensi", url: "/owner/attendance-qr", icon: QrCode, ownerOnly: true, group: "owner" },
  { title: "Riwayat Absensi", url: "/owner/attendance-history", icon: CalendarCheck, ownerOnly: true, group: "owner" },
  { title: "Payroll", url: "/payroll", icon: Wallet, ownerOnly: true, group: "owner" },
  { title: "Analitik & Performa", url: "/owner/analytics", icon: Sparkles, ownerOnly: true, group: "owner" },
  { title: "Catatan Pengeluaran", url: "/owner/expenses", icon: Receipt, ownerOnly: true, group: "owner" },
  { title: "Laporan", url: "/reports", icon: BarChart3, ownerOnly: true, group: "owner" },
  // Operasional
  { title: "Order", url: "/orders", icon: ShoppingBag, feature: "orders", group: "operasional" },
  { title: "Project", url: "/projects", icon: FolderKanban, feature: "projects", group: "operasional" },
  { title: "Karyawan", url: "/employees", icon: Users, feature: "employees", group: "operasional" },
  { title: "Tarif Borongan", url: "/rates", icon: DollarSign, feature: "rates", group: "operasional" },
  { title: "Approval", url: "/approvals", icon: BadgeCheck, feature: "approvals", group: "operasional" },
  { title: "Konsumsi Karyawan", url: "/consumption", icon: Utensils, feature: "consumption", group: "operasional" },
  { title: "Customer", url: "/customers", icon: Building2, feature: "customers", group: "operasional" },
  { title: "Pickup Paket", url: "/me/pickup", icon: Truck, feature: "me/pickup", group: "operasional" },
  // Karyawan
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, feature: "dashboard", group: "karyawan" },
  { title: "Status Orderan", url: "/status", icon: Activity, feature: "status", group: "karyawan" },
  { title: "Scan Absensi", url: "/me/scan", icon: ScanLine, feature: "me/scan", group: "karyawan" },
  { title: "Input Garapan", url: "/me/jobs", icon: ClipboardList, feature: "me/jobs", group: "karyawan" },
  { title: "Klaim Reparasi", url: "/me/repairs", icon: Wrench, feature: "me/repairs", group: "karyawan" },
  { title: "Absensi Saya", url: "/me/attendance", icon: CalendarCheck, feature: "me/attendance", group: "karyawan" },
  { title: "Pendapatan Saya", url: "/me/earnings", icon: Wallet, feature: "me/earnings", group: "karyawan" },
  { title: "Cashbon", url: "/cashbon", icon: BadgeDollarSign, feature: "cashbon", group: "karyawan" },
  { title: "Catatan Belanja", url: "/shopping-notes", icon: ShoppingCart, feature: "shopping-notes", group: "karyawan" },
  { title: "Scan Siap Kirim", url: "/me/ship", icon: ScanLine, feature: "me/ship", group: "karyawan" },
];

export const SETTINGS_ICON = UserCog;

export type MenuLayout = { url: string; group: NavGroup }[];

export const MENU_LAYOUT_KEY = "nav-menu-layout-v1";

export function defaultLayout(): MenuLayout {
  return NAV_ITEMS.map((i) => ({ url: i.url, group: i.group }));
}

/** Merge a stored layout with the current item registry (adds new items, drops removed ones). */
export function normalizeLayout(stored: unknown): MenuLayout {
  const base = defaultLayout();
  if (!Array.isArray(stored)) return base;
  const known = new Map(base.map((i) => [i.url, i]));
  const out: MenuLayout = [];
  for (const raw of stored as any[]) {
    const url = raw?.url;
    if (typeof url !== "string" || !known.has(url)) continue;
    if (out.some((o) => o.url === url)) continue;
    const group: NavGroup = GROUP_ORDER.includes(raw?.group) ? raw.group : known.get(url)!.group;
    out.push({ url, group });
  }
  for (const item of base) if (!out.some((o) => o.url === item.url)) out.push(item);
  return out;
}

export function loadLayout(): MenuLayout {
  if (typeof window === "undefined") return defaultLayout();
  try {
    const raw = window.localStorage.getItem(MENU_LAYOUT_KEY);
    return normalizeLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(layout: MenuLayout) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MENU_LAYOUT_KEY, JSON.stringify(layout));
  window.dispatchEvent(new CustomEvent("menu-layout-changed"));
}
