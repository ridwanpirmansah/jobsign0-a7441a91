import { createFileRoute } from "@tanstack/react-router";
import { OrdersPage } from "./orders";

export const Route = createFileRoute("/_authenticated/drafts")({
  component: () => <OrdersPage mode="draft" />,
  head: () => ({ meta: [
    { title: "Draft Pesanan Neon Sign | Neon Workflow" },
    { name: "description", content: "Kelola draft pesanan neon sign sebelum diaktifkan." },
    { property: "og:title", content: "Draft Pesanan Neon Sign | Neon Workflow" },
    { property: "og:description", content: "Kelola draft pesanan neon sign sebelum diaktifkan." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
});
