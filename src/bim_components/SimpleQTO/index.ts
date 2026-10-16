import * as WEBIFC from "web-ifc"
import * as OBC from "@thatopen/components"
import * as FRAGS from "@thatopen/fragments"
import * as BUI from "@thatopen/ui"

type QtoResult = {[setName: string]: {[qtoName: string]: number}}

interface TableRow {
  property: string
  value: string | number
  isHeader?: boolean
}

interface QuantityValue {
  value: number | null
  name: string | null
  quantityType: number | null
}

/** Tipo de fuente de cantidades: QTO formal (IfcElementQuantity) o PropertySet. */
type SourceType = 'QTO' | 'Pset'

interface QuantityEntry {
  value: number
  quantityType: number | null
}

/** Fuente de cantidades más rica encontrada para un elemento. */
interface QuantitySource {
  sourceType: SourceType
  sourceName: string
  quantities: Map<string, QuantityEntry>
}

// ─── Lookup inverso WEBIFC (numérico → clave) ────────────────────────────────
const WEBIFC_REVERSE = new Map<number, string>()
for (const key of Object.keys(WEBIFC)) {
  const val = (WEBIFC as any)[key]
  if (typeof val === 'number') WEBIFC_REVERSE.set(val, key)
}

// ─── Normalización de subtipos IFC al tipo base ───────────────────────────────
const NORMALIZED_IFC_TYPES: Record<string, string> = {
  IFCWALL: 'IfcWall', IFCWALLSTANDARDCASE: 'IfcWall',
  IFCSLAB: 'IfcSlab', IFCSLABSTANDARDCASE: 'IfcSlab',
  IFCDOOR: 'IfcDoor', IFCDOORSTANDARDCASE: 'IfcDoor',
  IFCWINDOW: 'IfcWindow', IFCWINDOWSTANDARDCASE: 'IfcWindow',
  IFCCOLUMN: 'IfcColumn', IFCCOLUMNSTANDARDCASE: 'IfcColumn',
  IFCBEAM: 'IfcBeam', IFCBEAMSTANDARDCASE: 'IfcBeam',
  IFCROOF: 'IfcRoof', IFCROOFSTANDARDCASE: 'IfcRoof',
  IFCSPACE: 'IfcSpace', IFCSTAIR: 'IfcStair', IFCSTAIRSTANDARDCASE: 'IfcStair',
  IFCRAILING: 'IfcRailing', IFCPLATE: 'IfcPlate', IFCMEMBER: 'IfcMember',
  IFCFURNISHINGELEMENT: 'IfcFurnishingElement',
  IFCFLOWSEGMENT: 'IfcFlowSegment', IFCFLOWTERMINAL: 'IfcFlowTerminal',
}

// ─── Tipos numéricos de quantities IFC ───────────────────────────────────────
const T_QTY_AREA   = (WEBIFC as any).IFCQUANTITYAREA   ?? 2044713172
const T_QTY_VOLUME = (WEBIFC as any).IFCQUANTITYVOLUME ?? 2405470396
const T_QTY_LENGTH = (WEBIFC as any).IFCQUANTITYLENGTH ?? 931644368
const T_QTY_COUNT  = (WEBIFC as any).IFCQUANTITYCOUNT  ?? 0
const T_QTY_WEIGHT = (WEBIFC as any).IFCQUANTITYWEIGHT ?? 0

/**
 * Nombres de propiedades que describen el elemento individual y no tienen
 * sentido acumularse entre varios elementos. Se aplica a QTO y Pset.
 */
const DESCRIPTIVE_NAMES = new Set([
  'Height', 'OverallHeight', 'Width', 'OverallWidth',
  'Depth', 'OverallDepth', 'Thickness',
  'Height (Simplebim)', 'Thickness (Simplebim)',
])

// ─── Funciones puras de módulo ────────────────────────────────────────────────

/**
 * Devuelve el tipo IFC normalizado de un expressId usando model.data,
 * que siempre está poblado (a diferencia de streamSettings.ids, que solo
 * existe en modelos streamed).
 * Estructura: model.data.get(id) = [[fragmentKeys], [floorId, ifcTypeNumber]]
 */
function normalizeIfcType(model: FRAGS.FragmentsGroup, expressId: number): string {
  const typeNum = model.data.get(expressId)?.[1]?.[1]
  if (typeNum == null) return 'Unknown'
  const wifcKey = WEBIFC_REVERSE.get(typeNum)
  if (!wifcKey) return `IfcType ${typeNum}`
  return NORMALIZED_IFC_TYPES[wifcKey] ?? wifcKey.replace(/^IFC/, 'Ifc')
}

