// Deteksi pengeluaran ganda (anti duplikat) — murni di sisi tampilan.
// Aturan: nominal sama persis + tanggal berdekatan (<= 3 hari).
// Diperkuat bila kategori sama dan/atau nama belanja mirip.

export type DupCandidate = {
  id: string;
  expense_date: string;
  category: string;
  amount: number;
  description: string;
  vendor?: string | null;
};

export type DupLevel = "tinggi" | "sedang";

const STOPWORDS = new Set(["dan", "untuk", "yang", "di", "ke", "dari", "pcs", "buah", "pack", "unit"]);

function tokenize(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** 0..1 kemiripan teks berbasis irisan kata (Jaccard, dibulatkan ke atas untuk subset). */
export function textSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length || !tb.length) return 0;
  const sa = new Set(ta);
  const sb = new Set(tb);
  let inter = 0;
  sa.forEach((t) => { if (sb.has(t)) inter++; });
  if (!inter) return 0;
  const smaller = Math.min(sa.size, sb.size);
  const union = sa.size + sb.size - inter;
  // subset penuh (mis. "LED STRIP" vs "LED STRIP 12V") dianggap sangat mirip
  return Math.max(inter / smaller >= 1 ? 0.9 : 0, inter / union);
}

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`).getTime();
  const db = new Date(`${b}T00:00:00`).getTime();
  return Math.abs(Math.round((da - db) / 86400000));
}

export type DupMatch = { row: DupCandidate; level: DupLevel; reason: string };

/** Cari kandidat duplikat dari `rows` untuk satu entri `target`. */
export function findDuplicates<T extends DupCandidate>(
  target: { id?: string; expense_date: string; category: string; amount: number; description: string },
  rows: T[],
): { row: T; level: DupLevel; reason: string }[] {
  const amt = Number(target.amount);
  if (!Number.isFinite(amt) || amt <= 0 || !target.expense_date) return [];

  const out: { row: T; level: DupLevel; reason: string }[] = [];
  for (const r of rows) {
    if (target.id && r.id === target.id) continue;
    if (Number(r.amount) !== amt) continue;
    const dd = daysBetween(r.expense_date, target.expense_date);
    if (dd > 3) continue;

    const sameCat = r.category === target.category;
    const sim = textSimilarity(r.description, target.description);
    if (!sameCat && sim < 0.34) continue;

    const reasons: string[] = ["nominal sama"];
    reasons.push(dd === 0 ? "tanggal sama" : `selisih ${dd} hari`);
    if (sameCat) reasons.push("kategori sama");
    if (sim >= 0.34) reasons.push("nama mirip");

    const level: DupLevel = dd === 0 && (sameCat || sim >= 0.5) ? "tinggi" : "sedang";
    out.push({ row: r, level, reason: reasons.join(" · ") });
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "tinggi" ? -1 : 1));
}

/** Peta id → level duplikat untuk sekumpulan baris. */
export function buildDuplicateMap<T extends DupCandidate>(rows: T[]): Record<string, { level: DupLevel; reason: string; count: number }> {
  const map: Record<string, { level: DupLevel; reason: string; count: number }> = {};
  for (const r of rows) {
    const matches = findDuplicates(r, rows);
    if (!matches.length) continue;
    const top = matches[0]!;
    map[r.id] = { level: top.level, reason: top.reason, count: matches.length };
  }
  return map;
}
