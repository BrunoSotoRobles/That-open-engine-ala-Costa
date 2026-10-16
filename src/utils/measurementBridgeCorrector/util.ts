import { EPS_CANAL } from "./constants";

export function parseNum(v: unknown): number | null {
  if (typeof v === "boolean") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.trim().replace(",", ".");
    if (!s) return null;
    const f = Number(s);
    return Number.isFinite(f) ? f : null;
  }
  return null;
}

export function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
}

export function igual(a: number | null, b: number | null, tol = EPS_CANAL): boolean {
  return a != null && b != null && b !== 0 && rel(a, b) <= tol;
}

export function factorSospechoso(a: number | null, b: number | null): number | null {
  if (a == null || b == null || a <= 0 || b <= 0) return null;
  for (const f of [1e3, 1e4, 1e6, 1e9]) {
    if (Math.abs(a / b - f) / f <= 0.01) return f;
    if (Math.abs(b / a - f) / f <= 0.01) return 1 / f;
  }
  return null;
}
