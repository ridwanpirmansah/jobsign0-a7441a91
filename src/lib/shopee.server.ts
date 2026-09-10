/**
 * Shopee Open Platform API v2 integration (server-only).
 * Kredensial aplikasi (partner_id / partner_key) disimpan di shopee_settings;
 * token tiap toko disimpan di shopee_shops. Semua hanya dibaca dari server.
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

export type ShopeeShop = {
  id: string;
  shop_id: string;
  shop_name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  connected_at: string | null;
  active: boolean;
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

export async function listShops(activeOnly = false): Promise<ShopeeShop[]> {
  let q = supabaseAdmin
    .from("shopee_shops")
    .select("id, shop_id, shop_name, access_token, refresh_token, token_expires_at, connected_at, active")
    .order("connected_at", { ascending: true });
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ShopeeShop[];
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

async function saveShopTokens(
  shopId: string,
  accessToken: string,
  refreshToken: string,
  expireInSec: number,
) {
  const { error } = await supabaseAdmin.from("shopee_shops").upsert(
    {
      shop_id: shopId,
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: new Date(Date.now() + expireInSec * 1000).toISOString(),
      connected_at: new Date().toISOString(),
      active: true,
    } as any,
    { onConflict: "shop_id" },
  );
  if (error) throw new Error(error.message);
}

/** Tukar authorization code jadi access/refresh token untuk toko baru/lama. */
export async function exchangeCode(code: string, shopId: string) {
  const json = await postPublic("/api/v2/auth/token/get", {
    code,
    shop_id: Number(shopId),
  });
  await saveShopTokens(shopId, json.access_token, json.refresh_token, json.expire_in ?? 14400);

  // Simpan juga di settings lama bila belum ada toko utama (kompatibilitas).
  const s = await loadSettings();
  if (!s.shop_id) {
    await supabaseAdmin
      .from("shopee_settings")
      .update({ shop_id: shopId, connected_at: new Date().toISOString() } as any)
      .eq("id", 1);
  }

  // Coba ambil nama toko (best effort).
  try {
    const shops = await listShops();
    const shop = shops.find((x) => x.shop_id === shopId);
    if (shop) {
      const info = await shopGet(shop, "/api/v2/shop/get_shop_info", {});
      const name = String(info?.response?.shop_name ?? "").trim();
      if (name) {
        await supabaseAdmin.from("shopee_shops").update({ shop_name: name } as any).eq("shop_id", shopId);
      }
    }
  } catch {
    /* abaikan */
  }
  return json;
}

async function refreshShopIfNeeded(shop: ShopeeShop): Promise<ShopeeShop> {
  if (!shop.shop_id || !shop.refresh_token) {
    throw new Error(`Toko Shopee ${shop.shop_id} belum terhubung. Hubungkan ulang dari menu Integrasi Shopee.`);
  }
  const exp = shop.token_expires_at ? new Date(shop.token_expires_at).getTime() : 0;
  // refresh 10 menit sebelum kedaluwarsa
  if (shop.access_token && exp - Date.now() > 10 * 60 * 1000) return shop;

  const json = await postPublic("/api/v2/auth/access_token/get", {
    refresh_token: shop.refresh_token,
    shop_id: Number(shop.shop_id),
  });
  await saveShopTokens(shop.shop_id, json.access_token, json.refresh_token, json.expire_in ?? 14400);
  return {
    ...shop,
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    token_expires_at: new Date(Date.now() + (json.expire_in ?? 14400) * 1000).toISOString(),
  };
}

