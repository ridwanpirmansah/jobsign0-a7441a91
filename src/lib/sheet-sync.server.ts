/**
 * Core Google Sheets → projects sync logic.
 * Server-only. Uses Lovable connector gateway for Google Sheets API.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_sheets/v4";

export type SyncMapping = {
  code?: string;          // header name
  title?: string;
  total_points?: string;
  customer_name?: string;
  status?: string;
  deadline?: string;
  description?: string;
  contract_value?: string;
};

export type SyncResult = {
  ok: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  message: string;
};

function gatewayHeaders() {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const SHEETS_KEY = process.env.GOOGLE_SHEETS_API_KEY;
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY belum dikonfigurasi");
  if (!SHEETS_KEY) throw new Error("Google Sheets belum terhubung");
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": SHEETS_KEY,
  };
}

function buildRange(sheetName: string) {
  // Wrap in single quotes if sheet contains a space/special char
  const needsQuote = /[\s'!]/.test(sheetName);
  const safe = sheetName.replace(/'/g, "''");
  return needsQuote ? `'${safe}'` : safe;
}

export async function fetchSheetValues(
  spreadsheetId: string,
  sheetName: string,
): Promise<string[][]> {
  const range = buildRange(sheetName);
  const url = `${GATEWAY_URL}/spreadsheets/${spreadsheetId}/values/${range}`;
  const res = await fetch(url, { headers: gatewayHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets API error [${res.status}]: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}

function parseDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Try YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try DD/MM/YYYY or D/M/YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseNumber(v: unknown): number {
  if (v == null) return 0;
  const s = String(v).replace(/[^\d.\-]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

const VALID_STATUSES = ["draft", "active", "completed", "cancelled"];
function parseStatus(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return VALID_STATUSES.includes(s) ? s : null;
}

export async function runProjectSync(): Promise<SyncResult> {
  const result: SyncResult = {
    ok: false,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    message: "",
  };

  const { data: settings, error: setErr } = await supabaseAdmin
    .from("sync_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (setErr) throw setErr;
  if (!settings?.spreadsheet_id || !settings.sheet_name) {
    result.message = "Spreadsheet ID atau nama tab belum diatur";
    return result;
  }
  if (!settings.enabled) {
    result.message = "Sync sedang dinonaktifkan";
    return result;
  }

  const mapping = (settings.mapping ?? {}) as SyncMapping;
  if (!mapping.code || !mapping.title) {
    result.message = "Mapping kolom 'code' dan 'title' wajib diisi";
    return result;
  }

  let rows: string[][];
  try {
    rows = await fetchSheetValues(settings.spreadsheet_id, settings.sheet_name);
  } catch (e: any) {
    result.message = e.message ?? "Gagal ambil data sheet";
    result.errors.push(result.message);
    await persistSyncStatus(settings.id, "error", result);
    return result;
  }

  const headerRow = (settings.header_row ?? 1) - 1;
  if (rows.length <= headerRow) {
    result.message = "Sheet kosong / tidak ada data setelah baris header";
    await persistSyncStatus(settings.id, "ok", result);
    result.ok = true;
    return result;
  }
  const headers = rows[headerRow].map((h) => String(h).trim());
  const colIdx = (name?: string) =>
    name ? headers.findIndex((h) => h.toLowerCase() === name.toLowerCase()) : -1;

  const idxCode = colIdx(mapping.code);
  const idxTitle = colIdx(mapping.title);
  const idxPoints = colIdx(mapping.total_points);
  const idxCustomer = colIdx(mapping.customer_name);
  const idxStatus = colIdx(mapping.status);
  const idxDeadline = colIdx(mapping.deadline);
  const idxDesc = colIdx(mapping.description);
  const idxContract = colIdx(mapping.contract_value);

  if (idxCode < 0 || idxTitle < 0) {
    result.message = `Header '${mapping.code}' atau '${mapping.title}' tidak ditemukan di sheet`;
    result.errors.push(result.message);
    await persistSyncStatus(settings.id, "error", result);
    return result;
  }

  // Cache customers by name for this run
  const customerCache = new Map<string, string>();
  async function getOrCreateCustomer(name: string): Promise<string | null> {
    const key = name.trim().toLowerCase();
    if (!key) return null;
    if (customerCache.has(key)) return customerCache.get(key)!;
    const { data: found } = await supabaseAdmin
      .from("customers")
      .select("id")
      .ilike("name", name.trim())
      .maybeSingle();
    if (found?.id) {
      customerCache.set(key, found.id);
      return found.id;
    }
    const { data: created, error } = await supabaseAdmin
      .from("customers")
      .insert({ name: name.trim() })
      .select("id")
      .single();
    if (error) {
      result.errors.push(`Gagal buat customer '${name}': ${error.message}`);
      return null;
    }
    customerCache.set(key, created.id);
    return created.id;
  }

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    const code = String(row[idxCode] ?? "").trim();
    const title = String(row[idxTitle] ?? "").trim();
    if (!code || !title) {
      result.skipped++;
      continue;
    }

    const patch: Record<string, any> = { code, title };
    if (idxPoints >= 0) patch.total_points = Math.max(0, Math.floor(parseNumber(row[idxPoints])));
    if (idxDesc >= 0) patch.description = String(row[idxDesc] ?? "").trim() || null;
    if (idxStatus >= 0) {
      const st = parseStatus(row[idxStatus]);
      if (st) patch.status = st;
    }
    if (idxDeadline >= 0) {
      const d = parseDate(row[idxDeadline]);
      if (d) patch.deadline = d;
    }
    if (idxContract >= 0) patch.contract_value = parseNumber(row[idxContract]);
    if (idxCustomer >= 0) {
      const cname = String(row[idxCustomer] ?? "").trim();
      if (cname) {
        const cid = await getOrCreateCustomer(cname);
        if (cid) patch.customer_id = cid;
      }
    }

    const { data: existing } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("code", code)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await supabaseAdmin.from("projects").update(patch as any).eq("id", existing.id);
      if (error) {
        result.errors.push(`Baris ${i + 1} (update ${code}): ${error.message}`);
        result.skipped++;
      } else {
        result.updated++;
      }
    } else {
      const { error } = await supabaseAdmin.from("projects").insert(patch as any);
      if (error) {
        result.errors.push(`Baris ${i + 1} (insert ${code}): ${error.message}`);
        result.skipped++;
      } else {
        result.inserted++;
      }
    }
  }

  result.ok = true;
  result.message = `Berhasil. ${result.inserted} baru, ${result.updated} diperbarui, ${result.skipped} dilewati.`;
  await persistSyncStatus(settings.id, "ok", result);
  return result;
}

async function persistSyncStatus(
  id: number,
  status: "ok" | "error",
  r: SyncResult,
) {
  await supabaseAdmin
    .from("sync_settings")
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: status,
      last_sync_message: r.message + (r.errors.length ? ` | ${r.errors.slice(0, 3).join(" ;; ")}` : ""),
      last_sync_inserted: r.inserted,
      last_sync_updated: r.updated,
      last_sync_skipped: r.skipped,
    })
    .eq("id", id);
}

export async function previewSheet(
  spreadsheetId: string,
  sheetName: string,
  maxRows = 10,
): Promise<{ headers: string[]; rows: string[][] }> {
  const all = await fetchSheetValues(spreadsheetId, sheetName);
  if (all.length === 0) return { headers: [], rows: [] };
  const headers = all[0].map((h) => String(h).trim());
  const rows = all.slice(1, 1 + maxRows);
  return { headers, rows };
}
