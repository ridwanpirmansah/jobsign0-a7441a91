import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatOrderPrintLabel, thermalPageLayout, thermalTrailingFeed } from "./thermal-layout";

describe("thermal sticker printing", () => {
  test("appends order name and dimensions", () => {
    assert.equal(formatOrderPrintLabel([{ text_neon: "GAME ROOM", akrilik_p: 40, akrilik_l: 40 }]), "GAME ROOM 40x40");
  });
  test("does not duplicate dimensions already in the name", () => {
    assert.equal(formatOrderPrintLabel([{ text_neon: "GAME ROOM 40x40", akrilik_p: 40, akrilik_l: 40 }]), "GAME ROOM 40x40");
  });
  test("keeps all products on the footer", () => {
    assert.equal(formatOrderPrintLabel([{ text_neon: "GAME ROOM", akrilik_p: 40, akrilik_l: 40 }, { manual_name: "OPEN", akrilik_p: 20, akrilik_l: 30 }]), "GAME ROOM 40x40 / OPEN 20x30");
  });
  test("one 100 mm sticker advances exactly 800 dots without extra line feeds", () => {
    const layout = thermalPageLayout(576, 600, 40, 100);
    assert.equal(layout.height, 800);
    assert.equal(layout.scale, 1);
    assert.equal(thermalTrailingFeed(100).length, 0);
  });
  test("fits the entire receipt and footer on a short sticker without cropping", () => {
    const layout = thermalPageLayout(576, 600, 40, 40);
    assert.equal(layout.height, 320);
    assert.equal(layout.receiptHeight + layout.footerHeight, 320);
    assert.equal(layout.receiptWidth, 288);
  });
  test("continuous paper retains original size and feed", () => {
    assert.equal(thermalPageLayout(384, 384, 40, 0).height, 424);
    assert.deepEqual([...thermalTrailingFeed(0)], [10, 10, 10]);
  });
});