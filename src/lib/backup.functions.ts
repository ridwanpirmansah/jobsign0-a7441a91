import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Whitelist of tables that can be backed up/restored, with conflict target for upsert.
export const BACKUP_TABLES: { name: string; label: string; onConflict: string }[] = [
  { name: "customers", label: "Customer", onConflict: "id" },
  { name: "shipping_carriers", label: "Ekspedisi", onConflict: "id" },
  { name: "material_prices", label: "Master Harga", onConflict: "key" },
  { name: "job_rates", label: "Tarif Borongan", onConflict: "id" },
  { name: "employees", label: "Karyawan", onConflict: "id" },
  { name: "orders", label: "Order", onConflict: "id" },
  { name: "projects", label: "Project", onConflict: "id" },
  { name: "order_items", label: "Item Order", onConflict: "id" },
  { name: "project_assignments", label: "Penugasan Project", onConflict: "project_id,employee_id" },
  { name: "job_logs", label: "Log Garapan", onConflict: "id" },
  { name: "expenses", label: "Pengeluaran", onConflict: "id" },
  { name: "cashbon", label: "Cashbon", onConflict: "id" },
  { name: "employee_consumption", label: "Konsumsi Karyawan", onConflict: "id" },
  { name: "payrolls", label: "Payroll", onConflict: "id" },
  { name: "attendances", label: "Absensi", onConflict: "id" },
  { name: "attendance_settings", label: "Setelan Absensi", onConflict: "id" },
  { name: "shipment_events", label: "Riwayat Kirim", onConflict: "id" },
  { name: "sync_settings", label: "Setelan Sync", onConflict: "id" },
];

const TABLE_NAMES = BACKUP_TABLES.map((t) => t.name);

const ACCOUNT_TABLES = new Set(["profiles", "user_roles", "user_feature_permissions"]);

const ACCOUNT_REFERENCE_COLUMNS: Record<string, string[]> = {
  employees: ["profile_id"],
  orders: ["created_by", "picked_up_by"],
  job_logs: ["approved_by"],
  expenses: ["created_by"],
  cashbon: ["decided_by"],
  employee_consumption: ["created_by"],
  payrolls: ["approved_by"],
  shipment_events: ["actor_id"],
  shopping_notes: ["created_by", "purchased_by"],
};

type RestorePhase = "initial" | "relink";

function normalizeRows(table: string, rows: Record<string, any>[], phase: RestorePhase) {
  return rows.map((source) => {
    if (phase === "relink" && table === "orders") {
      return { id: source.id, project_id: source.project_id ?? null };
    }

    const row = { ...source };
    for (const column of ACCOUNT_REFERENCE_COLUMNS[table] ?? []) row[column] = null;

    if (table === "orders" && phase === "initial") row.project_id = null;
    if (table === "projects" && !row.title) {
      row.title = row.name || row.description || row.code || "Project Lama";
    }
    return row;
  });
}

function unknownColumn(message: string) {
  return message.match(/Could not find the ['\"]([^'\"]+)['\"] column/i)?.[1]
    ?? message.match(/column ['\"]?([^'\" ]+)['\"]? (?:does not exist|of relation)/i)?.[1]
    ?? null;
}

async function upsertCompatibleRows(db: any, table: string, rows: Record<string, any>[], onConflict: string) {
  let compatible = rows;
  const ignored = new Set<string>();

  while (compatible.length > 0) {
    const { error } = await db.from(table).upsert(compatible, { onConflict, ignoreDuplicates: false });
    if (!error) return { inserted: compatible.length, ignored: [...ignored] };

    const column = unknownColumn(error.message);
    if (!column || ignored.has(column)) throw new Error(`${table}: ${error.message}`);
    ignored.add(column);
    compatible = compatible.map(({ [column]: _ignored, ...row }) => row);
  }
  return { inserted: 0, ignored: [...ignored] };
}

async function requireOwner(ctx: any) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "owner" });
  if (!data) throw new Error("Forbidden: hanya owner");
}

export const listBackupTables = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireOwner(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const result: { name: string; label: string; count: number }[] = [];
    for (const t of BACKUP_TABLES) {
      const { count } = await db.from(t.name).select("*", { count: "exact", head: true });
      result.push({ name: t.name, label: t.label, count: count ?? 0 });
    }

    return result;
  });

export const backupTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { table: string }) => z.object({ table: z.enum(TABLE_NAMES as [string, ...string[]]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireOwner(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const rows: any[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data: chunk, error } = await db
        .from(data.table)
        .select("*")
        .range(from, from + pageSize - 1);

      if (error) throw new Error(error.message);
      if (!chunk || chunk.length === 0) break;
      rows.push(...chunk);
      if (chunk.length < pageSize) break;
      from += pageSize;
    }
    return { table: data.table, rows };
  });

export const restoreTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { table: string; rows: any[]; mode?: "upsert" | "replace" }) =>
    z.object({
      table: z.enum(TABLE_NAMES as [string, ...string[]]),
      rows: z.array(z.record(z.any())),
      mode: z.enum(["upsert", "replace"]).optional(),
      phase: z.enum(["initial", "relink"]).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireOwner(context);
    const cfg = BACKUP_TABLES.find((t) => t.name === data.table);
    if (!cfg) throw new Error("Tabel backup tidak didukung");
    if (ACCOUNT_TABLES.has(data.table)) {
      throw new Error("Data akun login tidak dipindahkan. Daftarkan akun baru, lalu hubungkan melalui halaman Karyawan.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const phase = data.phase ?? "initial";
    const normalizedRows = normalizeRows(data.table, data.rows, phase);

    if (data.mode === "replace" && phase === "initial") {
      const { error: delErr } = await db.from(data.table).delete().not("id", "is", null);
      if (delErr && !/column .* does not exist/i.test(delErr.message)) {
        // ignore — composite key tables
      }
    }

    if (normalizedRows.length === 0) return { table: data.table, inserted: 0, ignoredColumns: [] as string[] };

    const chunkSize = 500;
    let inserted = 0;
    const ignoredColumns = new Set<string>();
    for (let i = 0; i < normalizedRows.length; i += chunkSize) {
      const chunk = normalizedRows.slice(i, i + chunkSize);
      const result = await upsertCompatibleRows(db, data.table, chunk, cfg.onConflict);
      inserted += result.inserted;
      result.ignored.forEach((column) => ignoredColumns.add(column));
    }

    return { table: data.table, inserted, ignoredColumns: [...ignoredColumns] };
  });
