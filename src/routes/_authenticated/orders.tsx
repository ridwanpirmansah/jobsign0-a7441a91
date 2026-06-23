import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listOrders, listPrices, upsertOrder, deleteOrder } from "@/lib/orders.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { ShoppingBag, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/orders")({
  component: OrdersPage,
  head: () => ({ meta: [{ title: "Daftar Order Neon Sign" }] }),
});

const SOURCES = ["shopee", "tiktok", "tokopedia", "lazada", "direct", "lainnya"] as const;
type Source = (typeof SOURCES)[number];

const STATUSES = ["active", "return", "draft"] as const;
type OrderStatus = (typeof STATUSES)[number];
const STATUS_LABEL: Record<OrderStatus, string> = { active: "Aktif", return: "Retur", draft: "Draft" };

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

type FormState = {
  id?: string;
  source: Source;
  status: OrderStatus;
  order_no: string;
  co_date: string;
  username: string;
  kota: string;
  text_neon: string;
  akrilik_p: string;
  akrilik_l: string;
  led_meter: string;
  titik: string;
  kabel_meter: string;
  kabel_socket_meter: string;
  payment: string;
  dp: string;
  split: string;
  adaptor: string;
  adaptor_type: string; // variant key, or "manual"
  adaptor_manual: boolean;
  modul: string;
  print_cost: string;
  karet_seal: string;
  socket_dc: string;
  baut_fischer: string;
  use_outdoor: boolean;
  outdoor_cost: string;
  notes: string;
};

function emptyForm(defaults: Record<string, number>, nextOrderNo: string = ""): FormState {
  return {
    source: "shopee",
    status: "active",
    order_no: nextOrderNo,
    co_date: new Date().toISOString().slice(0, 10),
    username: "",
    kota: "",
    text_neon: "",
    akrilik_p: "",
    akrilik_l: "",
    led_meter: "",
    titik: "",
    kabel_meter: "",
    kabel_socket_meter: "1",
    payment: "",
    dp: "",
    split: "",
    adaptor: "",
    adaptor_type: "adaptor_2a",
    adaptor_manual: false,
    modul: String(defaults.modul_default ?? 0),
    print_cost: String(defaults.print_default ?? 0),
    karet_seal: String(defaults.karet_seal_default ?? 0),
    socket_dc: String(defaults.socket_dc_default ?? 0),
    baut_fischer: String(defaults.baut_fischer_default ?? 0),
    use_outdoor: false,
    outdoor_cost: "",
    notes: "",
  };
}

function toForm(o: any): FormState {
  return {
    id: o.id,
    source: o.source,
    status: (o.status as OrderStatus) ?? "active",
    order_no: o.order_no,
    co_date: o.co_date ?? "",
    username: o.username ?? "",
    kota: o.kota ?? "",
    text_neon: o.text_neon ?? "",
    akrilik_p: String(o.akrilik_p ?? ""),
    akrilik_l: String(o.akrilik_l ?? ""),
    led_meter: String(o.led_meter ?? ""),
    titik: String(o.titik ?? ""),
    kabel_meter: String(o.kabel_meter ?? ""),
    kabel_socket_meter: String(o.kabel_socket_meter ?? 1),
    payment: String(o.payment ?? ""),
    dp: String(o.dp ?? ""),
    split: String(o.split ?? ""),
    adaptor: String(o.adaptor ?? 0),
    adaptor_type: o.adaptor_type ?? "adaptor_2a",
    adaptor_manual: !!o.adaptor && !!o.adaptor_type ? false : false,
    modul: String(o.modul ?? 0),
    print_cost: String(o.print_cost ?? 0),
    karet_seal: String(o.karet_seal ?? 0),
    socket_dc: String(o.socket_dc ?? 0),
    baut_fischer: String(o.baut_fischer ?? 0),
    use_outdoor: false,
    outdoor_cost: String(o.outdoor_cost ?? ""),
    notes: o.notes ?? "",
  };
}