/** Determina si una quantity formal (IfcElementQuantity) es aditiva entre elementos. */
function isAdditiveQty(quantityType: number, quantityName: string): boolean {
  if (quantityType === T_QTY_AREA || quantityType === T_QTY_VOLUME) return true
  if (T_QTY_COUNT && quantityType === T_QTY_COUNT) return true
  if (T_QTY_WEIGHT && quantityType === T_QTY_WEIGHT) return true
  if (quantityType === T_QTY_LENGTH) return !DESCRIPTIVE_NAMES.has(quantityName)
  return false
}

/** Determina si una propiedad de Pset es aditiva entre elementos por heurística de nombre. */
function isPsetPropertyAdditive(name: string): boolean {
  if (DESCRIPTIVE_NAMES.has(name)) return false
  const lower = name.toLowerCase()
  return (
    lower.includes('volume') || lower.includes('area')      ||
    lower.includes('length') || lower.includes('count')     ||
    lower.includes('weight') || lower.includes('mass')      ||
    lower.includes('perimeter')
  )
}

/** Lee el valor numérico de un item de IfcElementQuantity (VolumeValue, AreaValue, etc.). */
async function getQuantityValueFromModel(model: any, qtoID: number): Promise<QuantityValue> {
  try {
    const { name } = await OBC.IfcPropertiesUtils.getEntityName(model, qtoID)
    const props = await model.getProperties(qtoID)
    const value =
      props?.LengthValue?.value  ??
      props?.AreaValue?.value    ??
      props?.VolumeValue?.value  ??
      props?.WeightValue?.value  ??
      props?.CountValue?.value   ??
      props?.TimeValue?.value    ??
      null
    return { name, value, quantityType: props?.type ?? null }
  } catch {
    return { name: null, value: null, quantityType: null }
  }
}

/** Extrae todas las quantities de un IfcElementQuantity como mapa nombre→entrada. */
async function collectQtoEntries(
  model: FRAGS.FragmentsGroup,
  set: any
): Promise<Map<string, QuantityEntry>> {
  const entries = new Map<string, QuantityEntry>()
  const quantities = set?.Quantities ?? []
  for (const q of quantities) {
    const qId = (q as any)?.value ?? q
    const { name, value, quantityType } = await getQuantityValueFromModel(model, qId as number)
    if (name && value !== null) {
      entries.set(name, { value, quantityType })
    }
  }
  return entries
}

/** Extrae todas las propiedades numéricas de un IfcPropertySet como mapa nombre→entrada. */
async function collectPsetEntries(
  model: FRAGS.FragmentsGroup,
  set: any
): Promise<Map<string, QuantityEntry>> {
  const entries = new Map<string, QuantityEntry>()
  const props = set?.HasProperties ?? []
  for (const p of props) {
    const pId = (p as any)?.value ?? p
    const pProps = await model.getProperties(pId)
    if (!pProps) continue
    const pName  = pProps?.Name?.value ?? pProps?.Name ?? null
    const nomVal = pProps?.NominalValue?.value ?? null
    if (pName && nomVal !== null && typeof nomVal === 'number' && !isNaN(nomVal)) {
      entries.set(pName, { value: nomVal, quantityType: null })
    }
  }
  return entries
}

/**
 * Devuelve la fuente de cantidades más rica para un expressId dado.
 * Evalúa todos los IfcElementQuantity y todos los IfcPropertySet relacionados
 * y elige el set con más valores numéricos. En empate, QTO tiene prioridad.
 */
async function getBestQuantitySource(
  model: FRAGS.FragmentsGroup,
  indexer: OBC.IfcRelationsIndexer,
  expressId: number
): Promise<QuantitySource | null> {
  const relations = indexer.getEntityRelations(model, expressId, "IsDefinedBy")
  if (!relations) return null

  let bestQto:  QuantitySource | null = null
  let bestPset: QuantitySource | null = null

  for (const relId of relations) {
    const set = await model.getProperties(relId)
    if (!set) continue
    const setName = set?.Name?.value ?? set?.Name ?? `Set_${relId}`

    if (set.type === WEBIFC.IFCELEMENTQUANTITY) {
      const entries = await collectQtoEntries(model, set)
      if (!bestQto || entries.size > bestQto.quantities.size) {
        bestQto = { sourceType: 'QTO', sourceName: setName, quantities: entries }
      }

    } else if (set.type === WEBIFC.IFCPROPERTYSET) {
      const entries = await collectPsetEntries(model, set)
      if (!bestPset || entries.size > bestPset.quantities.size) {
        bestPset = { sourceType: 'Pset', sourceName: setName, quantities: entries }
      }
    }
  }

  // QTO gana en empate de cantidad de valores
  if (bestQto && bestPset) {
    return bestQto.quantities.size >= bestPset.quantities.size ? bestQto : bestPset
  }
  return bestQto ?? bestPset
}

