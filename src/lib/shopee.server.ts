/**
 * Shopee Open Platform API v2 integration (server-only).
 * Kredensial (partner_id / partner_key) disimpan di tabel shopee_settings
 * dan hanya dibaca dari server.
 */
import { createHmac } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const SHOPEE_CALLBACK_PATH = "/api/public/shopee/callback";

function apiBase() {
  return process.env.SHOPEE_API_BASE || "https://partner.shopeemobile.com";
}

export type ShopeeSettings = {
  id: number;
  partner_id: string | null;
  partner_key: string | null;
  redirect_url: string | null;
  shop_id: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  connected_at: string | null;
  enabled: boolean;
  lookback_days: number;
};

function isValidRedirectUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

export function buildCallbackUrl(base: string): string {
  const normalized = base.replace(/\/+$/, "").trim();
  return `${normalized}${SHOPEE_CALLBACK_PATH}`;
}

export async function loadSettings(): Promise<ShopeeSettings> {
  const { data, error } = await supabaseAdmin
    .from("shopee_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Pengaturan Shopee belum tersedia");
  return data as unknown as ShopeeSettings;
}

function credentials(s: ShopeeSettings) {
  const partnerId = (s.partner_id ?? process.env.SHOPEE_PARTNER_ID ?? "").trim();
  const partnerKey = (s.partner_key ?? process.env.SHOPEE_PARTNER_KEY ?? "").trim();
  if (!partnerId || !partnerKey) {
    throw new Error(
      "Partner ID / Partner Key Shopee belum diisi. Buka Setelan Shopee dan simpan kredensial terlebih dahulu.",
    );
  }
  return { partnerId, partnerKey };
}

function sign(partnerKey: string, base: string) {
  return createHmac("sha256", partnerKey).update(base).digest("hex");
}

/** URL consent untuk otorisasi toko. */
export async function buildAuthUrl(origin?: string): Promise<string> {
  const s = await loadSettings();
  const { partnerId, partnerKey } = credentials(s);
  const path = "/api/v2/shop/auth_partner";
  const ts = Math.floor(Date.now() / 1000);
  const signature = sign(partnerKey, `${partnerId}${path}${ts}`);
  const base = isValidRedirectUrl(s.redirect_url ?? "") ? s.redirect_url! : (origin ?? "");
  if (!base) throw new Error("Redirect URL belum diatur. Isi Redirect URL di pengaturan Shopee.");
  const redirect = buildCallbackUrl(base);
  const qs = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(ts),
    sign: signature,
    redirect,
  });
  return `${apiBase()}${path}?${qs.toString()}`;
}