function OrdersPage() {
  const fetchOrders = useServerFn(listOrders);
  const fetchPrices = useServerFn(listPrices);
  const saveOrder = useServerFn(upsertOrder);
  const delOrder = useServerFn(deleteOrder);
  const qc = useQueryClient();

  const ordersQ = useQuery({ queryKey: ["orders"], queryFn: () => fetchOrders() });
  const pricesQ = useQuery({ queryKey: ["material_prices"], queryFn: () => fetchPrices() });

  const priceMap = useMemo(() => {
    const m: Record<string, number> = {};
    (pricesQ.data ?? []).forEach((p: any) => { m[p.key] = Number(p.value); });
    return m;
  }, [pricesQ.data]);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [srcFilter, setSrcFilter] = useState<string>("all");
  const [form, setForm] = useState<FormState>(emptyForm({}));

  const nextOrderNo = useMemo(() => {
    const list = ordersQ.data ?? [];
    let max = 0;
    for (const o of list) {
      const m = String(o.order_no ?? "").match(/(\d+)/g);
      if (m) {
        const n = parseInt(m[m.length - 1], 10);
        if (!isNaN(n) && n > max) max = n;
      }
    }
    return String(max + 1);
  }, [ordersQ.data]);

  const openNew = () => { setForm(emptyForm(priceMap, nextOrderNo)); setOpen(true); };
  const openEdit = (o: any) => { setForm(toForm(o)); setOpen(true); };

  const num = (s: string) => { const n = parseFloat(s); return isNaN(n) ? 0 : n; };

  // Auto-suggested adaptor variant based on LED length
  const ledMeterNum = num(form.led_meter);
  const suggestedVariant = useMemo(() => suggestAdaptor(ledMeterNum), [ledMeterNum]);

  // Resolve adaptor cost: manual override > variant from price map > variant default
  const adaptorVariantKey = form.adaptor_type || suggestedVariant.key;
  const adaptorVariantPrice = useMemo(() => {
    const v = ADAPTOR_VARIANTS.find((a) => a.key === adaptorVariantKey) ?? suggestedVariant;
    return priceMap[v.key] ?? v.defaultPrice;
  }, [adaptorVariantKey, priceMap, suggestedVariant]);
  const adaptorCost = form.adaptor_manual ? num(form.adaptor) : adaptorVariantPrice;

  // Live calculation preview (mirror DB trigger)
  const calc = useMemo(() => {
    const led_meter = num(form.led_meter);
    const titik = num(form.titik);
    const p = num(form.akrilik_p);
    const l = num(form.akrilik_l);
    const kabel_meter = num(form.kabel_meter) || (((led_meter / 4) * 3) + 1.5 + ((titik * 5) / 100));
    const kabel_socket_meter = form.kabel_socket_meter === "" ? 1 : num(form.kabel_socket_meter);
    const outdoor_cost = form.use_outdoor ? (num(form.outdoor_cost) || titik * 2000) : 0;
    const led_cost = led_meter * (priceMap.led_per_meter ?? 0);
    const akrilik_cost = p * l * (priceMap.akrilik_per_cm2 ?? 0);
    const solder_cost = titik * (priceMap.solder_per_titik ?? 0);
    const tempel_cost = titik * (priceMap.tempel_per_titik ?? 0);
    const kabel_cost = kabel_meter * (priceMap.kabel_per_meter ?? 0);
    const kabel_socket_cost = kabel_socket_meter * (priceMap.kabel_socket_per_meter ?? 2500);
    const hpp = led_cost + akrilik_cost + solder_cost + tempel_cost + kabel_cost + kabel_socket_cost +
      adaptorCost + num(form.modul) + num(form.socket_dc) + num(form.baut_fischer) + outdoor_cost;
    const totalPay = num(form.payment) + num(form.split);
    const profit = totalPay - hpp;
    const profit_pct = totalPay > 0 ? (profit / totalPay) * 100 : 0;
    const sisa = totalPay - num(form.dp);
    const rec_min = Math.round(hpp * 1.8);
    const rec_max = Math.round(hpp * 2);
    const marketplacePct = Number(priceMap.marketplace_markup_pct ?? 22);
    const rec_marketplace = Math.round(hpp * (1 + marketplacePct / 100));
    return { kabel_meter, kabel_socket_meter, outdoor_cost, led_cost, akrilik_cost, solder_cost, tempel_cost, kabel_cost, kabel_socket_cost, adaptor_cost: adaptorCost, hpp, profit, profit_pct, sisa, rec_min, rec_max, rec_marketplace, marketplacePct, totalPay };
  }, [form, priceMap, adaptorCost]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form.order_no.trim() || !form.text_neon.trim()) throw new Error("No. Order dan TEXT wajib diisi");
      return saveOrder({
        data: {
          id: form.id,
          source: form.source,
          order_no: form.order_no.trim(),
          co_date: form.co_date || null,
          username: form.username || null,
          kota: form.kota || null,
          text_neon: form.text_neon.trim(),
          akrilik_p: num(form.akrilik_p),
          akrilik_l: num(form.akrilik_l),
          led_meter: num(form.led_meter),
          titik: Math.floor(num(form.titik)),
          kabel_meter: num(form.kabel_meter),
          kabel_socket_meter: form.kabel_socket_meter === "" ? 1 : num(form.kabel_socket_meter),
          payment: num(form.payment),
          dp: num(form.dp),
          split: num(form.split),
          adaptor: num(form.adaptor),
          modul: num(form.modul),
          print_cost: num(form.print_cost),
          karet_seal: num(form.karet_seal),
          socket_dc: num(form.socket_dc),
          baut_fischer: num(form.baut_fischer),
          outdoor_cost: form.use_outdoor ? num(form.outdoor_cost) : 0,
          notes: form.notes || null,
        },
      });
    },
    onSuccess: () => {
      toast.success(form.id ? "Order diperbarui" : "Order ditambahkan");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["orders"] });
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
    return list.filter((o: any) => {
      if (srcFilter !== "all" && o.source !== srcFilter) return false;
      if (!filter.trim()) return true;
      const q = filter.toLowerCase();
      return [o.order_no, o.username, o.kota, o.text_neon].some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  }, [ordersQ.data, filter, srcFilter]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc: any, o: any) => {
        acc.payment += Number(o.payment || 0);
        acc.hpp += Number(o.hpp || 0);
        acc.profit += Number(o.profit || 0);
        return acc;
      }, { payment: 0, hpp: 0, profit: 0 },
    );
  }, [filtered]);

  return (
    <div className="p-2 sm:p-4 space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShoppingBag className="h-6 w-6"/> Order Neon Sign</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Input pesanan custom. HPP & profit dihitung otomatis. Setiap order otomatis membuat Project.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button onClick={openNew}><Plus className="h-4 w-4 mr-1"/> Order Baru</Button></DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{form.id ? "Edit Order" : "Order Baru"}</DialogTitle></DialogHeader>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="md:col-span-2 grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>Sumber</Label>
                  <Select value={form.source} onValueChange={(v) => setForm((f) => ({ ...f, source: v as Source }))}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                      {SOURCES.map((s) => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>No. Order * <span className="text-xs text-muted-foreground">— otomatis, bisa diubah</span></Label>
                  <Input value={form.order_no} onChange={(e) => setForm((f) => ({ ...f, order_no: e.target.value }))}/>
                </div>
                <div><Label>Tgl CO</Label><Input type="date" value={form.co_date} onChange={(e) => setForm((f) => ({ ...f, co_date: e.target.value }))}/></div>
                <div><Label>User Pembeli</Label><Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}/></div>
                <div><Label>Kota</Label><Input value={form.kota} onChange={(e) => setForm((f) => ({ ...f, kota: e.target.value }))}/></div>
                <div className="sm:col-span-2"><Label>TEXT Neon *</Label><Input value={form.text_neon} onChange={(e) => setForm((f) => ({ ...f, text_neon: e.target.value }))}/></div>

                <div><Label>Akrilik P (cm)</Label><Input type="number" value={form.akrilik_p} onChange={(e) => setForm((f) => ({ ...f, akrilik_p: e.target.value }))}/></div>
                <div><Label>Akrilik L (cm)</Label><Input type="number" value={form.akrilik_l} onChange={(e) => setForm((f) => ({ ...f, akrilik_l: e.target.value }))}/></div>
                <div><Label>LED (meter)</Label><Input type="number" step="0.1" value={form.led_meter} onChange={(e) => setForm((f) => ({ ...f, led_meter: e.target.value }))}/></div>
                <div><Label>Titik</Label><Input type="number" value={form.titik} onChange={(e) => setForm((f) => ({ ...f, titik: e.target.value }))}/></div>
                <div>
                  <Label>Kabel (meter) <span className="text-xs text-muted-foreground">— kosongkan utk auto</span></Label>
                  <Input type="number" step="0.1" value={form.kabel_meter} placeholder={calc.kabel_meter.toFixed(2)} onChange={(e) => setForm((f) => ({ ...f, kabel_meter: e.target.value }))}/>
                </div>
                <div>
                  <Label>Kabel Socket (meter) <span className="text-xs text-muted-foreground">— default 1m × Rp {rp(priceMap.kabel_socket_per_meter ?? 2500)}</span></Label>
                  <Input type="number" step="0.1" value={form.kabel_socket_meter} onChange={(e) => setForm((f) => ({ ...f, kabel_socket_meter: e.target.value }))}/>
                </div>
                <div>
                  <Label>Payment (Rp) {calc.hpp > 0 && (
                    <span className="text-xs text-emerald-600">— rekomendasi Rp {rp(calc.rec_min)} – Rp {rp(calc.rec_max)}</span>
                  )}</Label>
                  <Input type="number" value={form.payment} placeholder={calc.hpp > 0 ? String(calc.rec_max) : ""} onChange={(e) => setForm((f) => ({ ...f, payment: e.target.value }))}/>
                </div>
                <div>
                  <Label>DP (Rp)</Label>
                  <Input type="number" value={form.dp} onChange={(e) => setForm((f) => ({ ...f, dp: e.target.value }))}/>
                  {(num(form.payment) + num(form.split)) > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">Sisa pembayaran: <span className="font-semibold text-foreground">Rp {rp(calc.sisa)}</span></div>
                  )}
                </div>
                <div><Label>Split (Rp)</Label><Input type="number" value={form.split} onChange={(e) => setForm((f) => ({ ...f, split: e.target.value }))}/></div>

                <div className="sm:col-span-2 pt-2 border-t mt-2"><div className="text-sm font-semibold">Bahan tambahan (Rp)</div></div>
                <div><Label>Adaptor</Label><Input type="number" value={form.adaptor} onChange={(e) => setForm((f) => ({ ...f, adaptor: e.target.value }))}/></div>
                <div><Label>Modul</Label><Input type="number" value={form.modul} onChange={(e) => setForm((f) => ({ ...f, modul: e.target.value }))}/></div>
                <div><Label>Socket DC</Label><Input type="number" value={form.socket_dc} onChange={(e) => setForm((f) => ({ ...f, socket_dc: e.target.value }))}/></div>
                <div><Label>Baut Fischer</Label><Input type="number" value={form.baut_fischer} onChange={(e) => setForm((f) => ({ ...f, baut_fischer: e.target.value }))}/></div>
                <div className="sm:col-span-2 flex items-center gap-2">
                  <Checkbox id="outdoor" checked={form.use_outdoor} onCheckedChange={(checked) => {
                    const isChecked = !!checked;
                    setForm(f => ({
                      ...f,
                      use_outdoor: isChecked,
                      outdoor_cost: isChecked ? String((num(f.titik) * 2000) || 0) : ""
                    }));
                  }}/>
                  <Label htmlFor="outdoor" className="cursor-pointer">Outdoor <span className="text-xs text-muted-foreground">— auto titik × 2.000</span></Label>
                </div>
                {form.use_outdoor && (
                  <div>
                    <Label>Biaya Outdoor (Rp)</Label>
                    <Input type="number" value={form.outdoor_cost} placeholder={String((num(form.titik) * 2000) || 0)} onChange={(e) => setForm((f) => ({ ...f, outdoor_cost: e.target.value }))}/>
                  </div>
                )}
                <div className="sm:col-span-2"><Label>Catatan</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}/></div>
              </div>
              <Card className="bg-muted/40 h-fit sticky top-0">
                <CardHeader className="pb-2"><CardTitle className="text-base">Kalkulasi Live</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-1">
                  <Row k="Kabel (m)" v={calc.kabel_meter.toFixed(2)}/>
                  <Row k="LED" v={`Rp ${rp(calc.led_cost)}`}/>
                  <Row k="Akrilik" v={`Rp ${rp(calc.akrilik_cost)}`}/>
                  <Row k="Solder" v={`Rp ${rp(calc.solder_cost)}`}/>
                  <Row k="Tempel" v={`Rp ${rp(calc.tempel_cost)}`}/>
                  <Row k="Kabel" v={`Rp ${rp(calc.kabel_cost)}`}/>
                  <Row k="Kabel Socket" v={`Rp ${rp(calc.kabel_socket_cost)}`}/>
                  <Row k="Outdoor" v={`Rp ${rp(calc.outdoor_cost)}`}/>
                  <div className="border-t my-2"/>
                  <Row k="HPP" v={`Rp ${rp(calc.hpp)}`} bold/>
                  <Row k="Payment" v={`Rp ${rp(calc.totalPay)}`}/>
                  <Row k="DP" v={`Rp ${rp(num(form.dp))}`}/>
                  <Row k="Sisa Bayar" v={`Rp ${rp(calc.sisa)}`}/>
                  <Row k="Profit" v={`Rp ${rp(calc.profit)}`} bold positive={calc.profit >= 0}/>
                  <Row k="Profit %" v={`${calc.profit_pct.toFixed(1)}%`} bold positive={calc.profit_pct >= 0}/>
                </CardContent>
              </Card>
            </div>
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
                  <TableHead>No</TableHead>
                  <TableHead>Tgl</TableHead>
                  <TableHead>Sumber</TableHead>
                  <TableHead>User / Kota</TableHead>
                  <TableHead>Text</TableHead>
                  <TableHead className="text-right">Titik</TableHead>
                  <TableHead className="text-right">HPP</TableHead>
                  <TableHead className="text-right">Payment</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((o: any) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{o.order_no}</TableCell>
                    <TableCell className="text-xs">{o.co_date ?? "-"}</TableCell>
                    <TableCell><Badge variant="outline">{o.source}</Badge></TableCell>
                    <TableCell className="text-xs">{o.username ?? "-"}<div className="text-muted-foreground">{o.kota ?? ""}</div></TableCell>
                    <TableCell className="max-w-xs truncate">{o.text_neon}</TableCell>
                    <TableCell className="text-right">{o.titik}</TableCell>
                    <TableCell className="text-right">{rp(Number(o.hpp))}</TableCell>
                    <TableCell className="text-right">{rp(Number(o.payment) + Number(o.split))}</TableCell>
                    <TableCell className={`text-right font-medium ${Number(o.profit) >= 0 ? "text-emerald-600" : "text-destructive"}`}>{rp(Number(o.profit))}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(o)}><Pencil className="h-4 w-4"/></Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Hapus order ${o.order_no}?`)) delMut.mutate(o.id); }}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Belum ada order</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ k, v, bold, positive }: { k: string; v: string; bold?: boolean; positive?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""} ${positive === false ? "text-destructive" : positive ? "text-emerald-600" : ""}`}>
      <span className="text-muted-foreground">{k}</span><span>{v}</span>
    </div>
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
