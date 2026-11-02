import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { matchesOrderSearch, resolveShopeeImportTarget } from "./order-identity";

describe("Shopee import target", () => {
  test("RS-85 is not an imported active order", () => {
    assert.equal(resolveShopeeImportTarget({ id: "stock", order_no: "RS-85", status: "ready_stock", consumed_at: null }), null);
  });
  test("a consumed source does not update a different buyer's order", () => {
    assert.equal(resolveShopeeImportTarget({ id: "stock", order_no: "RS-85", status: "ready_stock", consumed_at: "2026-10-31" }), null);
  });
  test("drafts must not be shown as imported active orders", () => {
    assert.equal(resolveShopeeImportTarget({ id: "draft", order_no: "DR-137", status: "draft", consumed_at: null }), null);
  });
  test("an active numeric order remains the update target", () => {
    const order = { id: "sale", order_no: "733", status: "active", consumed_at: null };
    assert.equal(resolveShopeeImportTarget(order)?.id, "sale");
  });
  test("a deleted target is reimportable", () => {
    assert.equal(resolveShopeeImportTarget(null), null);
  });
  test("a stock code is rejected even if its status is inconsistent", () => {
    assert.equal(resolveShopeeImportTarget({ id: "stock", order_no: "RS-85", status: "active", consumed_at: null }), null);
  });
});

describe("order search", () => {
  test("finds a full tracking number", () => {
    assert.equal(matchesOrderSearch({ no_resi: "SPXID06415362944A" }, "SPXID06415362944A"), true);
  });
  test("finds a partial tracking number ignoring case and outer spaces", () => {
    assert.equal(matchesOrderSearch({ no_resi: "SPXID06415362944A" }, "  spxid064  "), true);
  });
  test("does not match an unrelated tracking number", () => {
    assert.equal(matchesOrderSearch({ no_resi: "SPXID06415362944A" }, "JT48870542338"), false);
  });
  test("preserves order code and product search", () => {
    assert.equal(matchesOrderSearch({ order_no: "733", text_neon: "GAME ROOM" }, "733"), true);
    assert.equal(matchesOrderSearch({ order_no: "733", text_neon: "GAME ROOM" }, "game room"), true);
  });
});