/** Panggilan API level toko (butuh access token). */
async function shopGet(shopIn: ShopeeShop, path: string, params: Record<string, string>) {
  const s = await loadSettings();
  const shop = await refreshShopIfNeeded(shopIn);
  const { partnerId, partnerKey } = credentials(s);
  const ts = Math.floor(Date.now() / 1000);
  const signature = sign(
    partnerKey,
    `${partnerId}${path}${ts}${shop.access_token}${shop.shop_id}`,
  );
  const qs = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(ts),
    access_token: shop.access_token!,
    shop_id: shop.shop_id!,
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
async function shopPost(shopIn: ShopeeShop, path: string, body: Record<string, unknown>, raw = false) {
  const s = await loadSettings();
  const shop = await refreshShopIfNeeded(shopIn);
  const { partnerId, partnerKey } = credentials(s);
  const ts = Math.floor(Date.now() / 1000);
  const signature = sign(
    partnerKey,
    `${partnerId}${path}${ts}${shop.access_token}${shop.shop_id}`,
  );
  const qs = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(ts),
    access_token: shop.access_token!,
    shop_id: shop.shop_id!,
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

function shopLabel(shop: ShopeeShop): string {
  return shop.shop_name?.trim() || shop.shop_id;
}

export type ShopeeOrderPreview = {
  order_sn: string;
  shop_id: string;
  shop_name: string;
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
async function fetchOrderSns(shop: ShopeeShop, days: number): Promise<string[]> {
  const now = Math.floor(Date.now() / 1000);
  const windowSec = 15 * 24 * 3600;
  const start = now - Math.max(1, Math.min(days, 90)) * 24 * 3600;
  const sns: string[] = [];

  for (const status of IMPORTABLE_STATUSES) {
    for (let from = start; from < now; from += windowSec) {
      const to = Math.min(from + windowSec - 1, now);
      let cursor = "";
      for (let guard = 0; guard < 20; guard++) {
        const json = await shopGet(shop, "/api/v2/order/get_order_list", {
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
async function fetchOrderSnsAllStatus(shop: ShopeeShop, days: number): Promise<string[]> {
  const now = Math.floor(Date.now() / 1000);
  const windowSec = 15 * 24 * 3600;
  const start = now - Math.max(1, Math.min(days, 90)) * 24 * 3600;
  const sns: string[] = [];
  for (let from = start; from < now; from += windowSec) {
    const to = Math.min(from + windowSec - 1, now);
    let cursor = "";
    for (let guard = 0; guard < 20; guard++) {
      const json = await shopGet(shop, "/api/v2/order/get_order_list", {
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

function mapDetail(d: any): Omit<ShopeeOrderPreview, "already_imported" | "order_no" | "shop_id" | "shop_name"> {
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
async function fetchEscrowAmount(shop: ShopeeShop, orderSn: string): Promise<number> {
  try {
    const json = await shopGet(shop, "/api/v2/payment/get_escrow_detail", { order_sn: orderSn });
    const inc = json?.response?.order_income ?? {};
    const val = Number(inc?.escrow_amount ?? json?.response?.escrow_amount ?? 0);
    return Number.isFinite(val) ? val : 0;
  } catch {
    return 0;
  }
}

/** No resi dari logistik bila detail pesanan belum menyertakannya. */
async function fetchTrackingNumber(shop: ShopeeShop, orderSn: string): Promise<string> {
  try {
    const json = await shopGet(shop, "/api/v2/logistics/get_tracking_number", { order_sn: orderSn });
    return String(json?.response?.tracking_number ?? "");
  } catch {
    return "";
  }
}

async function fetchDetails(shop: ShopeeShop, sns: string[]) {
  const out: any[] = [];
  for (let i = 0; i < sns.length; i += 45) {
    const chunk = sns.slice(i, i + 45);
    const json = await shopGet(shop, "/api/v2/order/get_order_detail", {
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
    d.__escrow_amount = await fetchEscrowAmount(shop, sn);
    const existingResi = d?.package_list?.[0]?.tracking_number ?? d?.tracking_number ?? "";
    if (!existingResi) d.__tracking_number = await fetchTrackingNumber(shop, sn);
  }
  return out;
}

export async function previewOrders(days: number): Promise<ShopeeOrderPreview[]> {
  const shops = await listShops(true);
  if (shops.length === 0) {
    throw new Error("Belum ada toko Shopee terhubung. Hubungkan dulu dari menu Integrasi Shopee.");
  }

  const rows: ShopeeOrderPreview[] = [];
  const errors: string[] = [];
  for (const shop of shops) {
    try {
      const sns = await fetchOrderSns(shop, days);
      if (sns.length === 0) continue;
      const details = await fetchDetails(shop, sns);

      const { data: maps } = await supabaseAdmin
        .from("shopee_order_map")
        .select("order_sn, order_id, orders(order_no)")
        .eq("shop_id", shop.shop_id)
        .in("order_sn", sns);
      const byS = new Map<string, any>();
      for (const m of maps ?? []) byS.set((m as any).order_sn, m);

      for (const d of details) {
        const base = mapDetail(d);
        const m = byS.get(base.order_sn);
        rows.push({
          ...base,
          shop_id: shop.shop_id,
          shop_name: shopLabel(shop),
          already_imported: !!m?.order_id,
          order_no: (m?.orders as any)?.order_no ?? null,
        });
      }
    } catch (e: any) {
      errors.push(`${shopLabel(shop)}: ${String(e?.message ?? e)}`);
    }
  }
  if (rows.length === 0 && errors.length > 0) throw new Error(errors.join(" | "));
  return rows;
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

async function importDetail(shop: ShopeeShop, d: any, result: ShopeeSyncResult) {
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
    .eq("shop_id", shop.shop_id)
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
      .update({ shopee_status: p.status, raw: d, shop_id: shop.shop_id } as any)
      .eq("id", existing.id);
    await importShopeeShippingAssets(shop, p.order_sn, existing.order_id, p.status, result);
    result.updated++;
    return;
  }

  const notes = [p.buyer_note, `Shopee: ${p.order_sn}`, `Toko: ${shopLabel(shop)}`]
    .filter(Boolean)
    .join(" | ");
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
      shopee_shop_id: shop.shop_id,
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
      shop_id: shop.shop_id,
      order_id: created.id,
      shopee_status: p.status,
      raw: d,
      imported_at: new Date().toISOString(),
    } as any,
    { onConflict: "order_sn,shop_id" },
  );
  await importShopeeShippingAssets(shop, p.order_sn, created.id, p.status, result);
  result.inserted++;
}

function emptyResult(): ShopeeSyncResult {
  return { ok: false, inserted: 0, updated: 0, skipped: 0, errors: [], message: "" };
}

/** Import order tertentu (dipilih manual dari preview), dikelompokkan per toko. */
export async function importSelected(
  items: { order_sn: string; shop_id: string }[],
): Promise<ShopeeSyncResult> {
  const result = emptyResult();
  if (items.length === 0) {
    result.message = "Tidak ada pesanan yang dipilih";
    return result;
  }
  const shops = await listShops(true);
  const byShop = new Map<string, { shop: ShopeeShop; sns: string[] }>();
  for (const item of items) {
    const shop = shops.find((s) => s.shop_id === item.shop_id);
    if (!shop) {
      result.errors.push(`${item.order_sn}: toko ${item.shop_id} tidak terhubung`);
      result.skipped++;
      continue;
    }
    const entry = byShop.get(shop.shop_id) ?? { shop, sns: [] };
    entry.sns.push(item.order_sn);
    byShop.set(shop.shop_id, entry);
  }
  for (const { shop, sns } of byShop.values()) {
    try {
      const details = await fetchDetails(shop, sns);
      for (const d of details) await importDetail(shop, d, result);
    } catch (e: any) {
      result.errors.push(`${shopLabel(shop)}: ${String(e?.message ?? e)}`);
      result.skipped += sns.length;
    }
  }
  result.ok = true;
  result.message = `${result.inserted} order baru, ${result.updated} diperbarui, ${result.skipped} dilewati.${result.errors.length ? ` ${result.errors.length} resi/order belum berhasil diimpor; jalankan sync ulang.` : " Semua PDF resi tersedia di webapp."}`;
  await persistStatus("ok", result);
  return result;
}

/** Sync otomatis semua pesanan semua toko aktif pada rentang lookback. */
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
    const shops = await listShops(true);
    if (shops.length === 0) {
      result.message = "Belum ada toko Shopee terhubung";
      await persistStatus("error", result);
      return result;
    }
    const days = s.lookback_days ?? 7;
    for (const shop of shops) {
      try {
        const sns = await fetchOrderSnsAllStatus(shop, days);
        if (sns.length === 0) continue;
        const details = await fetchDetails(shop, sns);
        for (const d of details) await importDetail(shop, d, result);
      } catch (e: any) {
        result.errors.push(`${shopLabel(shop)}: ${String(e?.message ?? e)}`);
      }
    }
    result.ok = true;
    result.message = `${result.inserted} order baru, ${result.updated} diperbarui, ${result.skipped} dilewati dari ${shops.length} toko.${result.errors.length ? ` ${result.errors.length} resi/error belum berhasil; sync berikutnya akan mencoba lagi.` : " Semua PDF resi tersedia di webapp."}`;
    await persistStatus(result.errors.length > 0 && result.inserted + result.updated === 0 ? "error" : "ok", result);
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
    } as any)
    .eq("id", 1);
}

/** Putuskan satu toko (token dihapus, toko dinonaktifkan). */
export async function disconnectShop(shopId: string) {
  const { error } = await supabaseAdmin
    .from("shopee_shops")
    .update({
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      active: false,
    } as any)
    .eq("shop_id", shopId);
  if (error) throw new Error(error.message);

  // Bersihkan referensi lama di settings bila menunjuk toko ini.
  const s = await loadSettings();
  if (s.shop_id === shopId) {
    await supabaseAdmin
      .from("shopee_settings")
      .update({ shop_id: null, access_token: null, refresh_token: null, token_expires_at: null } as any)
      .eq("id", 1);
  }
}

/* ------------------------------------------------------------------ */
/* Label / Resi resmi Shopee (Shipping Document PDF)                    */
/* ------------------------------------------------------------------ */

const DOC_TYPE = "THERMAL_AIR_WAYBILL";

type PackageInfo = { package_number?: string; tracking_number?: string };

function b64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Info paket (package_number & tracking_number) untuk order_sn. */
async function fetchPackageInfo(
  shop: ShopeeShop,
  orderSn: string,
): Promise<PackageInfo> {
  const info: PackageInfo = {};
  try {
    const json = await shopGet(shop, "/api/v2/order/get_order_detail", {
      order_sn_list: orderSn,
      response_optional_fields: "package_list",
    });
    const pkg = json?.response?.order_list?.[0]?.package_list?.[0];
    if (pkg?.package_number) info.package_number = String(pkg.package_number);
    if (pkg?.tracking_number) info.tracking_number = String(pkg.tracking_number);
  } catch {
    /* abaikan */
  }
  if (!info.tracking_number) {
    const tn = await fetchTrackingNumber(shop, orderSn);
    if (tn) info.tracking_number = tn;
  }
  return info;
}

function orderItem(sn: string, info: { package_number?: string }) {
  const item: Record<string, unknown> = { order_sn: sn };
  if (info.package_number) item.package_number = info.package_number;
  return item;
}

function requiredFields(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return value === true ? ["required"] : [];
}

function firstNumber(source: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/**
 * Atur pengiriman untuk pesanan READY_TO_SHIP yang belum mempunyai resi.
 * Parameter pickup/dropoff selalu dipilih dari opsi yang dikembalikan Shopee,
 * sehingga panggilan ini tetap valid untuk kurir yang berbeda-beda.
 */
async function ensureShipmentArranged(shop: ShopeeShop, orderSn: string, info: PackageInfo): Promise<PackageInfo> {
  if (info.tracking_number) return info;

  const params: Record<string, string> = { order_sn: orderSn };
  if (info.package_number) params.package_number = info.package_number;
  const json = await shopGet(shop, "/api/v2/logistics/get_shipping_parameter", params);
  const response = json?.response ?? {};
  const needed = response?.info_needed ?? {};
  const body: Record<string, unknown> = { order_sn: orderSn };
  if (info.package_number) body.package_number = info.package_number;

  const pickupFields = requiredFields(needed?.pickup);
  const dropoffFields = requiredFields(needed?.dropoff);
  const nonIntegratedFields = requiredFields(needed?.non_integrated);

  if (pickupFields.length > 0) {
    const address = response?.pickup?.address_list?.[0];
    const slot = address?.time_slot_list?.[0];
    const addressId = firstNumber(address, ["address_id"]);
    const pickupTimeId = firstNumber(slot, ["pickup_time_id", "time_slot_id"]);
    if (!addressId || !pickupTimeId) {
      throw new Error("Shopee belum menyediakan alamat atau jadwal pickup yang dapat dipilih");
    }
    body.pickup = { address_id: addressId, pickup_time_id: pickupTimeId };
  } else if (dropoffFields.length > 0) {
    const branch = response?.dropoff?.branch_list?.[0];
    const branchId = firstNumber(branch, ["branch_id"]);
    const slug = String(response?.dropoff?.slug ?? branch?.slug ?? "").trim();
    const dropoff: Record<string, unknown> = {};
    if (branchId) dropoff.branch_id = branchId;
    if (slug) dropoff.slug = slug;
    if (dropoffFields.includes("sender_real_name")) {
      const sender = String(response?.dropoff?.sender_real_name ?? "").trim();
      if (!sender) throw new Error("Shopee meminta nama pengirim untuk dropoff");
      dropoff.sender_real_name = sender;
    }
    if (!branchId && !slug && dropoffFields.some((field) => field !== "sender_real_name")) {
      throw new Error("Shopee belum menyediakan cabang dropoff yang dapat dipilih");
    }
    body.dropoff = dropoff;
  } else if (nonIntegratedFields.length > 0) {
    if (!info.tracking_number) {
      throw new Error("Kurir non-integrasi membutuhkan nomor resi dari Shopee terlebih dahulu");
    }
    body.non_integrated = { tracking_number: info.tracking_number };
  } else {
    // Sebagian kanal tidak meminta parameter tambahan.
  }

  try {
    await shopPost(shop, "/api/v2/logistics/ship_order", body);
  } catch (error: any) {
    const message = String(error?.message ?? "");
    if (!/already|duplicate|processed|shipped|arranged|not_ready_to_ship/i.test(message)) throw error;
  }

  let refreshed = info;
  for (let attempt = 0; attempt < 8; attempt++) {
    refreshed = await fetchPackageInfo(shop, orderSn);
    if (refreshed.tracking_number) return refreshed;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return refreshed;
}

/** Impor resi dan PDF pada saat sinkronisasi; preview tidak pernah memanggil Shopee. */
async function importShopeeShippingAssets(
  shop: ShopeeShop,
  orderSn: string,
  orderId: string,
  status: string,
  result: ShopeeSyncResult,
) {
  const { data: order, error: readError } = await supabaseAdmin
    .from("orders")
    .select("shopee_label_pdf, no_resi")
    .eq("id", orderId)
    .maybeSingle();
  if (readError) {
    result.errors.push(`${orderSn}: gagal membaca resi tersimpan (${readError.message})`);
    return;
  }
  if ((order as any)?.shopee_label_pdf) return;

  try {
    let info = await fetchPackageInfo(shop, orderSn);
    if (!info.tracking_number && status.toUpperCase() === "READY_TO_SHIP") {
      info = await ensureShipmentArranged(shop, orderSn, info);
    }
    const pdf = await fetchShopeeLabelBase64(shop, orderSn);
    const patch: Record<string, unknown> = { shopee_label_pdf: pdf };
    if (info.tracking_number) patch.no_resi = info.tracking_number;
    const { error } = await supabaseAdmin.from("orders").update(patch as any).eq("id", orderId);
    if (error) throw new Error(error.message);
  } catch (error: any) {
    result.errors.push(`${orderSn}: order masuk, tetapi PDF resi belum terimpor (${String(error?.message ?? error)})`);
  }
}

/** Minta Shopee membuat dokumen resi. */
async function createShippingDocument(
  shop: ShopeeShop,
  sn: string,
  info: { package_number?: string; tracking_number?: string },
) {
  const item: Record<string, unknown> = {
    ...orderItem(sn, info),
    shipping_document_type: DOC_TYPE,
  };
  if (info.tracking_number) item.tracking_number = info.tracking_number;
  try {
    await shopPost(shop, "/api/v2/logistics/create_shipping_document", { order_list: [item] });
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    // Dokumen sudah pernah dibuat → aman dilanjutkan.
    if (!/already|exist|created|processing|duplicate/i.test(msg)) throw e;
  }
}

/** Tunggu dokumen siap diunduh. */
async function waitDocumentReady(shop: ShopeeShop, sn: string, info: { package_number?: string }) {
  for (let i = 0; i < 12; i++) {
    const res: any = await shopPost(shop, "/api/v2/logistics/get_shipping_document_result", {
      shipping_document_type: DOC_TYPE,
      order_list: [orderItem(sn, info)],
    });
    const r = res?.response?.result_list?.[0];
    const st = String(r?.status ?? "").toUpperCase();
    if (st === "READY") return true;
    if (st === "FAILED") {
      throw new Error(
        `Shopee gagal menyiapkan resi: ${r?.fail_message ?? r?.fail_error ?? "tidak diketahui"}`,
      );
    }
    await new Promise((r2) => setTimeout(r2, 1200));
  }
  return false;
}

/** Ambil PDF resi resmi Shopee untuk satu order_sn (base64). */
export async function fetchShopeeLabelBase64(shop: ShopeeShop, orderSn: string): Promise<string> {
  const sn = orderSn.trim();
  if (!sn) throw new Error("order_sn kosong");

  const info = await fetchPackageInfo(shop, sn);

  for (let attempt = 0; attempt < 2; attempt++) {
    await createShippingDocument(shop, sn, info);
    const ready = await waitDocumentReady(shop, sn, info);
    if (!ready) {
      if (attempt === 0) continue;
      throw new Error("Resi Shopee belum siap, coba lagi beberapa saat lagi.");
    }
    try {
      const out: any = await shopPost(
        shop,
        "/api/v2/logistics/download_shipping_document",
        { shipping_document_type: DOC_TYPE, order_list: [orderItem(sn, info)] },
        true,
      );
      const bytes: Uint8Array | undefined = out?.__binary;
      if (!bytes || bytes.length === 0) throw new Error("File resi Shopee kosong");
      return b64(bytes);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      // Dokumen belum benar-benar dibuat → ulangi sekali dari awal.
      if (attempt === 0 && /should_print_first|should print|not_ready|no_shipping_document/i.test(msg)) {
        continue;
      }
      throw e;
    }
  }
  throw new Error("Gagal mengunduh resi Shopee, coba lagi.");
}

/** Cari order_sn Shopee dari order internal. */
export async function findShopeeOrderSn(orderId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("shopee_order_map")
    .select("order_sn")
    .eq("order_id", orderId)
    .maybeSingle();
  return (data as any)?.order_sn ?? null;
}
