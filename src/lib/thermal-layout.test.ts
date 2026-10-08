import { describe, expect, test } from "bun:test";
import { formatOrderPrintLabel, thermalPageLayout, thermalTrailingFeed } from "./thermal-layout";

describe("thermal sticker printing", () => {
  test("appends order name and dimensions", () => {
    expect(formatOrderPrintLabel([{ text_neon: "GAME ROOM", akrilik_p: 40, akrilik_l: 40 }])).toBe("GAME ROOM 40x40");
  });
  test("does not duplicate dimensions already in the name", () => {
    expect(formatOrderPrintLabel([{ text_neon: "GAME ROOM 40x40", akrilik_p: 40, akrilik_l: 40 }])).toBe("GAME ROOM 40x40");
  });
  test("keeps all products on the footer", () => {
    expect(formatOrderPrintLabel([{ text_neon: "GAME ROOM", akrilik_p: 40, akrilik_l: 40 }, { manual_name: "OPEN", akrilik_p: 20, akrilik_l: 30 }])).toBe("GAME ROOM 40x40 / OPEN 20x30");
  });
  test("one 100 mm sticker advances exactly 800 dots without extra line feeds", () => {
    const layout = thermalPageLayout(576, 600, 40, 100);
    expect(layout.height).toBe(800);
    expect(layout.scale).toBe(1);
    expect(thermalTrailingFeed(100).length).toBe(0);
  });
  test("fits the entire receipt and footer on a short sticker without cropping", () => {
    const layout = thermalPageLayout(576, 600, 40, 40);
    expect(layout.height).toBe(320);
    expect(layout.receiptHeight + layout.footerHeight).toBe(320);
    expect(layout.receiptWidth).toBe(288);
  });
  test("continuous paper retains original size and feed", () => {
    expect(thermalPageLayout(384, 384, 40, 0).height).toBe(424);
    expect([...thermalTrailingFeed(0)]).toEqual([10, 10, 10]);
  });
});