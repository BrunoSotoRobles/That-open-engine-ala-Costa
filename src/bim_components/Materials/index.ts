import * as WEBIFC from "web-ifc"
import * as OBC from "@thatopen/components"
import * as FRAGS from "@thatopen/fragments"
import * as BUI from "@thatopen/ui"
import { render } from 'lit-html'

type MaterialQtoResult = {[materialName: string]: {[qtoName: string]: number}}

interface TableRow {
  property: string;
  value: string | number;
  isHeader?: boolean;
}

export class MaterialQTO extends OBC.Component implements OBC.Disposable {
  static uuid = "11037950-ebc6-43f4-b31c-d4487aa808c1"
  enabled = true
  onDisposed: OBC.Event<any>
  private _materialQtoResult: MaterialQtoResult = {}
  materialQuantitiesTable: any
  onMaterialQuantitiesComputed = new OBC.Event<MaterialQtoResult>()

  constructor(components: OBC.Components) {
    super(components)
    this.components.add(MaterialQTO.uuid, this)
    
    console.log('[MaterialQTO] Initializing table...')
    
    // Create a container div for the table
    const container = document.createElement('div')
    container.id = 'material-qto-table'
    
    // Render the table into the container
    const tableTemplate = BUI.html`
      <bim-table 
        style="width: 100%; height: 400px;"
        .columns=${[
          { header: 'Property', dataField: 'property', width: '50%' },
          { header: 'Value', dataField: 'value', width: '50%' }
        ]}
        .data=${[]}
      ></bim-table>
    `
    render(tableTemplate, container)
    
    // Store the actual table element
    this.materialQuantitiesTable = container.querySelector('bim-table')
    console.log('[MaterialQTO] Table element:', this.materialQuantitiesTable)
  }

  resetMaterialQuantities() {
    console.log('[MaterialQTO] Resetting quantities')
    this._materialQtoResult = {}
  }

  private updateMaterialTable() {
    console.log('[MaterialQTO] Starting table update...')
    console.log('[MaterialQTO] Current material results:', this._materialQtoResult)
    
    const tableData: TableRow[] = []
    
    for (const setName in this._materialQtoResult) {
      tableData.push({
        property: setName,
        value: '',
        isHeader: true
      })

      const properties = this._materialQtoResult[setName]
      for (const qtoName in properties) {
        const value = properties[qtoName]
        if (value !== null && !isNaN(value)) {
          tableData.push({
            property: qtoName,
            value: Number(value).toFixed(2)
          })
        }
      }
    }

    console.log('[MaterialQTO] Generated table data:', tableData)
    console.log('[MaterialQTO] Current table instance:', this.materialQuantitiesTable)
    
    try {
      this.materialQuantitiesTable.data = tableData
      console.log('[MaterialQTO] Table data updated successfully')
    } catch (error) {
      console.error('[MaterialQTO] Error updating table data:', error)
    }
  }