async function postPublic(path: string, body: Record<string, unknown>) {
  const s = await loadSettings();
  const { partnerId, partnerKey } = credentials(s);
  const ts = Math.floor(Date.now() / 1000);
  const signature = sign(partnerKey, `${partnerId}${path}${ts}`);
  const qs = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(ts),
    sign: signature,
  });
  const res = await fetch(`${apiBase()}${path}?${qs.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, partner_id: Number(partnerId) }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || (json?.error && json.error !== "")) {
    throw new Error(
      `Shopee API error [${res.status}] ${json?.error ?? ""}: ${json?.message ?? "tidak diketahui"}`,
    );
  }
  return json;
}

/** Tukar authorization code jadi access/refresh token. */
export async function exchangeCode(code: string, shopId: string) {
  const json = await postPublic("/api/v2/auth/token/get", {
    code,
    shop_id: Number(shopId),
  });
  await saveTokens(shopId, json.access_token, json.refresh_token, json.expire_in ?? 14400);
  return json;
}

async function saveTokens(
  shopId: string,
  accessToken: string,
  refreshToken: string,
  expireInSec: number,
) {
  const { error } = await supabaseAdmin
    .from("shopee_settings")
    .update({
      shop_id: shopId,
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: new Date(Date.now() + expireInSec * 1000).toISOString(),
      connected_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) throw new Error(error.message);
}

async function refreshIfNeeded(s: ShopeeSettings): Promise<ShopeeSettings> {
  if (!s.shop_id || !s.refresh_token) {
    throw new Error("Toko Shopee belum terhubung. Klik 'Hubungkan Toko Shopee' terlebih dahulu.");
  }
  const exp = s.token_expires_at ? new Date(s.token_expires_at).getTime() : 0;
  // refresh 10 menit sebelum kedaluwarsa
  if (s.access_token && exp - Date.now() > 10 * 60 * 1000) return s;

  const json = await postPublic("/api/v2/auth/access_token/get", {
    refresh_token: s.refresh_token,
    shop_id: Number(s.shop_id),
  });
  await saveTokens(s.shop_id, json.access_token, json.refresh_token, json.expire_in ?? 14400);
  return loadSettings();
}

/** Panggilan API level toko (butuh access token). */
async function shopGet(path: string, params: Record<string, string>) {
  let s = await loadSettings();
  s = await refreshIfNeeded(s);
  const { partnerId, partnerKey } = credentials(s);
  const ts = Math.floor(Date.now() / 1000);
  const signature = sign(
    partnerKey,
    `${partnerId}${path}${ts}${s.access_token}${s.shop_id}`,
  );
  const qs = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(ts),
    access_token: s.access_token!,
    shop_id: s.shop_id!,
    sign: signature,
    ...params,
  });
  const res = await fetch(`${apiBase()}${path}?${qs.toString()}`, { method: "GET" });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || (json?.error && json.error !== "")) {
    throw new Error(
      `Shopee API error [${res.status}] ${json?.error ?? ""}: ${json?.message ?? "tidak diketahui"}`,
    );
  }
  return json;
}

/** Panggilan API level toko dengan method POST (body JSON). */
async function shopPost(path: string, body: Record<string, unknown>, raw = false) {
  let s = await loadSettings();
  s = await refreshIfNeeded(s);
  const { partnerId, partnerKey } = credentials(s);
  const ts = Math.floor(Date.now() / 1000);
  const signature = sign(
    partnerKey,
    `${partnerId}${path}${ts}${s.access_token}${s.shop_id}`,
  );
  const qs = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(ts),
    access_token: s.access_token!,
    shop_id: s.shop_id!,
    sign: signature,
  });
  const res = await fetch(`${apiBase()}${path}?${qs.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (raw) {
    const ct = res.headers.get("content-type") ?? "";
    if (res.ok && !ct.includes("application/json")) {
      return { __binary: new Uint8Array(await res.arrayBuffer()) };
    }
    const j: any = await res.json().catch(() => ({}));
    throw new Error(
      `Shopee API error [${res.status}] ${j?.error ?? ""}: ${j?.message ?? "tidak diketahui"}`,
    );
  }
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || (json?.error && json.error !== "")) {
    throw new Error(
      `Shopee API error [${res.status}] ${json?.error ?? ""}: ${json?.message ?? "tidak diketahui"}`,
    );
  }
  return json;
}

/** Buang teks yang di-mask Shopee (contoh: "****", "*a*"). */
function unmask(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^[\s*]+$/.test(s)) return "";
  const stars = (s.match(/\*/g) ?? []).length;
  if (stars > 0 && stars >= s.replace(/\s/g, "").length / 2) return "";
  return s.replace(/\*+/g, "").replace(/\s{2,}/g, " ").trim();
}


export type ShopeeOrderPreview = {
  order_sn: string;
  status: string;
  buyer: string;
  kota: string;
  product: string;
  paket: string;
  total: number;
  co_date: string | null;
  no_resi: string;
  ekspedisi: string;
  deadline: string | null;
  buyer_note: string;
  already_imported: boolean;
  order_no: string | null;
};

/** Status pesanan yang ditarik: siap kirim + sudah diproses. */
const IMPORTABLE_STATUSES = ["READY_TO_SHIP", "PROCESSED"];

