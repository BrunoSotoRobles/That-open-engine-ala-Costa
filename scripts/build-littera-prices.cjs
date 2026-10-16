/**
 * Genera src/data/littera-prices.json desde Työkirja1.xlsx (hoja ML).
 *
 * Columnas Excel: Littera (0), Suorite (1), Määrä (2), Yks (3), €/h (4), h (5),
 *   KL1, työ (6), KL2, mat (7), KL3, aliur (8), yht €/yks (9), yht € (10),
 *   KL1/yks (11), KL2/yks (12), KL3/yks (13).
 *
 * Solo se incluyen filas con al menos un valor en KL1/yks, KL2/yks, KL3/yks o yht €/yks.
 * Clave en JSON: "litteraCode|unit" (unidad en mayúsculas).
 *
 * Uso: node scripts/build-littera-prices.cjs [ruta-opcional.xlsx]
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const EXCEL_NAME = 'Työkirja1.xlsx';
const SHEET_NAME = 'ML';
const COL = {
  Littera: 0,
  Yks: 3,
  yhtPerYks: 9,
  KL1yks: 11,
  KL2yks: 12,
  KL3yks: 13,
};

function toNum(v) {
  if (v === '' || v === undefined || v === null) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeUnit(yks) {
  const s = String(yks || '').trim();
  return s === '' || s === '***' ? null : s.toUpperCase();
}

function buildLitteraPrices(excelPath, outputPath) {
  const wb = XLSX.readFile(excelPath);
  const sheet = wb.Sheets[SHEET_NAME];
  if (!sheet) {
    throw new Error(`Hoja "${SHEET_NAME}" no encontrada en ${excelPath}`);
  }
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const prices = {};
  const errors = [];
  const warnings = [];

  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i];
    const litRaw = row[COL.Littera];
    const yksRaw = row[COL.Yks];
    const yht = toNum(row[COL.yhtPerYks]);
    const kl1 = toNum(row[COL.KL1yks]);
    const kl2 = toNum(row[COL.KL2yks]);
    const kl3 = toNum(row[COL.KL3yks]);

    const hasPerUnit = (Number.isFinite(kl1) && kl1 > 0) || (Number.isFinite(kl2) && kl2 > 0) || (Number.isFinite(kl3) && kl3 > 0);
    const hasTotal = Number.isFinite(yht) && yht > 0;
    if (!hasPerUnit && !hasTotal) continue;

    const unit = normalizeUnit(yksRaw);
    if (!unit) continue;

    const litteraCode = String(litRaw ?? '').trim();
    if (!litteraCode) continue;

    const key = `${litteraCode}|${unit}`;
    if (prices[key]) {
      warnings.push(`Clave duplicada: ${key} (fila ${i + 1}), se usa la primera aparición.`);
      continue;
    }

    const labor = Number.isFinite(kl1) && kl1 >= 0 ? kl1 : undefined;
    const material = Number.isFinite(kl2) && kl2 >= 0 ? kl2 : undefined;
    const subcontract = Number.isFinite(kl3) && kl3 >= 0 ? kl3 : undefined;

    let total = Number.isFinite(yht) && yht >= 0 ? yht : undefined;
    if (total === undefined) {
      const sum = (labor ?? 0) + (material ?? 0) + (subcontract ?? 0);
      total = sum > 0 ? sum : undefined;
    }

    const entry = {};
    if (labor !== undefined) entry.labor = labor;
    if (material !== undefined) entry.material = material;
    if (subcontract !== undefined) entry.subcontract = subcontract;
    if (total !== undefined) entry.total = total;

    if (Object.keys(entry).length === 0) continue;
    prices[key] = entry;
  }

  const updatedAt = new Date().toISOString().slice(0, 10);
  const out = {
    version: '1.0',
    updatedAt,
    metadata: {
      source: 'excel',
      excelFile: path.basename(excelPath),
      description: 'Precios por Littera (labor, material, subcontract). Actualizable desde Työkirja1 o futuras fuentes.',
    },
    prices,
  };

  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2), 'utf8');

  return { prices, errors, warnings };
}

function validate(prices) {
  const warnings = [];
  for (const [key, entry] of Object.entries(prices)) {
    const { labor, material, subcontract, total } = entry;
    const sum = (labor ?? 0) + (material ?? 0) + (subcontract ?? 0);
    if (total !== undefined && sum > 0 && Math.abs(total - sum) > 0.01) {
      warnings.push(`${key}: total=${total} != labor+material+subcontract=${sum}`);
    }
  }
  return warnings;
}

// --- main
const projectRoot = path.resolve(__dirname, '..');
const excelPath = path.resolve(process.argv[2] || path.join(projectRoot, 'src/data', EXCEL_NAME));
const outputPath = path.join(projectRoot, 'src/data/littera-prices.json');

if (!fs.existsSync(excelPath)) {
  console.error('No se encontró:', excelPath);
  process.exit(1);
}

console.log('Leyendo', excelPath);
const { prices, errors, warnings } = buildLitteraPrices(excelPath, outputPath);

const validationWarnings = validate(prices);

errors.forEach((e) => console.error('Error:', e));
warnings.forEach((w) => console.warn('Aviso:', w));
validationWarnings.forEach((w) => console.warn('Validación:', w));

console.log('Escrito', outputPath, '| entradas:', Object.keys(prices).length);
if (errors.length > 0) process.exit(1);
