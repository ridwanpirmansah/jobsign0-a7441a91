import { createFileRoute } from "@tanstack/react-router";
import { OrdersPage } from "./orders";

export const Route = createFileRoute("/_authenticated/ready-stock")({
  component: () => <OrdersPage mode="ready_stock" />,
  head: () => ({ meta: [
    { title: "Ready Stock Neon Sign | Neon Workflow" },
    { name: "description", content: "Kelola stok neon sign tersedia dan cari produk berdasarkan pesanan atau resi." },
    { property: "og:title", content: "Ready Stock Neon Sign | Neon Workflow" },
    { property: "og:description", content: "Kelola stok neon sign tersedia dan cari produk berdasarkan pesanan atau resi." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
});
