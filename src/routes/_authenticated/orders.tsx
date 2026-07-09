import { createFileRoute } from "@tanstack/react-router";
import React, { useState, useMemo, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listOrders, listPrices, upsertOrder, deleteOrder,
  listOrderItems, upsertOrderItem, deleteOrderItem, listReadyStockAvailable,
  markReadyPickup, listCarriers,
} from "@/lib/orders.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingBag, Plus, Pencil, Trash2, Copy, ArrowUp, ArrowDown, ArrowUpDown,
  Package, Boxes, ChevronRight, ChevronDown, Truck, PackageCheck, Wand2, Printer,
} from "lucide-react";
import { toast } from "sonner";
import { generateResiNumber, printResiPdf } from "@/lib/resi-pdf";
import { WorkflowTabs } from "@/components/WorkflowTabs";

export const Route = createFileRoute("/_authenticated/orders")({
  component: () => <OrdersPage mode="orders" />,
  head: () => ({ meta: [{ title: "Daftar Order Neon Sign" }] }),
});

const SOURCES = ["shopee", "tiktok", "tokopedia", "lazada", "direct", "lainnya"] as const;
type Source = (typeof SOURCES)[number];

const STATUSES = ["active", "return", "draft", "ready_stock"] as const;
type OrderStatus = (typeof STATUSES)[number];
const STATUS_LABEL: Record<OrderStatus, string> = { active: "Aktif", return: "Retur", draft: "Draft", ready_stock: "Ready Stock" };

const ADAPTOR_VARIANTS = [
  { key: "adaptor_2a", label: "Adaptor 2A", maxLed: 3, defaultPrice: 8000 },
  { key: "adaptor_3a", label: "Adaptor 3A", maxLed: 5, defaultPrice: 15000 },
  { key: "adaptor_3a_murni", label: "Adaptor 3A Murni", maxLed: 8, defaultPrice: 30000 },
  { key: "adaptor_5a_murni", label: "Adaptor 5A Murni", maxLed: 11, defaultPrice: 40000 },
] as const;

function suggestAdaptor(ledMeter: number): typeof ADAPTOR_VARIANTS[number] {
  return ADAPTOR_VARIANTS.find((a) => ledMeter <= a.maxLed) ?? ADAPTOR_VARIANTS[ADAPTOR_VARIANTS.length - 1];
}

const rp = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n || 0));
const num = (s: string) => { const n = parseFloat(s); return isNaN(n) ? 0 : n; };

type HeaderForm = {
  id?: string;
  source: Source;
  status: OrderStatus;
  order_no: string;
  co_date: string;
  username: string;
  kota: string;
  payment: string;
  dp: string;
  split: string;
  notes: string;
  no_resi: string;
  ekspedisi: string;
  ready_pickup_at?: string | null;
  picked_up_at?: string | null;
};

// Ekspedisi dikelola dinamis via table `shipping_carriers`

type ItemKind = "custom" | "ready_stock_ref" | "ready_stock_manual";

type ItemForm = {
  id?: string;                // DB id if existing
  _key: string;               // client key
  _deleted?: boolean;
  position: number;
  kind: ItemKind;
  // custom
  text_neon: string;
  akrilik_p: string;
  akrilik_l: string;
  led_meter: string;
  titik: string;
  kabel_meter: string;
  kabel_socket_meter: string;
  adaptor: string;
  adaptor_type: string;
  adaptor_manual: boolean;
  modul: string;
  socket_dc: string;
  baut_fischer: string;
  use_outdoor: boolean;
  outdoor_cost: string;
  notes: string;
  // ready_stock_ref
  source_ready_stock_order_id: string;
  // ready_stock_manual
  manual_name: string;
  manual_price: string;
  manual_hpp: string;
};

function emptyHeader(nextOrderNo = "", status: OrderStatus = "active"): HeaderForm {
  return {
    source: "shopee", status, order_no: nextOrderNo,
    co_date: new Date().toISOString().slice(0, 10),
    username: "", kota: "",
    payment: "", dp: "", split: "", notes: "",
    no_resi: "", ekspedisi: "",
  };
}

function emptyItem(pos: number, defaults: Record<string, number> = {}, kind: ItemKind = "custom"): ItemForm {
  return {
    _key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    position: pos, kind,
    text_neon: "", akrilik_p: "", akrilik_l: "", led_meter: "", titik: "",
    kabel_meter: "", kabel_socket_meter: "1",
    adaptor: "", adaptor_type: "adaptor_2a", adaptor_manual: false,
    modul: String(defaults.modul_default ?? 0),
    socket_dc: String(defaults.socket_dc_default ?? 0),
    baut_fischer: String(defaults.baut_fischer_default ?? 0),
    use_outdoor: false, outdoor_cost: "", notes: "",
    source_ready_stock_order_id: "",
    manual_name: "", manual_price: "", manual_hpp: "",
  };
}

function itemFromDb(row: any): ItemForm {
  return {
    id: row.id, _key: row.id,
    position: row.position ?? 1,
    kind: row.kind ?? "custom",
    text_neon: row.text_neon ?? "",
    akrilik_p: String(row.akrilik_p ?? ""),
    akrilik_l: String(row.akrilik_l ?? ""),
    led_meter: String(row.led_meter ?? ""),
    titik: String(row.titik ?? ""),
    kabel_meter: row.kabel_meter == null ? "" : String(row.kabel_meter),
    kabel_socket_meter: String(row.kabel_socket_meter ?? 1),
    adaptor: String(row.adaptor ?? 0),
    adaptor_type: row.adaptor_type ?? "adaptor_2a",
    adaptor_manual: false,
    modul: String(row.modul ?? 0),
    socket_dc: String(row.socket_dc ?? 0),
    baut_fischer: String(row.baut_fischer ?? 0),
    use_outdoor: Number(row.outdoor_cost ?? 0) > 0,
    outdoor_cost: row.outdoor_cost == null ? "" : String(row.outdoor_cost),
    notes: row.notes ?? "",
    source_ready_stock_order_id: row.source_ready_stock_order_id ?? "",
    manual_name: row.manual_name ?? "",
    manual_price: String(row.manual_price ?? ""),
    manual_hpp: String(row.manual_hpp ?? ""),
  };
}