/** Ambil daftar order_sn dalam rentang hari terakhir (dipecah per 15 hari). */
async function fetchOrderSns(days: number): Promise<string[]> {
  const now = Math.floor(Date.now() / 1000);
  const windowSec = 15 * 24 * 3600;
  const start = now - Math.max(1, Math.min(days, 90)) * 24 * 3600;
  const sns: string[] = [];

  for (const status of IMPORTABLE_STATUSES) {
    for (let from = start; from < now; from += windowSec) {
      const to = Math.min(from + windowSec - 1, now);
      let cursor = "";
      for (let guard = 0; guard < 20; guard++) {
        const json = await shopGet("/api/v2/order/get_order_list", {
          time_range_field: "create_time",
          time_from: String(from),
          time_to: String(to),
          page_size: "100",
          cursor,
          order_status: status,
          response_optional_fields: "order_status",
        });
        const list = json?.response?.order_list ?? [];
        for (const o of list) if (o?.order_sn) sns.push(String(o.order_sn));
        if (!json?.response?.more) break;
        cursor = String(json?.response?.next_cursor ?? "");
        if (!cursor) break;
      }
    }
  }
  return Array.from(new Set(sns));
}

/** Ambil daftar order_sn semua status (dipakai untuk update tracking). */
async function fetchOrderSnsAllStatus(days: number): Promise<string[]> {
  const now = Math.floor(Date.now() / 1000);
  const windowSec = 15 * 24 * 3600;
  const start = now - Math.max(1, Math.min(days, 90)) * 24 * 3600;
  const sns: string[] = [];
  for (let from = start; from < now; from += windowSec) {
    const to = Math.min(from + windowSec - 1, now);
    let cursor = "";
    for (let guard = 0; guard < 20; guard++) {
      const json = await shopGet("/api/v2/order/get_order_list", {
        time_range_field: "create_time",
        time_from: String(from),
        time_to: String(to),
        page_size: "100",
        cursor,
        response_optional_fields: "order_status",
      });
      const list = json?.response?.order_list ?? [];
      for (const o of list) if (o?.order_sn) sns.push(String(o.order_sn));
      if (!json?.response?.more) break;
      cursor = String(json?.response?.next_cursor ?? "");
      if (!cursor) break;
    }
  }
  return Array.from(new Set(sns));
}

function ymd(sec: unknown): string | null {
  const n = Number(sec ?? 0);
  if (!n) return null;
  return new Date(n * 1000).toISOString().slice(0, 10);
}

function mapDetail(d: any): Omit<ShopeeOrderPreview, "already_imported" | "order_no"> {
  const items: any[] = d?.item_list ?? [];
  const product = items.map((i) => i?.item_name).filter(Boolean).join(" | ") || "(tanpa nama produk)";
  const paket = items.map((i) => i?.model_name).filter(Boolean).join(" | ") || "";
  const addr = d?.recipient_address ?? {};
  // Shopee menyensor sebagian data penerima ("****"). Bersihkan dulu, lalu
  // susun dari bagian alamat yang tidak disensor.
  const parts = [addr?.district, addr?.city, addr?.state, addr?.zipcode]
    .map((v: any) => unmask(v))
    .filter(Boolean);
  const full = unmask(addr?.full_address);
  const kota = full || parts.join(", ");

  // Penghasilan Akhir (escrow) bila tersedia, jika tidak fallback ke total pembayaran pembeli
  const escrow = Number(d?.__escrow_amount ?? 0);
  const total = escrow > 0 ? escrow : Number(d?.total_amount ?? 0);
  const pkg = d?.package_list?.[0] ?? {};
  return {
    order_sn: String(d?.order_sn ?? ""),
    status: String(d?.order_status ?? ""),
    buyer: unmask(d?.buyer_username) || unmask(addr?.name),
    kota,
    product,
    paket,
    total,
    co_date: ymd(d?.create_time),
    no_resi: String(d?.__tracking_number ?? pkg?.tracking_number ?? d?.tracking_number ?? ""),
    ekspedisi: String(
      pkg?.shipping_carrier ?? d?.shipping_carrier ?? "",
    ),
    deadline: ymd(d?.ship_by_date ?? pkg?.ship_by_date),
    buyer_note: String(d?.message_to_seller ?? ""),
  };
}

