import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ShoppingCart, Plus, Check, Trash2, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/shopping-notes")({
  component: ShoppingNotesPage,
  head: () => ({
    meta: [
      { title: "Catatan Belanja — Neon Workflow" },
      { name: "description", content: "Catat kebutuhan bahan produksi yang harus segera dibeli." },
    ],
  }),
});

type Note = {
  id: string;
  item_name: string;
  qty: string | null;
  note: string | null;
  urgency: "normal" | "urgent";
  status: "pending" | "purchased";
  created_by: string | null;
  purchased_by: string | null;
  purchased_at: string | null;
  created_at: string;
};

function ShoppingNotesPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"pending" | "purchased">("pending");
  const [form, setForm] = useState({ item_name: "", qty: "", note: "", urgency: "normal" as "normal" | "urgent" });

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["shopping-notes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shopping_notes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Note[];
    },
  });

  const { data: creators = {} } = useQuery({
    queryKey: ["shopping-notes-creators", notes.map((n) => n.created_by).join(",")],
    enabled: notes.length > 0,
    queryFn: async () => {
      const ids = Array.from(new Set(notes.map((n) => n.created_by).filter(Boolean))) as string[];
      if (!ids.length) return {} as Record<string, string>;
      const { data } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      const map: Record<string, string> = {};
      (data ?? []).forEach((p: any) => { map[p.id] = p.full_name; });
      return map;
    },
  });

  const addMut = useMutation({
    mutationFn: async () => {
      if (!form.item_name.trim()) throw new Error("Nama barang wajib diisi");
      const { error } = await supabase.from("shopping_notes").insert({
        item_name: form.item_name.trim(),
        qty: form.qty.trim() || null,
        note: form.note.trim() || null,
        urgency: form.urgency,
        created_by: me?.profile?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Catatan ditambahkan");
      setForm({ item_name: "", qty: "", note: "", urgency: "normal" });
      qc.invalidateQueries({ queryKey: ["shopping-notes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "pending" | "purchased" }) => {
      const payload: any = { status };
      if (status === "purchased") {
        payload.purchased_by = me?.profile?.id;
        payload.purchased_at = new Date().toISOString();
      } else {
        payload.purchased_by = null;
        payload.purchased_at = null;
      }
      const { error } = await supabase.from("shopping_notes").update(payload).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shopping-notes"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shopping_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Catatan dihapus");
      qc.invalidateQueries({ queryKey: ["shopping-notes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isAdmin = me?.role === "owner" || me?.role === "admin";
  const canDelete = (n: Note) => isAdmin || n.created_by === me?.profile?.id;

  const filtered = notes.filter((n) => n.status === tab);
  const pendingCount = notes.filter((n) => n.status === "pending").length;
  const urgentCount = notes.filter((n) => n.status === "pending" && n.urgency === "urgent").length;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center text-white shadow">
          <ShoppingCart className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold">Catatan Belanja</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Catat kebutuhan bahan/stok produksi. Owner dapat melihat semua permintaan agar bisa segera dibelanjakan.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Menunggu Dibeli</div>
            <div className="text-2xl font-bold text-amber-600">{pendingCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Urgent</div>
            <div className="text-2xl font-bold text-rose-600">{urgentCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4" /> Tambah Catatan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Nama Barang *</Label>
              <Input
                placeholder="cth: Adaptor 12V 5A"
                value={form.item_name}
                onChange={(e) => setForm({ ...form, item_name: e.target.value })}
              />
            </div>
            <div>
              <Label>Jumlah / Satuan</Label>
              <Input
                placeholder="cth: 10 pcs, 2 roll"
                value={form.qty}
                onChange={(e) => setForm({ ...form, qty: e.target.value })}
              />
            </div>
            <div>
              <Label>Prioritas</Label>
              <Select value={form.urgency} onValueChange={(v) => setForm({ ...form, urgency: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="urgent">Urgent (Stok Habis)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Catatan (opsional)</Label>
              <Textarea
                placeholder="Spesifikasi, merek, warna, atau info lain"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                rows={2}
              />
            </div>
          </div>
          <Button className="w-full" disabled={addMut.isPending || !form.item_name.trim()} onClick={() => addMut.mutate()}>
            <Plus className="h-4 w-4 mr-2" /> Tambah ke Daftar
          </Button>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="pending">Perlu Dibeli ({pendingCount})</TabsTrigger>
          <TabsTrigger value="purchased">Sudah Dibeli</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-3 space-y-2">
          {isLoading && <div className="text-sm text-muted-foreground p-4 text-center">Memuat...</div>}
          {!isLoading && filtered.length === 0 && (
            <div className="text-sm text-muted-foreground p-6 text-center border border-dashed rounded-lg">
              {tab === "pending" ? "Belum ada permintaan belanja. Tambahkan di atas." : "Belum ada catatan yang ditandai sudah dibeli."}
            </div>
          )}
          {filtered.map((n) => (
            <Card
              key={n.id}
              className={
                n.urgency === "urgent" && n.status === "pending"
                  ? "border-rose-300 bg-rose-50/40"
                  : n.status === "purchased"
                  ? "opacity-75"
                  : ""
              }
            >
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{n.item_name}</span>
                      {n.qty && (
                        <Badge variant="secondary" className="font-mono text-[10px]">{n.qty}</Badge>
                      )}
                      {n.urgency === "urgent" && n.status === "pending" && (
                        <Badge className="bg-rose-600 hover:bg-rose-700">
                          <AlertTriangle className="h-3 w-3 mr-1" /> Urgent
                        </Badge>
                      )}
                      {n.status === "purchased" && (
                        <Badge className="bg-emerald-600 hover:bg-emerald-700">
                          <Check className="h-3 w-3 mr-1" /> Sudah dibeli
                        </Badge>
                      )}
                    </div>
                    {n.note && <div className="text-xs text-slate-600 mt-1 whitespace-pre-wrap">{n.note}</div>}
                    <div className="text-[11px] text-muted-foreground mt-1.5">
                      Dicatat oleh {creators[n.created_by ?? ""] ?? "—"} · {new Date(n.created_at).toLocaleString("id-ID")}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {n.status === "pending" ? (
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 h-8"
                        onClick={() => markMut.mutate({ id: n.id, status: "purchased" })}
                        disabled={markMut.isPending}
                      >
                        <Check className="h-3.5 w-3.5 mr-1" /> Dibeli
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => markMut.mutate({ id: n.id, status: "pending" })}
                        disabled={markMut.isPending}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Kembalikan
                      </Button>
                    )}
                    {canDelete(n) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                        onClick={() => {
                          if (confirm("Hapus catatan ini?")) delMut.mutate(n.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