function calcItemHpp(item: ItemForm, priceMap: Record<string, number>): number {
  if (item.kind === "ready_stock_manual") return num(item.manual_hpp);
  if (item.kind === "ready_stock_ref") return 0; // filled from ref on server
  // custom
  const led_meter = num(item.led_meter);
  const titik = num(item.titik);
  const p = num(item.akrilik_p);
  const l = num(item.akrilik_l);
  const kabel_meter = num(item.kabel_meter) || (((led_meter / 4) * 3) + 1.5 + ((titik * 5) / 100));
  const kabel_socket_meter = item.kabel_socket_meter === "" ? 1 : num(item.kabel_socket_meter);
  const outdoor_cost = item.use_outdoor ? (num(item.outdoor_cost) || titik * 2000) : 0;
  const led_cost = Math.round(led_meter * (priceMap.led_per_meter ?? 0));
  const akrilik_cost = Math.round(p * l * (priceMap.akrilik_per_cm2 ?? 0));
  const solder_cost = Math.round(titik * (priceMap.solder_per_titik ?? 0));
  const tempel_cost = Math.round(titik * (priceMap.tempel_per_titik ?? 0));
  const kabel_cost = Math.round(kabel_meter * (priceMap.kabel_per_meter ?? 0));
  const kabel_socket_cost = Math.round(kabel_socket_meter * (priceMap.kabel_socket_per_meter ?? 0));
  const suggested = suggestAdaptor(led_meter);
  const variantPrice = priceMap[item.adaptor_type] ?? suggested.defaultPrice;
  const adaptorCost = item.adaptor_manual ? num(item.adaptor) : variantPrice;
  const base = led_cost + akrilik_cost + solder_cost + tempel_cost + kabel_cost + kabel_socket_cost +
    adaptorCost + num(item.modul) + num(item.socket_dc) + num(item.baut_fischer) + outdoor_cost;
  return base + Math.round(base * 0.01);
}

