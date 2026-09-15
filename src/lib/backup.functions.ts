import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppAuth } from "@/lib/app-auth";

export type BackupTable = {
  key: string; // "<schema>.<table>"
  schema: "public" | "auth";
  name: string;
  file: string; // csv file name inside the zip (without extension)
  label: string;
};

function t(schema: "public" | "auth", name: string, label: string): BackupTable {
  return { key: `${schema}.${name}`, schema, name, file: schema === "auth" ? `auth_${name}` : name, label };
}

// Full snapshot, ordered parent -> child (FKs are dropped during restore anyway).
export const BACKUP_TABLES: BackupTable[] = [
  t("auth", "users", "Akun Login"),
  t("auth", "identities", "Identitas Login"),
  t("public", "profiles", "Profil Pengguna"),
  t("public", "user_roles", "Peran Pengguna"),
  t("public", "user_feature_permissions", "Izin Fitur"),
  t("public", "customers", "Customer"),
  t("public", "shipping_carriers", "Ekspedisi"),
  t("public", "material_prices", "Master Harga"),
  t("public", "job_rates", "Tarif Borongan"),
  t("public", "employees", "Karyawan"),
  t("public", "orders", "Order"),
  t("public", "projects", "Project"),
  t("public", "order_items", "Item Order"),
  t("public", "project_assignments", "Penugasan Project"),
  t("public", "job_logs", "Log Garapan"),
  t("public", "expenses", "Pengeluaran"),
  t("public", "cashbon", "Cashbon"),
  t("public", "payrolls", "Payroll"),
  t("public", "employee_consumption", "Konsumsi Karyawan"),
  t("public", "attendances", "Absensi"),
  t("public", "attendance_settings", "Setelan Absensi"),
  t("public", "shipment_events", "Riwayat Kirim"),
  t("public", "shopping_notes", "Catatan Belanja"),
  t("public", "shopee_shops", "Toko Shopee"),
  t("public", "shopee_settings", "Setelan Shopee"),
  t("public", "shopee_order_map", "Mapping Order Shopee"),
  t("public", "sync_settings", "Setelan Sync"),
];

const TABLE_KEYS = BACKUP_TABLES.map((x) => x.key) as [string, ...string[]];

function findTable(key: string) {
  const cfg = BACKUP_TABLES.find((x) => x.key === key);
  if (!cfg) throw new Error("Tabel backup tidak didukung");
  return cfg;
}

async function requireOwner(ctx: any) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "owner" });
  if (!data) throw new Error("Forbidden: hanya owner");
}

async function admin() {
  const { getAdminClient } = await import("@/lib/admin-client.server");
  return getAdminClient() as any;
}

async function exportRows(db: any, cfg: BackupTable) {
  const rows: any[] = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await db.rpc("backup_export", {
      _schema: cfg.schema,
      _table: cfg.name,
      _offset: offset,
      _limit: pageSize,
    });
    if (error) throw new Error(`${cfg.key}: ${error.message}`);
    const chunk = (data as any[]) ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

export const listBackupTables = createServerFn({ method: "GET" })
  .middleware([requireAppAuth])
  .handler(async ({ context }) => {
    await requireOwner(context);
    const db = await admin();
    const result: { key: string; label: string; count: number }[] = [];
    for (const cfg of BACKUP_TABLES) {
      if (cfg.schema === "public") {
        const { count } = await db.from(cfg.name).select("*", { count: "exact", head: true });
        result.push({ key: cfg.key, label: cfg.label, count: count ?? 0 });
      } else {
        const rows = await exportRows(db, cfg);
        result.push({ key: cfg.key, label: cfg.label, count: rows.length });
      }
    }
    return result;
  });

export const backupTable = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .inputValidator((d: { table: string }) => z.object({ table: z.enum(TABLE_KEYS) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireOwner(context);
    const cfg = findTable(data.table);
    const db = await admin();
    const rows = await exportRows(db, cfg);
    return { table: cfg.key, rows };
  });

/** Masuk mode restore: relasi antar tabel & aturan otomatis dinonaktifkan sementara. */
export const restoreBegin = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .handler(async ({ context }) => {
    await requireOwner(context);
    const db = await admin();
    const { data, error } = await db.rpc("restore_begin");
    if (error) throw new Error(error.message);
    return { dropped: (data as number) ?? 0 };
  });

/** Keluar dari mode restore: aturan otomatis & relasi dipasang kembali. */
export const restoreFinish = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .handler(async ({ context }) => {
    await requireOwner(context);
    const db = await admin();
    const { data, error } = await db.rpc("restore_finish");
    if (error) throw new Error(error.message);
    return (data as { restored: number; failed: string[] }) ?? { restored: 0, failed: [] };
  });

export const clearTable = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .inputValidator((d: { table: string }) => z.object({ table: z.enum(TABLE_KEYS) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireOwner(context);
    const cfg = findTable(data.table);
    if (cfg.schema !== "public") throw new Error("Data akun tidak dapat dikosongkan");
    const db = await admin();
    const { error } = await db.rpc("restore_truncate", { _table: cfg.name });
    if (error) throw new Error(`${cfg.label}: ${error.message}`);
    return { table: cfg.key };
  });

export const restoreChunk = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .inputValidator((d: { table: string; rows: any[] }) =>
    z.object({ table: z.enum(TABLE_KEYS), rows: z.array(z.record(z.any())) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireOwner(context);
    const cfg = findTable(data.table);
    if (data.rows.length === 0) return { table: cfg.key, inserted: 0 };
    const db = await admin();
    const { data: n, error } = await db.rpc("restore_bulk", {
      _schema: cfg.schema,
      _table: cfg.name,
      _rows: data.rows,
    });
    if (error) throw new Error(`${cfg.label}: ${error.message}`);
    return { table: cfg.key, inserted: (n as number) ?? 0 };
  });
