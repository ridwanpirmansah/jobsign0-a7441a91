import type { AppRole } from "@/hooks/useCurrentUser";

export type FeatureKey =
  | "dashboard"
  | "status"
  | "me/scan"
  | "me/jobs"
  | "me/repairs"
  | "me/attendance"
  | "me/earnings"
  | "cashbon"
  | "shopping-notes"
  | "me/ship"
  | "me/pickup"
  | "orders"
  | "ready-stock"
  | "projects"
  | "employees"
  | "rates"
  | "approvals"
  | "consumption"
  | "customers";

export type FeatureDef = {
  key: FeatureKey;
  label: string;
  path: string;
  /** Default roles that have access when there is no explicit override. */
  defaultRoles: AppRole[];
  group: "Karyawan" | "Operasional" | "Pengiriman";
};

export const FEATURES: FeatureDef[] = [
  { key: "dashboard",     label: "Dashboard",           path: "/dashboard",     defaultRoles: ["admin","owner","karyawan"],         group: "Karyawan" },
  { key: "status",        label: "Status Orderan",      path: "/status",        defaultRoles: ["admin","owner","karyawan","kurir"], group: "Karyawan" },
  { key: "me/scan",       label: "Scan Absensi",        path: "/me/scan",       defaultRoles: ["admin","owner","karyawan"],         group: "Karyawan" },
  { key: "me/jobs",       label: "Input Garapan",       path: "/me/jobs",       defaultRoles: ["admin","owner","karyawan"],         group: "Karyawan" },
  { key: "me/repairs",    label: "Klaim Reparasi",      path: "/me/repairs",    defaultRoles: ["admin","owner","karyawan"],         group: "Karyawan" },
  { key: "me/attendance", label: "Absensi Saya",        path: "/me/attendance", defaultRoles: ["admin","owner","karyawan"],         group: "Karyawan" },
  { key: "me/earnings",   label: "Pendapatan Saya",     path: "/me/earnings",   defaultRoles: ["admin","owner","karyawan"],         group: "Karyawan" },
  { key: "cashbon",       label: "Cashbon",             path: "/cashbon",       defaultRoles: ["admin","owner","karyawan"],         group: "Karyawan" },
  { key: "shopping-notes",label: "Catatan Belanja",     path: "/shopping-notes",defaultRoles: ["admin","owner","karyawan","kurir"], group: "Karyawan" },
  { key: "me/ship",       label: "Scan Siap Kirim",     path: "/me/ship",       defaultRoles: ["admin","owner","karyawan","kurir"], group: "Pengiriman" },
  { key: "me/pickup",     label: "Pickup Paket",        path: "/me/pickup",     defaultRoles: ["admin","owner","kurir"],            group: "Pengiriman" },
  { key: "orders",        label: "Order",               path: "/orders",        defaultRoles: ["admin","owner"],                    group: "Operasional" },
  { key: "ready-stock",   label: "Ready Stock",         path: "/ready-stock",   defaultRoles: ["admin","owner"],                    group: "Operasional" },
  { key: "projects",      label: "Project",             path: "/projects",      defaultRoles: ["admin","owner"],                    group: "Operasional" },
  { key: "employees",     label: "Karyawan",            path: "/employees",     defaultRoles: ["admin","owner"],                    group: "Operasional" },
  { key: "rates",         label: "Tarif Borongan",      path: "/rates",         defaultRoles: ["admin","owner"],                    group: "Operasional" },
  { key: "approvals",     label: "Approval",            path: "/approvals",     defaultRoles: ["admin","owner"],                    group: "Operasional" },
  { key: "consumption",   label: "Konsumsi Karyawan",   path: "/consumption",   defaultRoles: ["admin","owner"],                    group: "Operasional" },
  { key: "customers",     label: "Customer",            path: "/customers",     defaultRoles: ["admin","owner"],                    group: "Operasional" },
];

export type PermOverrides = Record<string, boolean>;

export function hasFeature(
  role: AppRole | undefined,
  key: FeatureKey,
  overrides: PermOverrides = {},
): boolean {
  if (!role) return false;
  if (role === "owner") return true; // owner selalu punya akses semua
  if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
  const f = FEATURES.find((x) => x.key === key);
  return f ? f.defaultRoles.includes(role) : false;
}

/** Match a URL path to a feature key (longest-prefix). */
export function featureForPath(pathname: string): FeatureKey | null {
  // sort by path length desc so /me/scan matches before /me
  const sorted = [...FEATURES].sort((a, b) => b.path.length - a.path.length);
  for (const f of sorted) {
    if (pathname === f.path || pathname.startsWith(f.path + "/")) return f.key;
  }
  return null;
}