// ─── Clase principal ─────────────────────────────────────────────────────────

export class SimpleQTO extends OBC.Component implements OBC.Disposable {
  static uuid = "3d80c464-633c-48f4-8561-cc213870d28c"
  enabled = true
  onDisposed: OBC.Event<any>
  private qtoResult: QtoResult = {}
  quantitiesTable: any
  onQuantitiesComputed = new OBC.Event<QtoResult>()

  constructor(components: OBC.Components) {
    super(components)
    this.components.add(SimpleQTO.uuid, this)
    
    this.quantitiesTable = BUI.html`
      <bim-table 
        style="width: 100%; height: 400px;"
        .columns=${[
          { header: 'Property', dataField: 'property', width: '50%' },
          { header: 'Value', dataField: 'value', width: '50%' }
        ]}
        .data=${[]}
      ></bim-table>
    `
  }

  resetQuantities(): void {
    this.qtoResult = {}
  }

  private updateTable(): void {
    const tableData: TableRow[] = []
    
    for (const setName in this.qtoResult) {
      tableData.push({ property: setName, value: '', isHeader: true })
      const properties = this.qtoResult[setName]
      for (const qtoName in properties) {
        const value = properties[qtoName]
        if (value === null) continue
        if (isNaN(value as number)) {
          // Valor centinela NaN = mensaje de advertencia (no acumulable/mixto)
          tableData.push({ property: qtoName, value: '—' })
        } else {
          tableData.push({ property: qtoName, value: Number(value).toFixed(2) })
        }
      }
    }

    this.quantitiesTable = BUI.html`
      <bim-table 
        style="width: 100%; height: 400px;"
        .columns=${[
          { header: 'Property', dataField: 'property', width: '50%' },
          { header: 'Value', dataField: 'value', width: '50%' }
        ]}
        .data=${tableData}
      ></bim-table>
    `
  }

  // Delegado para compatibilidad con el método legacy sumQuantities
  private async getQuantityValue(model: any, qtoID: number): Promise<QuantityValue> {
    return getQuantityValueFromModel(model, qtoID)
  }

  /** Método legacy — mantiene compatibilidad con código existente. */
  async sumQuantities(fragmentIdMap: FRAGS.FragmentIdMap): Promise<void> {
    try {
      const fragmentManager = this.components.get(OBC.FragmentsManager)
      const modelIdMap = fragmentManager.getModelIdMap(fragmentIdMap)
      
      for (const modelId in modelIdMap) {
        const model = fragmentManager.groups.get(modelId)
        if (!model || !model.hasProperties) continue

        await OBC.IfcPropertiesUtils.getRelationMap(
          model,
          WEBIFC.IFCRELDEFINESBYPROPERTIES,
          async (setID, relatedIDs) => {
            const expressIDs = modelIdMap[modelId]
            const workingIDs = relatedIDs.filter(id => expressIDs.has(id))
            const set = await model.getProperties(setID)
            const { name: setName } = await OBC.IfcPropertiesUtils.getEntityName(model, setID)
            
            if (set?.type !== WEBIFC.IFCELEMENTQUANTITY || workingIDs.length === 0 || !setName) return
            
            if (!(setName in this.qtoResult)) {
              this.qtoResult[setName] = {}
            }

            await OBC.IfcPropertiesUtils.getQsetQuantities(
              model,
              setID,
              async (qtoID) => {
                const { name: qtoName, value } = await this.getQuantityValue(model, qtoID)
                if (!qtoName || value === null) return
                
                if (!(qtoName in this.qtoResult[setName])) {
                  this.qtoResult[setName][qtoName] = 0
                }
                this.qtoResult[setName][qtoName] += value
              }
            )
          }
        )
      }
      
      this.updateTable()
      this.onQuantitiesComputed.trigger(this.qtoResult)
    } catch (error) {
      console.error('Error in sumQuantities:', error)
      throw error
    }
  }