export function OrdersPage({ mode = "orders" }: { mode?: "orders" | "ready_stock" }) {
  const isReady = mode === "ready_stock";
  const fetchOrders = useServerFn(listOrders);
  const fetchPrices = useServerFn(listPrices);
  const saveOrder = useServerFn(upsertOrder);
  const delOrder = useServerFn(deleteOrder);
  const fetchItems = useServerFn(listOrderItems);
  const saveItem = useServerFn(upsertOrderItem);
  const delItem = useServerFn(deleteOrderItem);
  const fetchRs = useServerFn(listReadyStockAvailable);
  const markPickup = useServerFn(markReadyPickup);
  const qc = useQueryClient();

  const markPickupMut = useMutation({
    mutationFn: (orderId: string) => markPickup({ data: {
      order_id: orderId,
      no_resi: header.no_resi.trim() || undefined,
      ekspedisi: header.ekspedisi || null,
    } }),
    onSuccess: () => {
      toast.success("Ditandai siap pickup");
      setHeader((f) => ({ ...f, ready_pickup_at: new Date().toISOString() }));
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ordersQ = useQuery({ queryKey: ["orders"], queryFn: () => fetchOrders() });
  const pricesQ = useQuery({ queryKey: ["material_prices"], queryFn: () => fetchPrices() });
  const fetchCarriers = useServerFn(listCarriers);
  const carriersQ = useQuery({ queryKey: ["shipping_carriers"], queryFn: () => fetchCarriers() });
  const carriers = (carriersQ.data ?? []).filter((c: any) => c.active);
  const rsQ = useQuery({ queryKey: ["rs-available"], queryFn: () => fetchRs() });

  const priceMap = useMemo(() => {
    const m: Record<string, number> = {};
    (pricesQ.data ?? []).forEach((p: any) => { m[p.key] = Number(p.value); });
    return m;
  }, [pricesQ.data]);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [srcFilter, setSrcFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [header, setHeader] = useState<HeaderForm>(emptyHeader());
  const [items, setItems] = useState<ItemForm[]>([]);
  const [expandedItemKey, setExpandedItemKey] = useState<string | null>(null);

  const addNewItem = () => {
    setItems((arr) => {
      const next = emptyItem(arr.filter((i) => !i._deleted).length + 1, priceMap);
      setExpandedItemKey(next._key);
      return [...arr, next];
    });
  };

  type SortKey = "order_no" | "co_date" | "source" | "status" | "username" | "text_neon" | "titik" | "hpp" | "payment" | "profit";
  const [sortKey, setSortKey] = useState<SortKey>("co_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "co_date" || k === "profit" || k === "payment" || k === "hpp" ? "desc" : "asc"); }
  };

  const nextOrderNo = useMemo(() => {
    const list = ordersQ.data ?? [];
    let max = 0;
    for (const o of list) {
      if (o.status === "ready_stock" || o.status === "draft") continue;
      if (/^RS-/i.test(String(o.order_no ?? ""))) continue;
      const m = String(o.order_no ?? "").match(/(\d+)/g);
      if (m) {
        const n = parseInt(m[m.length - 1], 10);
        if (!isNaN(n) && n > max) max = n;
      }
    }
    return String(max + 1);
  }, [ordersQ.data]);

  const nextReadyStockNo = useMemo(() => {
    const list = ordersQ.data ?? [];
    let max = 0;
    for (const o of list) {
      const s = String(o.order_no ?? "");
      const m = s.match(/^RS-(\d+)$/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n) && n > max) max = n;
      }
    }
    return `RS-${max + 1}`;
  }, [ordersQ.data]);

  // Load items when editing an existing order
  const itemsQ = useQuery({
    queryKey: ["order-items", header.id],
    queryFn: () => fetchItems({ data: { orderId: header.id! } }),
    enabled: open && !!header.id,
  });

  useEffect(() => {
    if (open && header.id && itemsQ.data) {
      const rows = itemsQ.data as any[];
      const list = rows.length ? rows.map(itemFromDb) : [emptyItem(1, priceMap, isReady ? "custom" : "custom")];
      setItems(list);
      setExpandedItemKey(list.length === 1 ? list[0]._key : null);
    }
  }, [open, header.id, itemsQ.data]);

  const openNew = () => {
    setHeader(emptyHeader(isReady ? nextReadyStockNo : nextOrderNo, isReady ? "ready_stock" : "active"));
    const first = emptyItem(1, priceMap, "custom");
    setItems([first]);
    setExpandedItemKey(first._key);
    setOpen(true);
  };
  const openEdit = (o: any) => {
    setHeader({
      id: o.id, source: o.source, status: (o.status as OrderStatus) ?? "active",
      order_no: o.order_no, co_date: o.co_date ?? "",
      username: o.username ?? "", kota: o.kota ?? "",
      payment: String(o.payment ?? ""), dp: String(o.dp ?? ""), split: String(o.split ?? ""),
      notes: o.notes ?? "",
      no_resi: o.no_resi ?? "", ekspedisi: o.ekspedisi ?? "",
      ready_pickup_at: o.ready_pickup_at ?? null,
      picked_up_at: o.picked_up_at ?? null,
    });
    setItems([]); // will be filled by itemsQ effect
    setExpandedItemKey(null);
    setOpen(true);
  };

  const openDuplicate = (o: any) => {
    setHeader({
      source: o.source, status: (o.status as OrderStatus) ?? "active",
      order_no: isReady ? nextReadyStockNo : nextOrderNo,
      co_date: new Date().toISOString().slice(0, 10),
      username: o.username ?? "", kota: o.kota ?? "",
      payment: String(o.payment ?? ""), dp: "", split: String(o.split ?? ""),
      notes: o.notes ?? "",
      no_resi: "", ekspedisi: o.ekspedisi ?? "",
    });
    // clone items
    const srcItems = (o.order_items ?? []) as any[];
    if (srcItems.length) {
      // Only clone summary; deep clone requires refetch - keep simple: single item from header row copy
      // Better: fetch items of that order and clone. For now: create 1 custom placeholder if we lack detail.
      setItems([emptyItem(1, priceMap)]);
    } else {
      setItems([emptyItem(1, priceMap)]);
    }
    setOpen(true);
  };

  const totalItemsHpp = useMemo(() =>
    items.filter((i) => !i._deleted).reduce((s, i) => {
      if (i.kind === "ready_stock_ref") {
        const rs = (rsQ.data ?? []).find((r: any) => r.id === i.source_ready_stock_order_id);
        return s + Number(rs?.hpp ?? 0);
      }
      return s + calcItemHpp(i, priceMap);
    }, 0),
    [items, priceMap, rsQ.data],
  );
  const totalPay = num(header.payment) + num(header.split);
  const totalProfit = totalPay - totalItemsHpp;

  const saveMut = useMutation({
    mutationFn: async () => {
      const isDraftLike = header.status === "draft" || header.status === "ready_stock";
      const alive = items.filter((i) => !i._deleted);
      if (alive.length === 0) throw new Error("Minimal harus ada 1 item produk");
      for (const it of alive) {
        if (it.kind === "custom" && !it.text_neon.trim()) throw new Error(`Item #${it.position}: TEXT wajib diisi`);
        if (it.kind === "ready_stock_ref" && !it.source_ready_stock_order_id) throw new Error(`Item #${it.position}: pilih ready-stock`);
        if (it.kind === "ready_stock_manual" && !it.manual_name.trim()) throw new Error(`Item #${it.position}: nama produk wajib`);
      }
      if (!isDraftLike && !header.order_no.trim()) throw new Error("No. Order wajib diisi untuk status Aktif/Retur");

      // For legacy compat, keep required text_neon at header level (use first item's label)
      const firstLabel = alive[0].kind === "custom" ? alive[0].text_neon : alive[0].manual_name || "Ready Stock";

      const res = await saveOrder({
        data: {
          id: header.id,
          source: header.source,
          status: header.status,
          order_no: header.order_no.trim(),
          co_date: header.co_date || null,
          username: header.username || null,
          kota: header.kota || null,
          text_neon: firstLabel,
          akrilik_p: 0, akrilik_l: 0, led_meter: 0, titik: 0,
          kabel_meter: 0, kabel_socket_meter: 1,
          payment: num(header.payment), dp: num(header.dp), split: num(header.split),
          adaptor: 0, adaptor_type: null,
          modul: 0, socket_dc: 0, baut_fischer: 0,
          outdoor_cost: 0,
          notes: header.notes || null,
          no_resi: header.no_resi.trim() || null,
          ekspedisi: header.ekspedisi || null,
        },
      });
      const orderId = res.id!;

      // Delete removed items
      for (const it of items) {
        if (it._deleted && it.id) await delItem({ data: { id: it.id } });
      }
      // Upsert alive items
      for (let i = 0; i < alive.length; i++) {
        const it = alive[i];
        const pos = i + 1;
        const suggested = suggestAdaptor(num(it.led_meter));
        const variantPrice = priceMap[it.adaptor_type] ?? suggested.defaultPrice;
        const adaptorCost = it.adaptor_manual ? num(it.adaptor) : variantPrice;
        await saveItem({
          data: {
            id: it.id,
            order_id: orderId,
            position: pos,
            kind: it.kind,
            text_neon: it.kind === "custom" ? it.text_neon : null,
            akrilik_p: num(it.akrilik_p), akrilik_l: num(it.akrilik_l),
            led_meter: num(it.led_meter),
            titik: Math.floor(num(it.titik)),
            kabel_meter: it.kabel_meter === "" ? null : num(it.kabel_meter),
            kabel_socket_meter: it.kabel_socket_meter === "" ? 1 : num(it.kabel_socket_meter),
            adaptor: it.kind === "custom" ? adaptorCost : 0,
            adaptor_type: it.kind === "custom" ? (it.adaptor_type || null) : null,
            modul: num(it.modul), socket_dc: num(it.socket_dc), baut_fischer: num(it.baut_fischer),
            outdoor_cost: it.kind === "custom"
              ? (!it.use_outdoor ? 0 : (it.outdoor_cost === "" ? null : num(it.outdoor_cost)))
              : 0,
            source_ready_stock_order_id: it.kind === "ready_stock_ref" ? it.source_ready_stock_order_id : null,
            manual_name: it.kind === "ready_stock_manual" ? it.manual_name : null,
            manual_price: it.kind === "ready_stock_manual" ? num(it.manual_price) : 0,
            manual_hpp: it.kind === "ready_stock_manual" ? num(it.manual_hpp) : 0,
            notes: it.notes || null,
          },
        });
      }
      return { orderId };
    },
    onSuccess: () => {
      toast.success(header.id ? "Order diperbarui" : "Order ditambahkan");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["rs-available"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Gagal simpan"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => delOrder({ data: { id } }),
    onSuccess: () => { toast.success("Dihapus"); qc.invalidateQueries({ queryKey: ["orders"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Gagal hapus"),
  });

  const filtered = useMemo(() => {
    const list = ordersQ.data ?? [];
    const out = list.filter((o: any) => {
      if (isReady ? o.status !== "ready_stock" : o.status === "ready_stock") return false;
      if (srcFilter !== "all" && o.source !== srcFilter) return false;
      if (!filter.trim()) return true;
      const q = filter.toLowerCase();
      return [o.order_no, o.username, o.kota, o.text_neon].some((v) => String(v ?? "").toLowerCase().includes(q));
    });
    const numericKeys: SortKey[] = ["titik", "hpp", "payment", "profit"];
    const sorted = [...out].sort((a: any, b: any) => {
      let av: any; let bv: any;
      if (sortKey === "order_no") {
        const na = parseInt(String(a.order_no ?? "").replace(/\D/g, ""), 10);
        const nb = parseInt(String(b.order_no ?? "").replace(/\D/g, ""), 10);
        av = isNaN(na) ? -1 : na; bv = isNaN(nb) ? -1 : nb;
      } else if (sortKey === "payment") {
        av = Number(a.payment || 0) + Number(a.split || 0);
        bv = Number(b.payment || 0) + Number(b.split || 0);
      } else if (numericKeys.includes(sortKey)) {
        av = Number(a[sortKey] || 0); bv = Number(b[sortKey] || 0);
      } else {
        av = String(a[sortKey] ?? "").toLowerCase();
        bv = String(b[sortKey] ?? "").toLowerCase();
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [ordersQ.data, filter, srcFilter, isReady, sortKey, sortDir]);

  const totals = useMemo(() => filtered.reduce(
    (acc: any, o: any) => {
      acc.payment += Number(o.payment || 0);
      acc.hpp += Number(o.hpp || 0);
      acc.profit += Number(o.profit || 0);
      return acc;
    }, { payment: 0, hpp: 0, profit: 0 },
  ), [filtered]);

  return (
    <div className="p-2 sm:p-4 space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShoppingBag className="h-6 w-6"/> {isReady ? "Ready Stock" : "Order Neon Sign"}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isReady
              ? "Produk ready stock — tidak masuk laporan penjualan, tapi tetap muncul di Project untuk dikerjakan."
              : "Satu order bisa berisi banyak produk (custom + ready-stock). HPP & profit dihitung otomatis dari total item."}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button onClick={openNew}><Plus className="h-4 w-4 mr-1"/> {isReady ? "Ready Stock Baru" : "Order Baru"}</Button></DialogTrigger>
          <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">

            <DialogHeader className="-m-6 mb-0 p-6 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white rounded-t-lg">
              <DialogTitle className="text-white">{header.id ? "Edit Order" : (isReady ? "Ready Stock Baru" : "Order Baru")}</DialogTitle>
            </DialogHeader>


            {/* HEADER FORM */}
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3 pb-4 border-b">
              <div>
                <Label>Sumber</Label>
                <Select value={header.source} onValueChange={(v) => setHeader((f) => ({ ...f, source: v as Source }))}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={header.status} onValueChange={(v) => setHeader((f) => ({ ...f, status: v as OrderStatus }))}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>No. Order</Label>
                <Input value={header.order_no} onChange={(e) => setHeader((f) => ({ ...f, order_no: e.target.value }))}/>
              </div>
              <div><Label>Tgl CO</Label><Input type="date" value={header.co_date} onChange={(e) => setHeader((f) => ({ ...f, co_date: e.target.value }))}/></div>
              <div><Label>User Pembeli</Label><Input value={header.username} onChange={(e) => setHeader((f) => ({ ...f, username: e.target.value }))}/></div>
              <div><Label>Kota</Label><Input value={header.kota} onChange={(e) => setHeader((f) => ({ ...f, kota: e.target.value }))}/></div>
              <div><Label>Payment (Rp)</Label><Input type="number" value={header.payment} onChange={(e) => setHeader((f) => ({ ...f, payment: e.target.value }))}/></div>
              <div><Label>DP (Rp)</Label><Input type="number" value={header.dp} onChange={(e) => setHeader((f) => ({ ...f, dp: e.target.value }))}/></div>
              <div><Label>Split (Rp)</Label><Input type="number" value={header.split} onChange={(e) => setHeader((f) => ({ ...f, split: e.target.value }))}/></div>
              <div>
                <Label className="flex items-center gap-1"><Truck className="h-3.5 w-3.5"/> No Resi</Label>
                <Input placeholder="Nomor resi pengiriman" value={header.no_resi} onChange={(e) => setHeader((f) => ({ ...f, no_resi: e.target.value }))}/>
              </div>
              <div>
                <Label>Ekspedisi</Label>
                <div className="flex gap-1">
                  <Select value={header.ekspedisi || "__none"} onValueChange={(v) => setHeader((f) => ({ ...f, ekspedisi: v === "__none" ? "" : v }))}>
                    <SelectTrigger><SelectValue placeholder="Pilih ekspedisi"/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— Tidak dipilih —</SelectItem>
                      {carriers.map((c: any) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {(header.source === "direct" || header.source === "lainnya") && (
                    <Button
                      type="button" size="icon" variant="outline" title="Generate No Resi"
                      onClick={() => setHeader((f) => ({ ...f, no_resi: generateResiNumber() }))}
                    >
                      <Wand2 className="h-4 w-4"/>
                    </Button>
                  )}
                  <Button
                    type="button" size="icon" variant="outline" title="Print Resi PDF"
                    disabled={!header.no_resi}
                    onClick={() => printResiPdf({
                      no_resi: header.no_resi,
                      ekspedisi: header.ekspedisi,
                      co_date: header.co_date,
                      kota: header.kota,
                      text_neon: items.map((i) => i.kind === "custom" ? i.text_neon : (i.manual_name || "Ready Stock")).filter(Boolean).join(", "),
                      username: header.username,
                      order_no: header.order_no,
                    })}
                  >
                    <Printer className="h-4 w-4"/>
                  </Button>
                </div>
              </div>
              {header.id && header.no_resi && (
                <div className="sm:col-span-2 md:col-span-3 flex items-center gap-2 flex-wrap">
                  {header.picked_up_at ? (
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">
                      <PackageCheck className="h-3.5 w-3.5 mr-1"/> Sudah diambil kurir · {new Date(header.picked_up_at).toLocaleString("id-ID")}
                    </Badge>
                  ) : header.ready_pickup_at ? (
                    <Badge className="bg-amber-100 text-amber-800 border-amber-300">
                      <Truck className="h-3.5 w-3.5 mr-1"/> Siap pickup · menunggu kurir
                    </Badge>
                  ) : (
                    <Button
                      type="button" size="sm" variant="outline"
                      className="border-amber-400 text-amber-700 hover:bg-amber-50"
                      onClick={() => markPickupMut.mutate(header.id!)}
                      disabled={markPickupMut.isPending}
                    >
                      <Truck className="h-3.5 w-3.5 mr-1"/> Tandai Siap Pickup
                    </Button>
                  )}
                </div>
              )}
              <div className="sm:col-span-2 md:col-span-3"><Label>Catatan Order</Label><Textarea rows={2} value={header.notes} onChange={(e) => setHeader((f) => ({ ...f, notes: e.target.value }))}/></div>
            </div>

            {/* ITEMS SECTION */}
            <div className="pt-2 space-y-3 rounded-lg bg-gradient-to-br from-indigo-50/60 via-white to-emerald-50/50 p-3 border border-indigo-100">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold flex items-center gap-2 text-indigo-900"><Boxes className="h-4 w-4"/> Produk dalam order ({items.filter((i) => !i._deleted).length})</div>
                <Button size="sm" variant="outline" className="border-indigo-300 text-indigo-700 hover:bg-indigo-50" onClick={addNewItem}>
                  <Plus className="h-3.5 w-3.5 mr-1"/> Tambah Produk
                </Button>
              </div>

              {itemsQ.isLoading && header.id ? (
                <div className="text-sm text-muted-foreground">Memuat item…</div>
              ) : items.filter((i) => !i._deleted).length === 0 ? (
                <div className="text-sm text-muted-foreground border rounded-md p-4 text-center bg-white">Belum ada produk. Klik "Tambah Produk".</div>
              ) : (
                items.map((it, idx) => it._deleted ? null : (
                  <ItemCard
                    key={it._key}
                    item={it}
                    index={idx}
                    priceMap={priceMap}
                    rsList={(rsQ.data ?? []) as any[]}
                    excludeRsId={header.id}
                    expanded={expandedItemKey === it._key}
                    onToggleExpand={() => setExpandedItemKey((k) => k === it._key ? null : it._key)}
                    onChange={(patch) => setItems((arr) => arr.map((x, i) => i === idx ? { ...x, ...patch } : x))}
                    onDelete={() => setItems((arr) => {
                      const target = arr[idx];
                      if (target.id) return arr.map((x, i) => i === idx ? { ...x, _deleted: true } : x);
                      return arr.filter((_, i) => i !== idx);
                    })}
                  />
                ))
              )}

              {items.filter((i) => !i._deleted).length > 0 && (
                <div className="flex justify-center pt-1">
                  <Button size="sm" variant="outline" className="border-dashed border-indigo-300 text-indigo-700 hover:bg-indigo-50" onClick={addNewItem}>
                    <Plus className="h-3.5 w-3.5 mr-1"/> Tambah Produk Lagi
                  </Button>
                </div>
              )}
            </div>


            {/* TOTALS */}
            <Card className="bg-muted/40 mt-3">
              <CardContent className="p-3 text-sm grid sm:grid-cols-3 gap-3">
                <div><div className="text-muted-foreground text-xs">Total HPP</div><div className="text-lg font-semibold">Rp {rp(totalItemsHpp)}</div></div>
                <div><div className="text-muted-foreground text-xs">Total Payment (+Split)</div><div className="text-lg font-semibold">Rp {rp(totalPay)}</div></div>
                <div>
                  <div className="text-muted-foreground text-xs">Profit</div>
                  <div className={`text-lg font-semibold ${totalProfit >= 0 ? "text-emerald-600" : "text-destructive"}`}>Rp {rp(totalProfit)}</div>
                </div>
              </CardContent>
            </Card>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="bg-green-500 hover:bg-green-600 text-white">
                {saveMut.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <StatCard label="Total Payment" value={`Rp ${rp(totals.payment)}`} />
        <StatCard label="Total HPP" value={`Rp ${rp(totals.hpp)}`} />
        <StatCard label="Total Profit" value={`Rp ${rp(totals.profit)}`} positive={totals.profit >= 0} />
      </div>

      <Card>
        <CardHeader className="pb-3 px-3 pt-3 sm:p-6">
          <div className="flex items-center gap-2 flex-wrap">
            <Input placeholder="Cari no order / nama / kota / text..." value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />
            <Select value={srcFilter} onValueChange={setSrcFilter}>
              <SelectTrigger className="w-40"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua sumber</SelectItem>
                {SOURCES.map((s) => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground ml-auto">{filtered.length} order</span>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto px-3 pb-3 sm:p-6 sm:pt-0">
          {ordersQ.isLoading ? <div>Memuat...</div> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <SortableHead label="No" col="order_no" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortableHead label="Tgl" col="co_date" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortableHead label="Sumber" col="source" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortableHead label="Status" col="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortableHead label="User / Kota" col="username" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortableHead label="Produk" col="text_neon" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortableHead label="Titik" col="titik" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <SortableHead label="HPP" col="hpp" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <SortableHead label="Payment" col="payment" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <SortableHead label="Profit" col="profit" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((o: any) => {
                  const its = (o.order_items ?? []) as any[];
                  const isExp = !!expanded[o.id];
                  const firstText = its.length ? (its[0].text_neon || its[0].manual_name || "Item") : (o.text_neon || "-");
                  const moreLabel = its.length > 1 ? ` +${its.length - 1} lainnya` : "";
                  return (
                    <React.Fragment key={o.id}>
                      <TableRow className={isExp ? "bg-muted/30" : ""}>
                        <TableCell className="p-1">
                          {its.length > 1 && (
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setExpanded((e) => ({ ...e, [o.id]: !e[o.id] }))}>
                              {isExp ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{o.order_no}</TableCell>
                        <TableCell className="text-xs">{o.co_date ?? "-"}</TableCell>
                        <TableCell><Badge variant="outline">{o.source}</Badge></TableCell>
                        <TableCell>
                          <Badge variant={o.status === "active" ? "default" : o.status === "return" ? "destructive" : "secondary"}>
                            {STATUS_LABEL[(o.status as OrderStatus) ?? "active"] ?? o.status ?? "Aktif"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{o.username ?? "-"}<div className="text-muted-foreground">{o.kota ?? ""}</div></TableCell>
                        <TableCell className="max-w-xs truncate">
                          {firstText}<span className="text-xs text-muted-foreground">{moreLabel}</span>
                        </TableCell>
                        <TableCell className="text-right">{o.titik}</TableCell>
                        <TableCell className="text-right">{rp(Number(o.hpp))}</TableCell>
                        <TableCell className="text-right">{rp(Number(o.payment) + Number(o.split))}</TableCell>
                        <TableCell className={`text-right font-medium ${Number(o.profit) >= 0 ? "text-emerald-600" : "text-destructive"}`}>{rp(Number(o.profit))}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button size="icon" variant="ghost" title="Duplikat" onClick={() => openDuplicate(o)}><Copy className="h-4 w-4"/></Button>
                          <Button size="icon" variant="ghost" onClick={() => openEdit(o)}><Pencil className="h-4 w-4"/></Button>
                          <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Hapus ${o.order_no}?`)) delMut.mutate(o.id); }}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                        </TableCell>
                      </TableRow>
                      {isExp && its.map((it: any, i: number) => (
                        <TableRow key={it.id} className="bg-muted/10">
                          <TableCell></TableCell>
                          <TableCell colSpan={5} className="text-xs pl-8">
                            <span className="text-muted-foreground">#{it.position} · {it.kind === "custom" ? "Custom" : it.kind === "ready_stock_ref" ? "Ready Stock (ref)" : "Ready Stock (manual)"}</span>
                          </TableCell>
                          <TableCell className="text-xs">{it.text_neon || it.manual_name || "-"}</TableCell>
                          <TableCell className="text-right text-xs">{it.titik ?? 0}</TableCell>
                          <TableCell className="text-right text-xs">{rp(Number(it.item_hpp ?? 0))}</TableCell>
                          <TableCell className="text-right text-xs">{it.kind === "ready_stock_manual" ? rp(Number(it.manual_price ?? 0)) : "-"}</TableCell>
                          <TableCell colSpan={2}></TableCell>
                        </TableRow>
                      ))}
                    </React.Fragment>
                  );
                })}
                {filtered.length === 0 && <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">Belum ada order</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// (React imported at top)

// -------- ItemCard --------
function ItemCard({
  item, index, priceMap, rsList, excludeRsId, expanded, onToggleExpand, onChange, onDelete,
}: {
  item: ItemForm;
  index: number;
  priceMap: Record<string, number>;
  rsList: any[];
  excludeRsId?: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onChange: (patch: Partial<ItemForm>) => void;
  onDelete: () => void;
}) {
  const ledMeterNum = num(item.led_meter);
  const suggested = suggestAdaptor(ledMeterNum);
  const variantPrice = priceMap[item.adaptor_type] ?? suggested.defaultPrice;
  const adaptorCost = item.adaptor_manual ? num(item.adaptor) : variantPrice;
  const itemHpp = item.kind === "ready_stock_ref"
    ? Number(rsList.find((r) => r.id === item.source_ready_stock_order_id)?.hpp ?? 0)
    : calcItemHpp(item, priceMap);

  const kindStyle = item.kind === "custom"
    ? { border: "border-l-4 border-l-indigo-500", bg: "bg-indigo-50/60", badge: "bg-indigo-100 text-indigo-800", label: "Custom" }
    : item.kind === "ready_stock_ref"
    ? { border: "border-l-4 border-l-emerald-500", bg: "bg-emerald-50/60", badge: "bg-emerald-100 text-emerald-800", label: "Ready Stock" }
    : { border: "border-l-4 border-l-amber-500", bg: "bg-amber-50/60", badge: "bg-amber-100 text-amber-800", label: "Manual" };

  const titleText = item.kind === "ready_stock_manual"
    ? (item.manual_name || "Ready Stock manual")
    : item.kind === "ready_stock_ref"
    ? (rsList.find((r) => r.id === item.source_ready_stock_order_id)?.text_neon || "Pilih ready stock…")
    : (item.text_neon || "Belum diisi");

  return (
    <Card className={`border-slate-300 ${kindStyle.border} shadow-sm`}>
      <CardHeader
        className={`p-3 pb-2 flex-row items-center justify-between space-y-0 cursor-pointer ${kindStyle.bg} rounded-t-lg`}
        onClick={onToggleExpand}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button type="button" className="shrink-0" onClick={(e) => { e.stopPropagation(); onToggleExpand(); }} aria-label={expanded ? "Tutup" : "Buka"}>
            {expanded ? <ChevronDown className="h-4 w-4 text-slate-600"/> : <ChevronRight className="h-4 w-4 text-slate-600"/>}
          </button>
          <Badge className={`${kindStyle.badge} border-0`}>#{item.position}</Badge>
          <span className={`text-xs px-2 py-0.5 rounded-full ${kindStyle.badge}`}>{kindStyle.label}</span>
          <span className="font-medium text-sm truncate" title={titleText}>{titleText}</span>
          <span className="text-xs text-muted-foreground shrink-0 ml-auto pr-2">HPP: <span className="font-semibold text-foreground">Rp {rp(itemHpp)}</span></span>
        </div>
        <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); onDelete(); }}><Trash2 className="h-4 w-4 text-destructive"/></Button>
      </CardHeader>
      {expanded && (
      <CardContent className="p-3 pt-2">
        <div className="mb-2">
          <Label className="text-xs">Jenis Produk</Label>
          <Select value={item.kind} onValueChange={(v) => onChange({ kind: v as ItemKind })}>
            <SelectTrigger className="h-8 w-full sm:w-64"><SelectValue/></SelectTrigger>
            <SelectContent>
              <SelectItem value="custom">Custom (Neon Sign)</SelectItem>
              <SelectItem value="ready_stock_ref">Ready Stock (pilih existing)</SelectItem>
              <SelectItem value="ready_stock_manual">Ready Stock / Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {item.kind === "custom" && (
          <div className="grid sm:grid-cols-2 gap-2">
            <div className="sm:col-span-2"><Label>TEXT Neon *</Label><Input value={item.text_neon} onChange={(e) => onChange({ text_neon: e.target.value })}/></div>
            <div><Label>Akrilik P (cm)</Label><Input type="number" value={item.akrilik_p} onChange={(e) => onChange({ akrilik_p: e.target.value })}/></div>
            <div><Label>Akrilik L (cm)</Label><Input type="number" value={item.akrilik_l} onChange={(e) => onChange({ akrilik_l: e.target.value })}/></div>
            <div><Label>LED (meter)</Label><Input type="number" step="0.1" value={item.led_meter} onChange={(e) => onChange({ led_meter: e.target.value })}/></div>
            <div><Label>Titik</Label><Input type="number" value={item.titik} onChange={(e) => onChange({ titik: e.target.value })}/></div>
            <div><Label>Kabel (m) — kosongkan auto</Label><Input type="number" step="0.1" value={item.kabel_meter} onChange={(e) => onChange({ kabel_meter: e.target.value })}/></div>
            <div><Label>Kabel Socket (m)</Label><Input type="number" step="0.1" value={item.kabel_socket_meter} onChange={(e) => onChange({ kabel_socket_meter: e.target.value })}/></div>
            <div className="sm:col-span-2 rounded-lg border bg-slate-50/60 p-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-semibold">Adaptor</Label>
                <span className="text-xs text-muted-foreground">LED {ledMeterNum || 0}m → saran <b>{suggested.label}</b></span>
              </div>
              <Select value={item.adaptor_type} onValueChange={(v) => onChange({ adaptor_type: v, adaptor_manual: false })}>
                <SelectTrigger className="h-8"><SelectValue/></SelectTrigger>
                <SelectContent>
                  {ADAPTOR_VARIANTS.map((a) => {
                    const price = priceMap[a.key] ?? a.defaultPrice;
                    return <SelectItem key={a.key} value={a.key}>{a.label} (≤{a.maxLed}m) — Rp {rp(price)}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Checkbox id={`am-${item._key}`} checked={item.adaptor_manual} onCheckedChange={(v) => {
                  const c = !!v;
                  onChange({ adaptor_manual: c, adaptor: c ? String(variantPrice) : "" });
                }}/>
                <Label htmlFor={`am-${item._key}`} className="cursor-pointer text-xs">Override manual (Rp {rp(adaptorCost)})</Label>
              </div>
              {item.adaptor_manual && <Input type="number" value={item.adaptor} onChange={(e) => onChange({ adaptor: e.target.value })}/>}
            </div>
            <div><Label>Modul</Label><Input type="number" value={item.modul} onChange={(e) => onChange({ modul: e.target.value })}/></div>
            <div><Label>Socket DC</Label><Input type="number" value={item.socket_dc} onChange={(e) => onChange({ socket_dc: e.target.value })}/></div>
            <div><Label>Baut Fischer</Label><Input type="number" value={item.baut_fischer} onChange={(e) => onChange({ baut_fischer: e.target.value })}/></div>
            <div className="sm:col-span-2 flex items-center gap-2">
              <Checkbox id={`od-${item._key}`} checked={item.use_outdoor} onCheckedChange={(v) => {
                const c = !!v;
                onChange({ use_outdoor: c, outdoor_cost: c ? String(num(item.titik) * 2000 || 0) : "" });
              }}/>
              <Label htmlFor={`od-${item._key}`} className="cursor-pointer text-sm">Outdoor <span className="text-xs text-muted-foreground">— auto titik × 2.000</span></Label>
            </div>
            {item.use_outdoor && (
              <div><Label>Biaya Outdoor (Rp)</Label><Input type="number" value={item.outdoor_cost} onChange={(e) => onChange({ outdoor_cost: e.target.value })}/></div>
            )}
            <div className="sm:col-span-2"><Label>Catatan item</Label><Textarea rows={1} value={item.notes} onChange={(e) => onChange({ notes: e.target.value })}/></div>
          </div>
        )}

        {item.kind === "ready_stock_ref" && (
          <div className="space-y-2">
            <Label>Pilih Ready Stock</Label>
            <Select value={item.source_ready_stock_order_id} onValueChange={(v) => onChange({ source_ready_stock_order_id: v })}>
              <SelectTrigger><SelectValue placeholder="Pilih produk ready stock..."/></SelectTrigger>
              <SelectContent>
                {rsList.filter((r) => r.id !== excludeRsId).map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    <Package className="h-3 w-3 inline mr-1"/> {r.order_no} — {r.text_neon || "(tanpa nama)"} · HPP Rp {rp(Number(r.hpp))}
                  </SelectItem>
                ))}
                {rsList.length === 0 && <div className="p-2 text-xs text-muted-foreground">Belum ada ready-stock tersedia.</div>}
              </SelectContent>
            </Select>
            <div><Label>Catatan item</Label><Textarea rows={1} value={item.notes} onChange={(e) => onChange({ notes: e.target.value })}/></div>
          </div>
        )}

        {item.kind === "ready_stock_manual" && (
          <div className="grid sm:grid-cols-3 gap-2">
            <div className="sm:col-span-3"><Label>Nama Produk *</Label><Input value={item.manual_name} onChange={(e) => onChange({ manual_name: e.target.value })}/></div>
            <div><Label>Harga Jual (Rp)</Label><Input type="number" value={item.manual_price} onChange={(e) => onChange({ manual_price: e.target.value })}/></div>
            <div><Label>HPP (Rp)</Label><Input type="number" value={item.manual_hpp} onChange={(e) => onChange({ manual_hpp: e.target.value })}/></div>
            <div className="sm:col-span-3"><Label>Catatan item</Label><Textarea rows={1} value={item.notes} onChange={(e) => onChange({ notes: e.target.value })}/></div>
          </div>
        )}
      </CardContent>
      )}
    </Card>

  );
}

function StatCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <Card><CardContent className="pt-4 px-3 pb-3 sm:pt-6 sm:px-6 sm:pb-6">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${positive === false ? "text-destructive" : positive ? "text-emerald-600" : ""}`}>{value}</div>
    </CardContent></Card>
  );
}

function SortableHead({
  label, col, sortKey, sortDir, onClick, align,
}: {
  label: string; col: string; sortKey: string; sortDir: "asc" | "desc";
  onClick: (k: any) => void; align?: "right";
}) {
  const active = sortKey === col;
  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button type="button" onClick={() => onClick(col)}
        className={`inline-flex items-center gap-1 select-none hover:text-foreground transition-colors ${active ? "text-foreground font-semibold" : ""} ${align === "right" ? "flex-row-reverse" : ""}`}>
        <span>{label}</span>
        <Icon className={`h-3 w-3 ${active ? "opacity-100" : "opacity-40"}`} />
      </button>
    </TableHead>
  );
}
