const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Cargar datos de mapeo y Littera
const mappingData = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/data/talo_littera_mapping.json'), 'utf8'));
const litteraData = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/data/littera.json'), 'utf8'));

// Crear índices para búsqueda rápida
const litteraByCode = {};
litteraData.forEach(entry => {
  if (!entry.isCategory && entry.littera) {
    litteraByCode[entry.littera] = entry;
  }
});

// Mapeo TALO → Littera (por código Määräluettelo)
const taloToLitteraMap = {};
mappingData.mappingData.forEach(row => {
  if (row.active === 'TRUE' && row.maaraLuetteloCode && row.litteraCode) {
    const taloBase = row.maaraLuetteloCode.replace(/\./g, '').substring(0, 4);
    if (!taloToLitteraMap[taloBase]) {
      taloToLitteraMap[taloBase] = [];
    }
    taloToLitteraMap[taloBase].push({
      litteraCode: row.litteraCode,
      description: row.litteraDescription,
      unit: row.litteraUnit,
      category: row.category
    });
  }
});

// Función para obtener códigos Littera para un código TALO
function getLitteraCodesForTalo(taloCode) {
  if (!taloCode) return [];
  const taloBase = taloCode.replace(/\./g, '').substring(0, 4);
  return taloToLitteraMap[taloBase] || [];
}

// Función para variar costos (10-25%)
function varyCost(cost, minVar = 0.10, maxVar = 0.25) {
  if (!cost || cost === 0) return 0;
  const variation = minVar + Math.random() * (maxVar - minVar);
  const direction = Math.random() > 0.5 ? 1 : -1; // 50% sube, 50% baja
  return Math.max(0, cost * (1 + direction * variation));
}

// Función para determinar source (60% suggestion, 40% user)
function getSource() {
  return Math.random() < 0.6 ? 'suggestion' : 'user';
}

// Leer archivo Excel
const filePath = path.join(__dirname, '../public/assets/IFC example/Nokian Renkaat_malli Hs.xlsx');
console.log('Leyendo archivo Excel...');
const wb = XLSX.readFile(filePath);

// Procesar hoja Measurement Data
const measurementSheet = wb.Sheets['Measurement Data'];
const measurementData = XLSX.utils.sheet_to_json(measurementSheet, { header: 1, defval: '' });

const headers = measurementData[0];
const headerMap = {};
headers.forEach((h, i) => { headerMap[h] = i; });

console.log('Procesando Measurement Data...');

// Agrupar elementos por GUID para rastrear qué Littera codes ya tienen
const elementsByGuid = {};
const guidIdx = headerMap['GUID'];
const taloIdx = headerMap['TALO Code'];
const litteraIdx = headerMap['Littera Code'];
const nameIdx = headerMap['Name'];
const ifcTypeIdx = headerMap['IFC Type'];

// Primero, identificar elementos únicos y sus códigos Littera existentes
for (let i = 1; i < measurementData.length; i++) {
  const row = measurementData[i];
  const guid = String(row[guidIdx] || '').trim();
  const talo = String(row[taloIdx] || '').trim();
  const littera = String(row[litteraIdx] || '').trim();
  const name = String(row[nameIdx] || '').trim();
  const ifcType = String(row[ifcTypeIdx] || '').trim();
  
  if (guid && guid.length > 0 && talo && talo.length > 0) {
    if (!elementsByGuid[guid]) {
      elementsByGuid[guid] = {
        guid,
        talo,
        name,
        ifcType,
        existingLittera: new Set(),
        rows: []
      };
    }
    if (littera && littera.length > 0) {
      elementsByGuid[guid].existingLittera.add(littera);
    }
    elementsByGuid[guid].rows.push(i);
  }
}

console.log(`Encontrados ${Object.keys(elementsByGuid).length} elementos únicos`);

// Agregar nuevos códigos Littera donde falten
let newLitteraRows = 0;
let costAdjustments = 0;

