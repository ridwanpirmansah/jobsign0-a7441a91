import { createFileRoute } from "@tanstack/react-router";
import { OrdersPage } from "./orders";

export const Route = createFileRoute("/_authenticated/ready-stock")({
  component: () => <OrdersPage mode="ready_stock" />,
  head: () => ({ meta: [{ title: "Ready Stock" }] }),
});
