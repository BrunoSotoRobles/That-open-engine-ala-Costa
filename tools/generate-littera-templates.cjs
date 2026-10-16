#!/usr/bin/env node

/**
 * Script auxiliar para generar PLANTILLAS sugeridas de filtros Littera
 * a partir de `src/data/talo_littera_mapping.json`.
 *
 * IMPORTANTE:
 * - NO modifica ningún archivo existente.
 * - Escribe un nuevo CSV: `src/data/littera-filter-templates.generated.csv`.
 * - Está pensado como herramienta offline para tu equipo (no forma parte del runtime).
 *
 * Uso (desde la raíz del repo):
 *   node tools/generate-littera-templates.cjs
 */

/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------
// Utilidades básicas
// ------------------------------------------------------------

const ROOT_DIR = path.resolve(__dirname, '..');
const MAPPING_PATH = path.join(ROOT_DIR, 'src', 'data', 'talo_littera_mapping.json');
const OUTPUT_PATH = path.join(ROOT_DIR, 'src', 'data', 'littera-filter-templates.generated.csv');

/**
 * Normaliza texto para matching simple de keywords
 */
function normalizeText(text) {
  return (text || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // quitar símbolos raros
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Separa en tokens sencillos
 */
function tokenize(text) {
  const norm = normalizeText(text);
  if (!norm) return [];
  return norm.split(' ').filter(Boolean);
}

// ------------------------------------------------------------
// Carga de mapping TALO → Littera
// ------------------------------------------------------------

function loadMapping() {
  if (!fs.existsSync(MAPPING_PATH)) {
    throw new Error(`No se encontró el archivo JSON de mapping en: ${MAPPING_PATH}`);
  }

  const jsonRaw = fs.readFileSync(MAPPING_PATH, 'utf8');
  let data;
  try {
    data = JSON.parse(jsonRaw);
  } catch (err) {
    throw new Error(`Error al parsear JSON de mapping: ${err.message}`);
  }

  if (!data || !Array.isArray(data.mappingData)) {
    throw new Error('Estructura inválida en talo_littera_mapping.json: falta mappingData[]');
  }

  /** @type {Array<{
   *  nimikkeistoCode:string,
   *  nimikkeistoName:string,
   *  maaraLuetteloBase:string,
   *  maaraLuetteloCode:string,
   *  litteraCode:string,
   *  litteraDescription:string,
   *  litteraUnit:string,
   *  category:string,
   *  notes:string,
   *  active:string
   * }>} */
  const rows = data.mappingData.map((row) => ({
    nimikkeistoCode: (row.nimikkeistoCode || '').toString().trim(),
    nimikkeistoName: (row.nimikkeistoName || '').toString().trim(),
    maaraLuetteloBase: (row.maaraLuetteloBase || '').toString().trim(),
    maaraLuetteloCode: (row.maaraLuetteloCode || '').toString().trim(),
    litteraCode: (row.litteraCode || '').toString().trim(),
    litteraDescription: (row.litteraDescription || '').toString().trim(),
    litteraUnit: (row.litteraUnit || '').toString().trim(),
    category: (row.category || '').toString().trim(),
    notes: (row.notes || '').toString().trim(),
    active: ((row.active || 'TRUE').toString().trim().toUpperCase())
  }));

  // Solo filas activas y con información mínima
  const activeRows = rows.filter(
    (r) => r.active === 'TRUE' && r.nimikkeistoCode && r.litteraCode && r.maaraLuetteloCode
  );

  return activeRows;
}

// ------------------------------------------------------------
// Agrupación por Nimikkeistö
// ------------------------------------------------------------

function groupByNimikkeisto(rows) {
  /** @type {Map<string, {name:string, rows:any[]}>} */
  const map = new Map();

  for (const row of rows) {
    const code = row.nimikkeistoCode;
    if (!code) continue;
    if (!map.has(code)) {
      map.set(code, {
        name: row.nimikkeistoName || '',
        rows: []
      });
    }
    map.get(code).rows.push(row);
  }

  return map;
}

// ------------------------------------------------------------
// Inferencia de método constructivo y tipo IFC
// ------------------------------------------------------------

// Prefijo (3 dígitos) → etiqueta de método general
const PREFIX_METHOD_MAP = {
  // in-situ concreto / losas / muros especiales
  '231': 'cast-in-place',
  '232': 'cast-in-place',
  '233': 'cast-in-place',
  '260': 'cast-in-place',
  '271': 'cast-in-place',
  '287': 'cast-in-place',
  '331': 'cast-in-place',
  '332': 'cast-in-place',
  '334': 'cast-in-place',

  // prefabricado
  '315': 'precast',

  // timber / runko
  '355': 'timber',
  '356': 'timber',

  // mampostería / particiones ligeras
  '454': 'light-masonry',
  '456': 'light-masonry',
  '485': 'light-masonry',

  // cubiertas
  '371': 'roof',
  '372': 'roof',
  '373': 'roof',
  '375': 'roof',
  '376': 'roof',

  // ventanas
  '413': 'windows',
  '416': 'windows',
  '421': 'windows',
  '423': 'windows',
  '425': 'windows',
  '429': 'windows',

  // puertas
  '433': 'doors',
  '436': 'doors',
  '437': 'doors'
};

/**
 * Dado un mapa de prefijo -> stats, infiere el método dominante
 */
function inferConstructionMethod(prefixStats) {
  /** @type {Record<string, number>} */
  const methodCounts = {};

  for (const [prefix, stats] of Object.entries(prefixStats)) {
    const method = PREFIX_METHOD_MAP[prefix];
    if (!method) continue;
    methodCounts[method] = (methodCounts[method] || 0) + stats.count;
  }

  let bestMethod = null;
  let bestCount = 0;
  for (const [method, count] of Object.entries(methodCounts)) {
    if (count > bestCount) {
      bestCount = count;
      bestMethod = method;
    }
  }

  return bestMethod; // puede ser null
}

/**
 * Inferencia muy básica de IFC Type a partir del código Nimikkeistö
 */
function inferIfcType(nimCode) {
  if (!nimCode) return null;
  const code = nimCode.toString();

  if (code.startsWith('122') || code.startsWith('123')) return 'IfcSlab';
  if (code.startsWith('1241')) return 'IfcWall';
  if (code.startsWith('1242')) return 'IfcWindow';
  if (code.startsWith('1311')) return 'IfcWall';
  if (code.startsWith('1315')) return 'IfcDoor';
  if (code.startsWith('1261')) return 'IfcRoof';

  // Por defecto, sin inferencia
  return null;
}

// ------------------------------------------------------------
// Cálculo de estadísticas de prefijos
// ------------------------------------------------------------

function computePrefixStats(rowsForCode) {
  /** @type {Record<string, {count:number, units:Set<string>, keywords:Set<string>}>} */
  const stats = {};

  for (const row of rowsForCode) {
    const code = row.litteraCode || '';
    if (code.length < 3) continue;
    const prefix = code.substring(0, 3);

    if (!stats[prefix]) {
      stats[prefix] = {
        count: 0,
        units: new Set(),
        keywords: new Set()
      };
    }

    const s = stats[prefix];
    s.count += 1;

    if (row.litteraUnit) {
      s.units.add(row.litteraUnit.toUpperCase());
    }

    const tokens = tokenize(row.litteraDescription);
    for (const t of tokens) {
      if (t.length >= 4) {
        s.keywords.add(t);
      }
    }
  }

  return stats;
}

// ------------------------------------------------------------
// Meta-plantillas por método constructivo
// ------------------------------------------------------------

// Cada entrada define actividades candidatas por método.
// prefixes son prefijos "ideales"; luego se recortan a los que realmente existen para ese Nimikkeistö.

const META_TEMPLATES = {
  'cast-in-place': [
    { activity: 'muottityö', prefixes: ['231', '271', '331'], priority: 1, required: true },
    { activity: 'raudoitus', prefixes: ['232', '271', '331'], priority: 1, required: true },
    { activity: 'betonointi', prefixes: ['232', '260', '271', '331'], priority: 1, required: true },
    { activity: 'hierto', prefixes: ['260', '287', '331'], priority: 2, required: false },
    { activity: 'eriste', prefixes: ['237', '260', '334'], priority: 2, required: false },
    { activity: 'varusteet', prefixes: ['233', '260'], priority: 3, required: false }
  ],
  precast: [
    { activity: 'toimitus', prefixes: ['315'], priority: 1, required: true },
    { activity: 'asennus', prefixes: ['315'], priority: 1, required: true },
    { activity: 'saumat', prefixes: ['315'], priority: 2, required: false }
  ],
  timber: [
    { activity: 'runko', prefixes: ['355', '356', '334'], priority: 1, required: true },
    { activity: 'eriste', prefixes: ['355', '356', '334'], priority: 1, required: true },
    { activity: 'levytys', prefixes: ['355', '356'], priority: 2, required: false }
  ],
  'light-masonry': [
    { activity: 'muuraus', prefixes: ['454', '485'], priority: 1, required: true },
    { activity: 'runko_ja_levy', prefixes: ['456'], priority: 1, required: true },
    { activity: 'liitokset', prefixes: ['454', '456', '485'], priority: 2, required: false }
  ],
  roof: [
    { activity: 'kate', prefixes: ['371', '372', '373'], priority: 1, required: true },
    { activity: 'eriste', prefixes: ['375'], priority: 2, required: false },
    { activity: 'varusteet', prefixes: ['371', '376'], priority: 3, required: false }
  ],
  windows: [
    { activity: 'ikkuna_toimitus', prefixes: ['413', '416'], priority: 1, required: true },
    { activity: 'asennus', prefixes: ['416', '425', '429'], priority: 2, required: false },
    { activity: 'listoitus', prefixes: ['416'], priority: 3, required: false },
    { activity: 'kittaus', prefixes: ['416'], priority: 3, required: false }
  ],
  doors: [
    { activity: 'ovi_toimitus', prefixes: ['433', '436', '437'], priority: 1, required: true },
    { activity: 'asennus', prefixes: ['437'], priority: 2, required: false },
    { activity: 'listoitus', prefixes: ['437'], priority: 3, required: false }
  ]
};

// ------------------------------------------------------------
// Generación de plantillas para un Nimikkeistö concreto
// ------------------------------------------------------------

function pickUnitsForPrefixes(prefixStats, prefixes) {
  const units = new Set();
  for (const p of prefixes) {
    const stat = prefixStats[p];
    if (!stat) continue;
    for (const u of stat.units) {
      units.add(u);
    }
  }
  return Array.from(units);
}

function pickTopKeywords(prefixStats, prefixes, limit = 3) {
  const freq = new Map();
  for (const p of prefixes) {
    const stat = prefixStats[p];
    if (!stat) continue;
    for (const kw of stat.keywords) {
      freq.set(kw, (freq.get(kw) || 0) + 1);
    }
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([kw]) => kw);
}

/**
 * Genera filas de plantilla para un nimikkeistoCode.
 * Devuelve un array de objetos con los campos del CSV.
 */
function generateTemplateForCode(nimCode, group) {
  const { rows, name } = group;
  if (!rows || rows.length === 0) return [];

  const prefixStats = computePrefixStats(rows);
  const method = inferConstructionMethod(prefixStats);
  const ifcType = inferIfcType(nimCode);

  if (!method) return [];

  const meta = META_TEMPLATES[method];
  if (!meta || meta.length === 0) return [];

  // Contexto básico detectado por keywords en descripciones
  const allDescriptions = rows.map((r) => r.litteraDescription).join(' ');
  const normDesc = normalizeText(allDescriptions);
  const contextRequired = [];
  if (normDesc.includes('autohall') || normDesc.includes('garage')) {
    contextRequired.push('autohall,garage');
  }
  if (normDesc.includes('luiska') || normDesc.includes('ramp')) {
    contextRequired.push('luiska,ramp');
  }
  if (normDesc.includes('elementti') || normDesc.includes('precast')) {
    contextRequired.push('elementti');
  }

  /** @type {any[]} */
  const templateRows = [];

  for (const activityDef of meta) {
    // Prefijos que realmente existen en este Nimikkeistö
    const existingPrefixes = activityDef.prefixes.filter(
      (p) => prefixStats[p] && prefixStats[p].count > 0
    );
    if (existingPrefixes.length === 0) {
      continue;
    }

    const units = pickUnitsForPrefixes(prefixStats, existingPrefixes);
    if (units.length === 0) {
      // Si no hay unidades detectadas, mejor saltar
      continue;
    }

    // maxCodes simple: 1 para esenciales, 2 para otros
    const maxCodes = activityDef.priority === 1 ? 1 : 2;

    const keywords = pickTopKeywords(prefixStats, existingPrefixes, 3);

    templateRows.push({
      nimikkeistoCode: nimCode,
      nimikkeistoName: name || '',
      ifcType: ifcType || '',
      constructionMethod: method,
      contextRequired: contextRequired.join(';'),
      activity: activityDef.activity,
      codeRange: existingPrefixes.join(','), // ej. "231,260"
      units: units.join(','), // ej. "M2,M3"
      keywords: keywords.join(','),
      excludeKeywords: '',
      priority: activityDef.priority,
      maxCodes,
      required: activityDef.required ? 'YES' : 'NO',
      notes: 'Generated from talo_littera_mapping.json (auto)'
    });
  }

  return templateRows;
}

// ------------------------------------------------------------
// Export a CSV
// ------------------------------------------------------------

function escapeCsv(value) {
  const str = String(value ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportTemplatesToCsv(allTemplates) {
  const header = [
    'Nimikkeistö-koodi',
    'Nimikkeistö-nimi',
    'IFC Type',
    'Rakennusmenetelmä / Construction Method',
    'Vaadittu konteksti / Context Required',
    'Työvaihe / Activity',
    'Littera-koodialue / Code Range',
    'Yksikkö / Unit',
    'Avainsanat / Keywords',
    'Poissulkevat avainsanat / Exclude Keywords',
    'Prioriteetti / Priority',
    'Maksimi koodit / Max Codes',
    'Required',
    'Huomautukset / Notes'
  ];

  const lines = [header.join(',')];

  for (const row of allTemplates) {
    const line = [
      escapeCsv(row.nimikkeistoCode),
      escapeCsv(row.nimikkeistoName),
      escapeCsv(row.ifcType),
      escapeCsv(row.constructionMethod),
      escapeCsv(row.contextRequired),
      escapeCsv(row.activity),
      escapeCsv(row.codeRange),
      escapeCsv(row.units),
      escapeCsv(row.keywords),
      escapeCsv(row.excludeKeywords),
      escapeCsv(row.priority),
      escapeCsv(row.maxCodes),
      escapeCsv(row.required),
      escapeCsv(row.notes)
    ].join(',');
    lines.push(line);
  }

  const csv = lines.join('\n');
  fs.writeFileSync(OUTPUT_PATH, csv, 'utf8');
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

function main() {
  console.log('[generate-littera-templates] Cargando mapping desde:', MAPPING_PATH);
  const rows = loadMapping();
  console.log(`[generate-littera-templates] Filas activas: ${rows.length}`);

  const grouped = groupByNimikkeisto(rows);
  console.log(`[generate-littera-templates] Nimikkeistö distintos: ${grouped.size}`);

  /** @type {any[]} */
  const allTemplates = [];

  for (const [nimCode, group] of grouped.entries()) {
    const templates = generateTemplateForCode(nimCode, group);
    if (templates.length > 0) {
      allTemplates.push(...templates);
    }
  }

  // Ordenar salida por nimikkeistoCode para legibilidad
  allTemplates.sort((a, b) => {
    if (a.nimikkeistoCode === b.nimikkeistoCode) {
      return a.priority - b.priority;
    }
    return a.nimikkeistoCode.localeCompare(b.nimikkeistoCode);
  });

  console.log(
    `[generate-littera-templates] Plantillas generadas: ${allTemplates.length} filas (no se modifica ningún archivo existente)`
  );
  console.log('[generate-littera-templates] Escribiendo CSV en:', OUTPUT_PATH);

  exportTemplatesToCsv(allTemplates);

  console.log('[generate-littera-templates] Listo.');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('[generate-littera-templates] Error:', err.message);
    process.exit(1);
  }
}