for (const guid in elementsByGuid) {
  const element = elementsByGuid[guid];
  const litteraOptions = getLitteraCodesForTalo(element.talo);
  
  // Si tiene menos de 2 códigos Littera, agregar algunos
  if (element.existingLittera.size < 2 && litteraOptions.length > 0) {
    // Filtrar opciones que no sean categorías (unit !== '***')
    const validOptions = litteraOptions.filter(opt => opt.unit !== '***' && !element.existingLittera.has(opt.litteraCode));
    
    if (validOptions.length > 0) {
      // Agregar 1-3 códigos Littera nuevos
      const numToAdd = Math.min(1 + Math.floor(Math.random() * 2), validOptions.length);
      const selected = validOptions.slice(0, numToAdd);
      
      // Encontrar la última fila de este elemento para insertar después
      const lastRowIdx = Math.max(...element.rows);
      
      selected.forEach((littera, idx) => {
        const newRow = [...measurementData[lastRowIdx]];
        // Limpiar campos específicos de Littera
        newRow[headerMap['Littera Code']] = littera.litteraCode;
        newRow[headerMap['Littera Name']] = littera.description;
        newRow[headerMap['Littera Category']] = littera.category || '';
        newRow[headerMap['Unit']] = littera.unit;
        // Usar cantidad del elemento base o calcular
        const quantity = parseFloat(newRow[headerMap['Quantity']] || 0);
        newRow[headerMap['Quantity']] = quantity > 0 ? quantity : '';
        
        // Insertar después de la última fila del elemento
        measurementData.splice(lastRowIdx + 1 + idx, 0, newRow);
        newLitteraRows++;
      });
      
      // Actualizar índices de filas para este elemento
      for (let i = 0; i < selected.length; i++) {
        element.rows.push(lastRowIdx + 1 + i);
      }
    }
  }
}

// Ajustar costos en todas las filas con costos
const materialIdx = headerMap['Material Cost'];
const laborIdx = headerMap['Labor Cost'];
const equipmentIdx = headerMap['Equipment Cost'];
const overheadIdx = headerMap['Overhead Cost'];
const totalIdx = headerMap['Total Cost'];

for (let i = 1; i < measurementData.length; i++) {
  const row = measurementData[i];
  const material = parseFloat(row[materialIdx] || 0);
  const labor = parseFloat(row[laborIdx] || 0);
  const equipment = parseFloat(row[equipmentIdx] || 0);
  const overhead = parseFloat(row[overheadIdx] || 0);
  const total = parseFloat(row[totalIdx] || 0);
  
  // Solo ajustar si hay costos
  if (total > 0 || material > 0 || labor > 0 || equipment > 0 || overhead > 0) {
    const newMaterial = varyCost(material);
    const newLabor = varyCost(labor);
    const newEquipment = varyCost(equipment);
    const newOverhead = varyCost(overhead);
    const newTotal = newMaterial + newLabor + newEquipment + newOverhead;
    
    row[materialIdx] = newMaterial;
    row[laborIdx] = newLabor;
    row[equipmentIdx] = newEquipment;
    row[overheadIdx] = newOverhead;
    row[totalIdx] = newTotal;
    costAdjustments++;
  }
}

console.log(`Agregadas ${newLitteraRows} filas con nuevos códigos Littera`);
console.log(`Ajustados costos en ${costAdjustments} filas`);

// Actualizar hoja Measurement Data
const newMeasurementSheet = XLSX.utils.aoa_to_sheet(measurementData);
wb.Sheets['Measurement Data'] = newMeasurementSheet;

// Procesar hoja Sync
console.log('Procesando hoja Sync...');
const syncSheet = wb.Sheets['Sync'];
const syncData = XLSX.utils.sheet_to_json(syncSheet, { header: 1, defval: '' });

const syncHeaders = syncData[0];
const syncHeaderMap = {};
syncHeaders.forEach((h, i) => { syncHeaderMap[h] = i; });