/** Penghasilan Akhir per pesanan (escrow). Gagal = 0 (fallback ke total). */
async function fetchEscrowAmount(orderSn: string): Promise<number> {
  try {
    const json = await shopGet("/api/v2/payment/get_escrow_detail", { order_sn: orderSn });
    const inc = json?.response?.order_income ?? {};
    const val = Number(inc?.escrow_amount ?? json?.response?.escrow_amount ?? 0);
    return Number.isFinite(val) ? val : 0;
  } catch {
    return 0;
  }
}

/** No resi dari logistik bila detail pesanan belum menyertakannya. */
async function fetchTrackingNumber(orderSn: string): Promise<string> {
  try {
    const json = await shopGet("/api/v2/logistics/get_tracking_number", { order_sn: orderSn });
    return String(json?.response?.tracking_number ?? "");
  } catch {
    return "";
  }
}

async function fetchDetails(sns: string[]) {
  const out: any[] = [];
  for (let i = 0; i < sns.length; i += 45) {
    const chunk = sns.slice(i, i + 45);
    const json = await shopGet("/api/v2/order/get_order_detail", {
      order_sn_list: chunk.join(","),
      response_optional_fields:
        "buyer_username,recipient_address,item_list,total_amount,order_status,message_to_seller,package_list,shipping_carrier,create_time,ship_by_date",
    });
    out.push(...(json?.response?.order_list ?? []));
  }
  // lengkapi Penghasilan Akhir + no resi
  for (const d of out) {
    const sn = String(d?.order_sn ?? "");
    if (!sn) continue;
    d.__escrow_amount = await fetchEscrowAmount(sn);
    const existingResi = d?.package_list?.[0]?.tracking_number ?? d?.tracking_number ?? "";
    if (!existingResi) d.__tracking_number = await fetchTrackingNumber(sn);
  }
  return out;
}


export async function previewOrders(days: number): Promise<ShopeeOrderPreview[]> {
  const sns = await fetchOrderSns(days);
  if (sns.length === 0) return [];
  const details = await fetchDetails(sns);

  const { data: maps } = await supabaseAdmin
    .from("shopee_order_map")
    .select("order_sn, order_id, orders(order_no)")
    .in("order_sn", sns);
  const byS = new Map<string, any>();
  for (const m of maps ?? []) byS.set((m as any).order_sn, m);

  return details.map((d) => {
    const base = mapDetail(d);
    const m = byS.get(base.order_sn);
    return {
      ...base,
      already_imported: !!m?.order_id,
      order_no: (m?.orders as any)?.order_no ?? null,
    };
  });
}

export type ShopeeSyncResult = {
  ok: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  message: string;
};

/** Pastikan nama ekspedisi dari Shopee ada & aktif di master ekspedisi. */
async function ensureCarrier(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const { data: existing } = await supabaseAdmin
    .from("shipping_carriers")
    .select("id, active")
    .ilike("name", trimmed)
    .maybeSingle();
  if (existing) {
    if (!(existing as any).active) {
      await supabaseAdmin.from("shipping_carriers").update({ active: true }).eq("id", (existing as any).id);
    }
    return;
  }
  const { data: maxRow } = await supabaseAdmin
    .from("shipping_carriers")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  await supabaseAdmin.from("shipping_carriers").insert({
    name: trimmed,
    active: true,
    sort_order: ((maxRow as any)?.sort_order ?? 0) + 1,
  } as any);
}

