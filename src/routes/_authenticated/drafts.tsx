import { createFileRoute } from "@tanstack/react-router";
import { OrdersPage } from "./orders";

export const Route = createFileRoute("/_authenticated/drafts")({
  component: () => <OrdersPage mode="draft" />,
  head: () => ({ meta: [{ title: "Draft Order" }] }),
});