const syncGuidIdx = syncHeaderMap['GUID'];
const syncTaloIdx = syncHeaderMap['TALO Code'];
const syncTaloNameIdx = syncHeaderMap['TALO Name'];
const syncMaterialIdx = syncHeaderMap['Material Cost'];
const syncLaborIdx = syncHeaderMap['Labor Cost'];
const syncEquipmentIdx = syncHeaderMap['Equipment Cost'];
const syncOverheadIdx = syncHeaderMap['Overhead Cost'];
const syncTotalIdx = syncHeaderMap['Total Cost'];
const syncLitteraCodesIdx = syncHeaderMap['LitteraCodes'];

// Actualizar Sync con datos de Measurement Data
for (let i = 1; i < syncData.length; i++) {
  const syncRow = syncData[i];
  const guid = String(syncRow[syncGuidIdx] || '').trim();
  
  if (guid && elementsByGuid[guid]) {
    const element = elementsByGuid[guid];
    
    // Actualizar TALO si está vacío
    if (!syncRow[syncTaloIdx] || String(syncRow[syncTaloIdx]).trim() === '') {
      syncRow[syncTaloIdx] = element.talo;
    }
    
    // Recalcular costos desde Measurement Data para este GUID
    let totalMaterial = 0, totalLabor = 0, totalEquipment = 0, totalOverhead = 0;
    const litteraCodesArray = [];
    
    for (let j = 1; j < measurementData.length; j++) {
      const measRow = measurementData[j];
      if (String(measRow[guidIdx] || '').trim() === guid) {
        totalMaterial += parseFloat(measRow[materialIdx] || 0);
        totalLabor += parseFloat(measRow[laborIdx] || 0);
        totalEquipment += parseFloat(measRow[equipmentIdx] || 0);
        totalOverhead += parseFloat(measRow[overheadIdx] || 0);
        
        const litteraCode = String(measRow[litteraIdx] || '').trim();
        if (litteraCode && litteraCode.length > 0) {
          const litteraEntry = litteraByCode[litteraCode];
          if (litteraEntry) {
            litteraCodesArray.push({
              litteraCode: litteraCode,
              litteraName: litteraEntry.description || measRow[headerMap['Littera Name']] || '',
              litteraCategory: litteraEntry.category || measRow[headerMap['Littera Category']] || null,
              unit: litteraEntry.unit || measRow[headerMap['Unit']] || '',
              quantity: parseFloat(measRow[headerMap['Quantity']] || 0),
              source: getSource()
            });
          }
        }
      }
    }
    
    // Actualizar costos en Sync
    syncRow[syncMaterialIdx] = totalMaterial;
    syncRow[syncLaborIdx] = totalLabor;
    syncRow[syncEquipmentIdx] = totalEquipment;
    syncRow[syncOverheadIdx] = totalOverhead;
    syncRow[syncTotalIdx] = totalMaterial + totalLabor + totalEquipment + totalOverhead;
    
    // Actualizar LitteraCodes como JSON
    if (litteraCodesArray.length > 0) {
      syncRow[syncLitteraCodesIdx] = JSON.stringify(litteraCodesArray);
    }
  }
}

// Actualizar hoja Sync
const newSyncSheet = XLSX.utils.aoa_to_sheet(syncData);
wb.Sheets['Sync'] = newSyncSheet;

// Guardar archivo
const outputPath = path.join(__dirname, '../public/assets/IFC example/Nokian Renkaat_malli Hs.xlsx');
XLSX.writeFile(wb, outputPath);
console.log(`\n✅ Archivo guardado en: ${outputPath}`);
console.log(`\nResumen:`);
console.log(`- Nuevas filas Littera agregadas: ${newLitteraRows}`);
console.log(`- Costos ajustados: ${costAdjustments}`);
console.log(`- Elementos procesados: ${Object.keys(elementsByGuid).length}`);