  /**
   * Calcula y agrupa cantidades para la selección dada.
   *
   * — Modo single (1 expressId único):
   *     Muestra todas las cantidades de la fuente más rica (QTO o Pset).
   *     La clave del resultado incluye el nombre del set y el tipo de fuente,
   *     p. ej. "BaseQuantities [QTO]" o "ePset_SimplebimBasicQuantities [Pset]".
   *
   * — Modo multi (2+ expressIds únicos):
   *     Agrupa por tipo IFC normalizado. Para cada grupo:
   *     · Si todos los elementos eligieron la misma fuente (nombre + tipo):
   *       acumula las cantidades aditivas y etiqueta con la fuente.
   *     · Si hay fuentes mixtas: muestra advertencia "⚠ Fuentes mixtas" sin acumular.
   *     La clave es "IfcTipo ×N — NombreSet [Tipo]" (ej. "IfcWall ×3 — BaseQuantities [QTO]").
   */
  async sumQuantitiesV2(fragmentIdMap: FRAGS.FragmentIdMap): Promise<QtoResult> {
    try {
      this.qtoResult = {}
      const fragmentManager = this.components.get(OBC.FragmentsManager)
      const modelIdMap = fragmentManager.getModelIdMap(fragmentIdMap)
      const indexer = this.components.get(OBC.IfcRelationsIndexer)

      for (const modelId in modelIdMap) {
        const model = fragmentManager.groups.get(modelId)
        if (!model || !model.hasProperties) continue

        // ── 1. Recopilar expressIds únicos, agrupados por tipo IFC (síncrono) ──
        const typeToIds = new Map<string, Set<number>>()
        for (const fragmentID in fragmentIdMap) {
          for (const rawId of fragmentIdMap[fragmentID]) {
            const id = Number(rawId)
            const ifcType = normalizeIfcType(model, id)
            if (!typeToIds.has(ifcType)) typeToIds.set(ifcType, new Set())
            typeToIds.get(ifcType)!.add(id)
          }
        }

        const totalUniqueIds = [...typeToIds.values()].reduce((s, v) => s + v.size, 0)
        const isSingle = totalUniqueIds === 1

        // ── 2a. Modo single: fuente más rica, todas las cantidades ─────────────
        if (isSingle) {
          const expressId = [...typeToIds.values()][0].values().next().value as number
          const source = await getBestQuantitySource(model, indexer, expressId)
          if (!source || source.quantities.size === 0) continue

          const label = `${source.sourceName} [${source.sourceType}]`
          this.qtoResult[label] = {}
          for (const [name, entry] of source.quantities) {
            this.qtoResult[label][name] = entry.value
          }

        // ── 2b. Modo multi: por tipo IFC, verificar uniformidad y acumular ────
        } else {
          for (const [typeName, expressIds] of typeToIds) {
            const sources: QuantitySource[] = []
            for (const expressId of expressIds) {
              const src = await getBestQuantitySource(model, indexer, expressId)
              if (src && src.quantities.size > 0) sources.push(src)
            }

            if (sources.length === 0) continue

            const typeLabel = `${typeName} ×${expressIds.size}`
            const isUniform = sources.every(
              s => s.sourceName === sources[0].sourceName &&
                   s.sourceType === sources[0].sourceType
            )

            if (!isUniform) {
              this.qtoResult[typeLabel] = {
                '⚠ Fuentes mixtas — acumulación no disponible': NaN
              }
              continue
            }

            const { sourceName, sourceType } = sources[0]
            const fullLabel = `${typeLabel} — ${sourceName} [${sourceType}]`
            this.qtoResult[fullLabel] = {}

            for (const source of sources) {
              for (const [name, entry] of source.quantities) {
                const additive = sourceType === 'QTO'
                  ? isAdditiveQty(entry.quantityType ?? 0, name)
                  : isPsetPropertyAdditive(name)
                if (!additive) continue
                this.qtoResult[fullLabel][name] = (this.qtoResult[fullLabel][name] ?? 0) + entry.value
              }
            }

            // Si ninguna cantidad era aditiva, indicarlo sin dejar grupo vacío
            if (Object.keys(this.qtoResult[fullLabel]).length === 0) {
              delete this.qtoResult[fullLabel]
              this.qtoResult[typeLabel] = { '(sin cantidades aditivas)': NaN }
            }
          }
        }
      }

      this.updateTable()
      this.onQuantitiesComputed.trigger(this.qtoResult)
      return this.qtoResult
    } catch (error) {
      console.error('Error in sumQuantitiesV2:', error)
      throw error
    }
  }

  async dispose(): Promise<void> {
    this.enabled = false
    this.resetQuantities()
  }
}
