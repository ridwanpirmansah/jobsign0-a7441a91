import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdminOrOwner(context: any) {
  const { data: roles } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  const ok = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "owner");
  if (!ok) throw new Error("Forbidden: hanya admin/owner");
  return (roles ?? []).some((r: any) => r.role === "owner");
}

export const getSyncSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminOrOwner(context);
    const { data, error } = await context.supabase
      .from("sync_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

const settingsSchema = z.object({
  spreadsheet_id: z.string().min(1),
  sheet_name: z.string().min(1),
  header_row: z.number().int().min(1).max(50).default(1),
  enabled: z.boolean().default(true),
  mapping: z.object({
    code: z.string().optional(),
    title: z.string().optional(),
    total_points: z.string().optional(),
    customer_name: z.string().optional(),
    status: z.string().optional(),
    deadline: z.string().optional(),
    description: z.string().optional(),
    contract_value: z.string().optional(),
  }).default({}),
});

export const updateSyncSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => settingsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const isOwner = await requireAdminOrOwner(context);
    if (!isOwner) throw new Error("Forbidden: hanya owner");
    const { error } = await context.supabase
      .from("sync_settings")
      .update({
        spreadsheet_id: data.spreadsheet_id,
        sheet_name: data.sheet_name,
        header_row: data.header_row,
        enabled: data.enabled,
        mapping: data.mapping,
      })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const previewSheetFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ spreadsheet_id: z.string().min(1), sheet_name: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdminOrOwner(context);
    const { previewSheet } = await import("./sheet-sync.server");
    try {
      const r = await previewSheet(data.spreadsheet_id, data.sheet_name, 10);
      return { ok: true as const, headers: r.headers, rows: r.rows, error: null as string | null };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      let friendly = msg;
      if (msg.includes("must not be an Office file")) {
        friendly = "File masih berupa .xlsx (Office). Buka di Google Sheets → File → Save as Google Sheets, lalu pakai Spreadsheet ID baru.";
      } else if (msg.includes("403") || msg.toLowerCase().includes("permission")) {
        friendly = "Akun Google yang terhubung tidak punya akses. Bagikan spreadsheet minimal Viewer ke akun tersebut.";
      } else if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
        friendly = "Spreadsheet tidak ditemukan. Cek kembali Spreadsheet ID.";
      } else if (msg.includes("Unable to parse range")) {
        friendly = "Nama tab tidak ditemukan di spreadsheet.";
      }
      return { ok: false as const, headers: [] as string[], rows: [] as string[][], error: friendly };
    }
  });

export const syncProjectsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminOrOwner(context);
    const { runProjectSync } = await import("./sheet-sync.server");
    try {
      return await runProjectSync();
    } catch (e: any) {
      return {
        ok: false,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: [String(e?.message ?? e)],
        message: String(e?.message ?? e),
      };
    }
  });