  async calculateMaterialQuantities(fragmentIdMap: FRAGS.FragmentIdMap) {
    console.log('[MaterialQTO] Starting material quantity calculation...')
    console.log('[MaterialQTO] Fragment ID Map:', fragmentIdMap)
    
    return new Promise<MaterialQtoResult>(async (resolve) => {
      this._materialQtoResult = {};
      
      const fragmentManager = this.components.get(OBC.FragmentsManager)
      const modelIdMap = fragmentManager.getModelIdMap(fragmentIdMap)
      
      console.log('[MaterialQTO] Model ID Map:', modelIdMap)
      
      for (const modelId in modelIdMap) {
        const model = fragmentManager.groups.get(modelId)
        if (!model || !model.hasProperties) {
          console.log('[MaterialQTO] Skipping model, no properties:', modelId)
          continue;
        }

        console.log('[MaterialQTO] Processing model:', modelId)

        for (const fragmentID in fragmentIdMap) {
          const expressIDs = fragmentIdMap[fragmentID]
          const indexer = this.components.get(OBC.IfcRelationsIndexer)
          
          for (const id of expressIDs) {
            // Get material information
            const materials = indexer.getEntityRelations(model, id, "HasAssociations")
            if (!materials) {
              console.log('[MaterialQTO] No material associations found for ID:', id)
              continue;
            }

            console.log('[MaterialQTO] Found material associations:', materials)

            for (const materialId of materials) {
              const material = await model.getProperties(materialId)
              if (!material) {
                console.log('[MaterialQTO] No material properties found for:', materialId)
                continue;
              }
              
              console.log('[MaterialQTO] Processing material:', material)
              
              // Get the material layer set
              let materialSet
              if (material.type === WEBIFC.IFCRELASSOCIATESMATERIAL) {
                materialSet = material.RelatingMaterial.value
                console.log('[MaterialQTO] Found material set from IFCRELASSOCIATESMATERIAL:', materialSet)
              } else if (material.ForLayerSet) {
                materialSet = material.ForLayerSet.value
                console.log('[MaterialQTO] Found material set from ForLayerSet:', materialSet)
              } else if (material.MaterialConstituents) {
                // Handle composite materials
                console.log('[MaterialQTO] Found material constituents:', JSON.stringify(material.MaterialConstituents, null, 2))
                console.log('[MaterialQTO] Full material object:', JSON.stringify(material, null, 2))
                
                // Get all property sets for the element
                const propertySets = indexer.getEntityRelations(model, id, "IsDefinedBy")
                if (!propertySets) {
                  console.log('[MaterialQTO] No property sets found for ID:', id)
                  continue;
                }

                // Get element type to check if it's a roof
                const element = await model.getProperties(id);
                const isRoof = element?.type === WEBIFC.IFCROOF;
                console.log('[MaterialQTO] Element type check:', {
                  elementId: id,
                  type: element?.type,
                  isRoof
                });

                // Variables to store element properties
                let totalElementVolume = 0;
                let elementArea = 0;
                let layerThicknesses = new Map();
                
                // First get all the element properties
                for (const propertySetId of propertySets) {
                  const propertySet = await model.getProperties(propertySetId)
                  console.log('[MaterialQTO] Property set:', propertySet)

                  if (propertySet?.type === WEBIFC.IFCELEMENTQUANTITY) {
                    const quantities = propertySet.Quantities;
                    if (!quantities) continue;

                    for (const quantity of quantities) {
                      const qto = await model.getProperties(quantity.value);
                      if (!qto) continue;
                      console.log('[MaterialQTO] Quantity:', qto);

                      // Extract the quantity name
                      const qtoName = qto.Name?.value;
                      console.log('[MaterialQTO] Quantity name:', qtoName);

                      if (qto.type === WEBIFC.IFCQUANTITYAREA && qto.AreaValue?.value !== undefined) {
                        // Use IfcPropertiesUtils for automatic unit conversion based on model units
                        try {
                          const { value } = await OBC.IfcPropertiesUtils.getQuantityValue(model, quantity.value);
                          if (value !== null && value !== undefined) {
                            elementArea = value; // Already converted to correct units by IfcPropertiesUtils
                          } else {
                            elementArea = qto.AreaValue.value; // Use raw value if conversion not available
                          }
                        } catch (e) {
                          elementArea = qto.AreaValue.value; // Use raw value if conversion fails (assumes model units are correct)
                        }
                        console.log('[MaterialQTO] Found element area:', elementArea);
                      } else if (qto.type === WEBIFC.IFCQUANTITYVOLUME && qto.VolumeValue?.value !== undefined) {
                        // Use IfcPropertiesUtils for automatic unit conversion based on model units
                        try {
                          const { value } = await OBC.IfcPropertiesUtils.getQuantityValue(model, quantity.value);
                          if (value !== null && value !== undefined) {
                            totalElementVolume = value; // Already converted to correct units by IfcPropertiesUtils
                          } else {
                            totalElementVolume = qto.VolumeValue.value; // Use raw value if conversion not available
                          }
                        } catch (e) {
                          totalElementVolume = qto.VolumeValue.value; // Use raw value if conversion fails (assumes model units are correct)
                        }
                        console.log('[MaterialQTO] Found element volume:', totalElementVolume);
                      } else if (qto.type === WEBIFC.IFCQUANTITYLENGTH && qto.LengthValue?.value !== undefined) {
                        // Use IfcPropertiesUtils for automatic unit conversion based on model units
                        let lengthValue;
                        try {
                          const { value } = await OBC.IfcPropertiesUtils.getQuantityValue(model, quantity.value);
                          if (value !== null && value !== undefined) {
                            lengthValue = value; // Already converted to correct units by IfcPropertiesUtils
                          } else {
                            lengthValue = qto.LengthValue.value; // Use raw value if conversion not available
                          }
                        } catch (e) {
                          lengthValue = qto.LengthValue.value; // Use raw value if conversion fails (assumes model units are correct)
                        }
                        console.log('[MaterialQTO] Found length value:', {
                          name: qtoName,
                          value: lengthValue
                        });
                        
                        // Store length values that might be thicknesses
                        if (qtoName) {
                          const lowerName = qtoName.toLowerCase();
                          if (lowerName.includes('thickness') || 
                              lowerName.includes('width') || 
                              lowerName.includes('layer') ||
                              lowerName.includes('paksuus')) {
                            layerThicknesses.set(qtoName, lengthValue);
                            console.log('[MaterialQTO] Found thickness:', {
                              name: qtoName,
                              value: lengthValue
                            });
                          }
                        }
                      } else if (qto.type === 3021840470) { // IFCQUANTITYSET for layers
                        console.log('[MaterialQTO] Found layer quantity set:', {
                          name: qtoName,
                          quantities: qto.HasQuantities
                        });
                        
                        // Extract quantities from the layer set
                        if (qto.HasQuantities && qtoName) {
                          for (const quantityRef of qto.HasQuantities) {
                            const layerQuantity = await model.getProperties(quantityRef.value);
                            console.log('[MaterialQTO] Layer quantity:', layerQuantity);
                            
                            if (layerQuantity?.type === WEBIFC.IFCQUANTITYLENGTH) {
                              // Use IfcPropertiesUtils for automatic unit conversion based on model units
                              let layerThickness;
                              try {
                                const { value } = await OBC.IfcPropertiesUtils.getQuantityValue(model, quantityRef.value);
                                if (value !== null && value !== undefined) {
                                  layerThickness = value; // Already converted to correct units by IfcPropertiesUtils
                                } else {
                                  layerThickness = layerQuantity.LengthValue?.value || 0; // Use raw value if conversion not available
                                }
                              } catch (e) {
                                layerThickness = layerQuantity.LengthValue?.value || 0; // Use raw value if conversion fails (assumes model units are correct)
                              }
                              if (layerThickness !== undefined && layerThickness !== null) {
                                layerThicknesses.set(qtoName, layerThickness);
                                console.log('[MaterialQTO] Found layer thickness:', {
                                  layer: qtoName,
                                  thickness: layerThickness
                                });
                              }
                            }
                          }
                        }
                      }
                    }
                  } else if (propertySet?.type === WEBIFC.IFCPROPERTYSET) {
                    // Look for layer information in property set
                    const properties = propertySet.HasProperties;
                    if (!properties) continue;

                    for (const prop of properties) {
                      const property = await model.getProperties(prop.value);
                      if (!property) continue;
                      
                      // Extract and log the property name and value
                      const propName = property.Name?.value;
                      const propValue = property.NominalValue?.value;
                      
                      console.log('[MaterialQTO] Found property:', {
                        name: propName,
                        value: propValue,
                        type: property.type
                      });

                      // Store thickness values if found
                      if (propName && propValue !== undefined) {
                        const lowerName = propName.toLowerCase();
                        if (lowerName.includes('thickness') || 
                            lowerName.includes('width') || 
                            lowerName.includes('layer') ||
                            lowerName.includes('paksuus')) {  // Finnish for thickness
                          layerThicknesses.set(propName, propValue);
                          console.log('[MaterialQTO] Found thickness property:', {
                            name: propName,
                            value: propValue
                          });
                        }
                      }
                    }
                  }
                }

                // Process material constituents
                const constituents: Array<{materialName: string, volume: number, thickness?: number}> = [];
                let totalThickness = 0;
                let totalProcessedVolume = 0;

                // First, get all constituents and their properties
                for (const constituent of material.MaterialConstituents) {
                  console.log('[MaterialQTO] Processing constituent:', JSON.stringify(constituent, null, 2));
                  
                  const constituentMaterial = await model.getProperties(constituent.value);
                  if (!constituentMaterial) continue;
                  
                  const { name: materialName } = await OBC.IfcPropertiesUtils.getEntityName(model, constituentMaterial.Material.value);
                  if (!materialName) continue;

                  // Try to find thickness for this material
                  let thickness: number | undefined;
                  for (const [propName, value] of layerThicknesses.entries()) {
                    const lowerPropName = propName.toLowerCase();
                    const lowerMaterialName = materialName.toLowerCase();
                    
                    // Try different matching strategies
                    if (lowerPropName === lowerMaterialName || // Exact match
                        lowerPropName.includes(lowerMaterialName) || 
                        lowerMaterialName.includes(lowerPropName)) {
                      thickness = value;
                      totalThickness += value;
                      console.log(`[MaterialQTO] Found thickness for ${materialName}:`, {
                        propName,
                        thickness,
                        matchStrategy: lowerPropName === lowerMaterialName ? 'exact match' :
                                     lowerPropName.includes(lowerMaterialName) ? 'material name in property' :
                                     'property name in material'
                      });
                      break;
                    }
                  }

                  constituents.push({
                    materialName,
                    volume: 0, // Will calculate after getting all thicknesses
                    thickness
                  });
                }

                // Check if this is a sloped roof element
                if (isRoof && elementArea > 0 && totalThickness === 0) {
                  // For sloped roofs without thickness, use default 200mm thickness
                  totalThickness = 0.2; // 200mm in meters
                  totalElementVolume = elementArea * totalThickness;
                  console.log('[MaterialQTO] Roof element detected, using default values:', {
                    area: elementArea,
                    defaultThickness: totalThickness,
                    calculatedVolume: totalElementVolume
                  });
                }

                // Calculate volumes based on thicknesses if available
                if (totalThickness > 0) {
                  console.log('[MaterialQTO] Using thickness-based volume calculation. Total thickness:', totalThickness);
                  for (const constituent of constituents) {
                    if (constituent.thickness) {
                      // Calculate volume based on proportion of total thickness
                      constituent.volume = totalElementVolume * (constituent.thickness / totalThickness);
                      console.log(`[MaterialQTO] Calculated volume for ${constituent.materialName}:`, {
                        thickness: constituent.thickness,
                        proportion: constituent.thickness / totalThickness,
                        volume: constituent.volume
                      });
                    } else {
                      // Fallback to equal distribution for materials without thickness
                      constituent.volume = totalElementVolume / constituents.length;
                      console.log(`[MaterialQTO] Using equal distribution for ${constituent.materialName} (no thickness found):`, constituent.volume);
                    }
                    totalProcessedVolume += constituent.volume;
                  }
                } else {
                  // If no thicknesses found, use equal distribution
                  console.log('[MaterialQTO] No thicknesses found, using equal distribution');
                  const equalVolume = totalElementVolume / constituents.length;
                  for (const constituent of constituents) {
                    constituent.volume = equalVolume;
                    totalProcessedVolume += equalVolume;
                  }
                }

                // Update material results
                if (constituents.length > 0) {
                  for (const { materialName, volume } of constituents) {
                    if (!(materialName in this._materialQtoResult)) {
                      this._materialQtoResult[materialName] = {};
                    }
                    // Instead of adding to existing volume, we set it directly
                    this._materialQtoResult[materialName]["NetVolume"] = volume;
                    
                    console.log(`[MaterialQTO] Set volume for ${materialName}:`, this._materialQtoResult[materialName]["NetVolume"]);
                  }
                }
                continue;
              }

              if (!materialSet) {
                console.log('[MaterialQTO] No material set found')
                continue;
              }

              // Get the actual material layers
              const materialLayers = await model.getProperties(materialSet)
              if (!materialLayers) {
                console.log('[MaterialQTO] No material layers found for set:', materialSet)
                continue;
              }

              console.log('[MaterialQTO] Material layers:', materialLayers)

              // Get material layer information
              const materialLayerSet = await model.getProperties(materialLayers.MaterialLayers?.[0]?.value)
              if (!materialLayerSet) {
                console.log('[MaterialQTO] No material layer set found')
                continue;
              }

              console.log('[MaterialQTO] Material layer set:', materialLayerSet)

              const { name: materialName } = await OBC.IfcPropertiesUtils.getEntityName(model, materialLayerSet.Material.value)
              if (!materialName) {
                console.log('[MaterialQTO] No material name found')
                continue;
              }

              console.log('[MaterialQTO] Found material:', materialName)

              // Initialize material in results if not exists
              if (!(materialName in this._materialQtoResult)) {
                this._materialQtoResult[materialName] = {}
                console.log('[MaterialQTO] Initialized new material in results:', materialName)
              }

              // Get volume from quantities
              const sets = indexer.getEntityRelations(model, id, "IsDefinedBy")
              if (!sets) {
                console.log('[MaterialQTO] No quantity sets found for ID:', id)
                continue;
              }

              console.log('[MaterialQTO] Found quantity sets:', sets)

              for (const expressID of sets) {
                const set = await model.getProperties(expressID)
                if (set?.type !== WEBIFC.IFCELEMENTQUANTITY) {
                  console.log('[MaterialQTO] Set is not an IFCELEMENTQUANTITY:', set?.type)
                  continue;
                }

                console.log('[MaterialQTO] Processing quantity set:', set)

                await OBC.IfcPropertiesUtils.getQsetQuantities(
                  model,
                  expressID,
                  async (qtoID) => {
                    const { name: qtoName } = await OBC.IfcPropertiesUtils.getEntityName(model, qtoID)
                    if (qtoName !== "NetVolume" && qtoName !== "GrossVolume") {
                      console.log('[MaterialQTO] Skipping non-volume quantity:', qtoName)
                      return;
                    }

                    const { value } = await OBC.IfcPropertiesUtils.getQuantityValue(model, qtoID)
                    if (value === null) {
                      console.log('[MaterialQTO] No value found for quantity:', qtoName)
                      return;
                    }
                    
                    // Sum the volume to the existing value or initialize it
                    this._materialQtoResult[materialName][qtoName] = 
                      (this._materialQtoResult[materialName][qtoName] || 0) + value;
                    
                    console.log(`[MaterialQTO] Updated ${materialName} ${qtoName}:`, this._materialQtoResult[materialName][qtoName])
                  }
                )
              }
            }
          }
        }
      }

      console.log('[MaterialQTO] Final material results:', this._materialQtoResult)
      await this.updateMaterialTable();
      this.onMaterialQuantitiesComputed.trigger(this._materialQtoResult);
      resolve(this._materialQtoResult);
    });
  }

  async dispose() {
    this.enabled = false
    this.resetMaterialQuantities()
  }
}