async function importDetail(d: any, result: ShopeeSyncResult) {
  const p = mapDetail(d);
  if (p.ekspedisi) await ensureCarrier(p.ekspedisi);
  if (!p.order_sn) {
    result.skipped++;
    return;
  }

  const { data: existing } = await supabaseAdmin
    .from("shopee_order_map")
    .select("id, order_id")
    .eq("order_sn", p.order_sn)
    .maybeSingle();

  if (existing?.order_id) {
    // hanya perbarui field pengiriman, jangan timpa editan manual
    const patch: Record<string, any> = {};
    if (p.no_resi) patch.no_resi = p.no_resi;
    if (p.ekspedisi) patch.ekspedisi = p.ekspedisi;
    if (p.deadline) patch.deadline = p.deadline;
    if (p.total > 0) patch.payment = p.total;

    if (Object.keys(patch).length > 0) {
      const { error } = await supabaseAdmin.from("orders").update(patch as any).eq("id", existing.order_id);
      if (error) {
        result.errors.push(`${p.order_sn}: ${error.message}`);
        result.skipped++;
        return;
      }
    }
    await supabaseAdmin
      .from("shopee_order_map")
      .update({ shopee_status: p.status, raw: d })
      .eq("id", existing.id);
    result.updated++;
    return;
  }

  const notes = [p.buyer_note, `Shopee: ${p.order_sn}`].filter(Boolean).join(" | ");
  const { data: created, error } = await supabaseAdmin
    .from("orders")
    .insert({
      source: "shopee",
      order_no: "0",
      status: "active",
      co_date: p.co_date,
      username: p.buyer || null,
      kota: p.kota || null,
      text_neon: p.product,
      paket: p.paket || null,
      payment: p.total,
      no_resi: p.no_resi || null,
      ekspedisi: p.ekspedisi || null,
      deadline: p.deadline,
      notes,


    } as any)
    .select("id")
    .single();

  if (error) {
    result.errors.push(`${p.order_sn}: ${error.message}`);
    result.skipped++;
    return;
  }

  await supabaseAdmin.from("shopee_order_map").upsert(
    {
      order_sn: p.order_sn,
      order_id: created.id,
      shopee_status: p.status,
      raw: d,
      imported_at: new Date().toISOString(),
    } as any,
    { onConflict: "order_sn" },
  );
  result.inserted++;
}

function emptyResult(): ShopeeSyncResult {
  return { ok: false, inserted: 0, updated: 0, skipped: 0, errors: [], message: "" };
}

/** Import order_sn tertentu (dipilih manual dari preview). */
export async function importSelected(orderSns: string[]): Promise<ShopeeSyncResult> {
  const result = emptyResult();
  if (orderSns.length === 0) {
    result.message = "Tidak ada pesanan yang dipilih";
    return result;
  }
  const details = await fetchDetails(orderSns);
  for (const d of details) await importDetail(d, result);
  result.ok = true;
  result.message = `${result.inserted} order baru, ${result.updated} diperbarui, ${result.skipped} dilewati.`;
  await persistStatus("ok", result);
  return result;
}

/** Sync otomatis semua pesanan pada rentang lookback. */
export async function runShopeeSync(force = false): Promise<ShopeeSyncResult> {
  const result = emptyResult();
  let s: ShopeeSettings;
  try {
    s = await loadSettings();
  } catch (e: any) {
    result.message = e?.message ?? "Gagal memuat pengaturan";
    return result;
  }
  if (!force && !s.enabled) {
    result.message = "Sync Shopee sedang dinonaktifkan";
    return result;
  }
  try {
    const days = s.lookback_days ?? 7;
    const sns = await fetchOrderSnsAllStatus(days);
    if (sns.length === 0) {
      result.ok = true;
      result.message = "Tidak ada pesanan pada rentang tanggal tersebut.";
      await persistStatus("ok", result);
      return result;
    }
    const details = await fetchDetails(sns);
    for (const d of details) await importDetail(d, result);
    result.ok = true;
    result.message = `${result.inserted} order baru, ${result.updated} diperbarui, ${result.skipped} dilewati.`;
    await persistStatus("ok", result);
  } catch (e: any) {
    result.message = e?.message ?? "Sync gagal";
    result.errors.push(result.message);
    await persistStatus("error", result);
  }
  return result;
}

async function persistStatus(status: "ok" | "error", r: ShopeeSyncResult) {
  await supabaseAdmin
    .from("shopee_settings")
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: status,
      last_sync_message:
        r.message + (r.errors.length ? ` | ${r.errors.slice(0, 3).join(" ;; ")}` : ""),
      last_sync_inserted: r.inserted,
      last_sync_updated: r.updated,
      last_sync_skipped: r.skipped,
    })
    .eq("id", 1);
}

export async function disconnectShop() {
  const { error } = await supabaseAdmin
    .from("shopee_settings")
    .update({
      shop_id: null,
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      connected_at: null,
      enabled: false,
    })
    .eq("id", 1);
  if (error) throw new Error(error.message);
}
