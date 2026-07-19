import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Whitelist of tables that can be backed up/restored, with conflict target for upsert.
export const BACKUP_TABLES: { name: string; label: string; onConflict: string }[] = [
  { name: "profiles", label: "Profil User", onConflict: "id" },
  { name: "user_roles", label: "Role User", onConflict: "user_id,role" },
  { name: "user_feature_permissions", label: "Akses Fitur User", onConflict: "user_id,feature" },
  { name: "employees", label: "Karyawan", onConflict: "id" },
  { name: "customers", label: "Customer", onConflict: "id" },
  { name: "shipping_carriers", label: "Ekspedisi", onConflict: "id" },
  { name: "material_prices", label: "Master Harga", onConflict: "key" },
  { name: "job_rates", label: "Tarif Borongan", onConflict: "id" },
  { name: "orders", label: "Order", onConflict: "id" },
  { name: "order_items", label: "Item Order", onConflict: "id" },
  { name: "projects", label: "Project", onConflict: "id" },
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
    const rows: any[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data: chunk, error } = await supabaseAdmin
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
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireOwner(context);
    const cfg = BACKUP_TABLES.find((t) => t.name === data.table)!;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.mode === "replace") {
      const { error: delErr } = await supabaseAdmin.from(data.table).delete().not("id", "is", null);
      // Fallback: some tables use composite key without id. Ignore delete error and continue.
      if (delErr && !/column .* does not exist/i.test(delErr.message)) {
        // ignore
      }
    }

    if (data.rows.length === 0) return { table: data.table, inserted: 0 };

    // Clean rows: normalize empty strings on nullable fields is up to caller; here we just pass through.
    const chunkSize = 500;
    let inserted = 0;
    for (let i = 0; i < data.rows.length; i += chunkSize) {
      const chunk = data.rows.slice(i, i + chunkSize);
      const { error } = await supabaseAdmin
        .from(data.table)
        .upsert(chunk, { onConflict: cfg.onConflict, ignoreDuplicates: false });
      if (error) throw new Error(`${data.table}: ${error.message}`);
      inserted += chunk.length;
    }
    return { table: data.table, inserted };
  });
