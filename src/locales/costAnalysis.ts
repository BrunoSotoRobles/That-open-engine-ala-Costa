type Language = 'en' | 'fi';

interface TranslationTree {
  [key: string]: string | TranslationTree;
}

interface CostTranslations {
  en: TranslationTree;
  fi: TranslationTree;
}

export const costAnalysisTranslations: CostTranslations = {
  en: {
    pageTitle: 'Quantities & Cost',
    projectInfo: {
      title: 'Project Information',
      name: 'Name',
      area: 'Area',
      areaBrutto: 'Gross area (brm²)',
      huoneistoala: 'Apartment area (hm²)',
      location: 'Location',
      buildingType: 'Type of Building',
      constructionType: 'Type of Construction',
      constructionMethod: 'Construction Method'
    },
    constructionMethods: {
      traditional: 'Traditional',
      prefabricated: 'Prefabricated',
      modular: 'Modular',
      renovation: 'Renovation',
      onSite: 'On-Site',
      other: 'Construction Method'
    },
    locations: {
      helsinki: 'Helsinki',
      tampere: 'Tampere',
      oulu: 'Oulu',
      other: 'Location'
    },
    noDataMessage: 'No cost data available',
    noDataMessageFi: 'Load an IFC in CostaBIM, then use Cost → Send to Quantities & Cost in the viewer toolbar.',
    emptyState: {
      intro: 'To use Quantities & Cost for construction cost estimation, please:',
      step1Title: '1. Load IFC model',
      step1Text:
        'Upload or load an IFC model with detailed building elements and quantities.',
      step2Title: '2. Send quantities',
      step2Text:
        'In the CostaBIM viewer: Cost (toolbar) → Send to Quantities & Cost.',
      step3Title: '3. Analyze costs',
      step3Text:
        'View cost breakdowns and generate detailed quantity reports.',
      infoTitle: 'Finnish cost calculation',
      infoText:
        'Uses Finnish construction standards (TALO 2000, RT-kortti, Littera) and regional factors for accurate estimates in Finland.',
      loading: 'Loading cost data...',
    },
    actions: {
      loadSample: 'Load Sample Data',
      calculate: 'Calculate Costs',
      export: 'Export Data',
      select: 'Select',
      deleteSelected: 'Delete selected',
      deleteSelectedConfirm: 'Remove {count} element(s) from the list? They will be excluded from calculations and Excel export.',
      deleteSelectedTitle: 'Delete selected rows',
      addLittera: 'Add Littera...',
      add: 'Add...',
      applyToGroup: 'Apply to group',
      group: 'Group',
      individual: 'Individual',
      close: 'Close',
      removeCode: 'Remove code',
      code: 'code',
      codes: 'codes',
      noLitteraAvailable: 'No Littera codes available',
      noLitteraAssigned: 'No Littera codes assigned',
      noTaloSuggestions: 'No TALO suggestions (assign manually)'
    },
    headerButtons: {
      downloadExcel: 'Excel',
      downloadExcelTitle: 'Download current Quantity Calculation (.xlsx). Edit costs in "Measurement Data" sheet and re-import.',
      uploadExcel: 'Excel',
      uploadExcelTitle: 'Upload edited Excel (.xlsx, .xls, .csv). Reads from "Measurement Data" or "Sync" sheet by GUID. Only costs and codes are updated.',
      libraryUpload: 'Library',
      libraryUploadTitle: 'Upload Littera/Cost library (.json). TALO + type + name → Littera + costs.',
      libraryDownload: 'Library',
      libraryDownloadTitle: 'Download Littera/Cost library (.json). Reusable database.',
      libraryApply: 'Apply',
      libraryApplyTitle: 'Apply Littera/Cost library to matching elements (TALO + type + name). Assigns Littera codes and costs.'
    },
    syncImport: {
      resultTitle: 'Import result',
      rowsUpdated: 'rows updated by GUID',
      rowsIgnored: 'rows ignored (GUID not found in model)',
      guidNotFound: 'GUID not found in model',
      close: 'Close',
      noDataError: 'No cost data in model. Load an IFC and extract data first.',
      noSheetError: 'No sheet found in file.',
      noDataRowsError: 'File has no data rows (header only or empty).',
      missingGuidColumnError: 'Missing required column "GUID" in file.',
      invalidLitteraJsonError: 'LitteraCodes is not valid JSON, existing values kept.',
      fileReadError: 'Error reading file.'
    },
    errors: {
      invalidTaloCode: 'Invalid TALO code. Expected format: X.X.X.X and it must exist in Hankenimikkeisto.'
    },
    costTypes: {
      material: 'Material',
      labor: 'Labor',
      subcontract: 'Subcontract',
      aliurakka: 'Aliurakka', // legacy key, same as subcontract in FI
      total: 'Total'
    },
    analysisSections: {
      summary: 'Cost Summary',
      breakdown: 'Cost Breakdown',
      details: 'Detailed Analysis',
      analysis: 'Cost Analysis'
    },
    buildingTypes: {
      residential: 'Residential',
      office: 'Office',
      commercial: 'Commercial',
      industrial: 'Industrial',
      other: 'Type of Building'
    },
    metrics: {
      costPerArea: 'Cost per Area',
      laborCostRatio: 'Labor vs Subcontract – Cost share',
      materialCostRatio: 'Material Cost Ratio',
      subcontractCostRatio: 'Labor vs Subcontract – Quantity share',
      aliurakkaCostRatio: 'Aliurakka Cost Ratio', // legacy
      buildingServicesEstimate: 'MEP / LVIS Cost (Estimate)'
    },
    buildingServices: {
      projectType: 'Project type',
      grossArea: 'Gross area',
      shareOfModel: 'Share of current model',
      roughEstimate: 'rough estimate',
      totalEstimated: 'Total estimated MEP / LVIS cost',
      note: 'This card provides a rough estimate of MEP / LVIS (technical building services) costs based on the current model. Adjust the percentage according to your own experience and project type.'
    },
    projectTypes: {
      residential: 'Apartment building / residential project',
      commercial: 'Office / commercial building',
      industrial: 'Industrial / special building',
      infrastructure: 'Infrastructure'
    },
    tableHeaders: {
      code: 'TALO Code',
      name: 'Element Name',
      type: 'Type',
      quantity: 'Quantity',
      unit: 'Unit',
      baseQuantities: 'Base Quantities',
      totalQuantity: 'Total Quantity',
      count: 'Count',
      description: 'Description',
      total: 'Total',
      variants: 'variants',
      viewVariants: 'View variants'
    },
    units: {
      currency: '€',
      area: 'm²',
      volume: 'm³',
      length: 'm',
      pieces: 'pcs'
    },
    breakdownNotes: {
      laborVsSubCost:
        'Shows how total labor and subcontract costs are distributed within all work costs (labor + subcontract). External MEP / LVIS costs entered outside the model are not included.',
      laborVsSubQty:
        'Compares labor vs subcontract share based on measured quantities (area, volume, count), not on costs. External MEP / LVIS quantities outside the model are not included.'
    },
    comparison: {
      title: {
        en: 'Cost Comparison with Finnish Building Standards',
        fi: 'Kustannusvertailu suomalaisten rakennusstandardien kanssa'
      },
      yourProject: {
        en: 'Your Project',
        fi: 'Sinun projektisi'
      },
      finnishAverage: {
        en: 'Finnish Average',
        fi: 'Suomen keskiarvo'
      },
      note: {
        en: 'Reference Data',
        fi: 'Viitetiedot'
      },
      noteData: {
        en: 'Based on Finnish Construction Cost Index',
        fi: 'Perustuu Suomen rakennuskustannusindeksiin'
      },
      noteRange: {
        en: 'Typical cost range',
        fi: 'Tyypillinen kustannusalue'
      },
      noteLocation: {
        en: 'Costs may vary by region and specific project requirements',
        fi: 'Kustannukset voivat vaihdella alueittain ja projektikohtaisesti'
      },
      perBrm2: '€/m² (brm²)',
      perHm2: '€/hm²'
    },
    schedule: {
      title: 'Construction Schedule',
      startDate: 'Start Date',
      endDate: 'End Date',
      duration: 'Total Duration',
      workers: 'Workers',
      equipment: 'Equipment',
      criticalPath: 'Critical Path',
      note: 'Note: This schedule is an estimate based on Finnish construction standards and may vary depending on several factors:',
      noteWeather: 'Weather conditions and seasonal adjustments',
      noteResources: 'Resource availability and allocation',
      notePermits: 'Permit processing times and local regulations'
    },
    phases: {
      preparation: 'Site Preparation',
      foundation: 'Foundation',
      structure: 'Structure',
      envelope: 'Building Envelope',
      interior: 'Interior Works',
      mep: 'MEP Systems',
      finishes: 'Finishes'
    },
    export: {
      ifcTaskTitle: 'IFC Task Export',
      ifcTaskDescription: 'Export IFC-compatible task schedule data',
      ifcTaskDetails: 'Generate comprehensive IFC task schedule data that can be imported into BIM software for 4D construction planning and project management. The export includes detailed resource allocation, cost breakdowns, and Finnish TALO 2000 classification codes.',
      readyToExport: 'Ready to Export',
      exportDescription: 'Export IFC task schedule data in multiple formats for BIM integration and project management',
      exportButton: 'Export IFC Tasks'
    },
    littera: {
      ifcSourceTooltip: 'Littera code imported from IFC (Pset_Talo 2000 property).',
      suggestionTooltip: 'Littera code suggested by the system based on TALO/element type. You can edit or replace it.'
    }
  },
  fi: {
    pageTitle: 'Määrät ja kustannus',
    projectInfo: {
      title: 'Projektin tiedot',
      name: 'Nimi',
      area: 'Pinta-ala',
      areaBrutto: 'Bruttopinta-ala (brm²)',
      huoneistoala: 'Huoneistoala (hm²)',
      location: 'Sijainti',
      buildingType: 'Rakennustyyppi',
      constructionType: 'Rakentamistapa',
      constructionMethod: 'Rakennusmenetelmä'
    },
    constructionMethods: {
      traditional: 'Perinteinen',
      prefabricated: 'Esivalmistettu',
      modular: 'Modulaarinen',
      renovation: 'Saneeraus',
      onSite: 'Paikan päällä',
      other: 'Rakennusmenetelmä'
    },
    locations: {
      helsinki: 'Helsinki',
      tampere: 'Tampere',
      oulu: 'Oulu',
      other: 'Sijainti'
    },
    noDataMessage: 'Kustannustietoja ei ole saatavilla',
    noDataMessageFi: 'Lataa IFC CostaBIMissä ja käytä työkalupalkissa Cost → Lähetä määrille ja kustannukselle.',
    emptyState: {
      intro: 'Käyttääksesi määrä- ja kustannuslaskentaa, toimi näin:',
      step1Title: '1. Lataa IFC-malli',
      step1Text:
        'Avaa tai lataa IFC-malli, jossa on rakennusosat ja määrätiedot.',
      step2Title: '2. Lähetä määrät',
      step2Text:
        'CostaBIM-katseluohjelmassa: Cost (työkalupalkki) → Lähetä määrille ja kustannukselle.',
      step3Title: '3. Analysoi kustannukset',
      step3Text:
        'Tarkastele kustannuserittelyä ja luo määräluetteloita.',
      infoTitle: 'Suomalainen kustannuslaskenta',
      infoText:
        'Perustuu suomalaisiin standardeihin (TALO 2000, RT-kortti, Littera) ja alueellisiin tekijöihin tarkkoja arvioita varten.',
      loading: 'Ladataan kustannustietoja...',
    },
    actions: {
      loadSample: 'Lataa esimerkkidata',
      calculate: 'Laske kustannukset',
      export: 'Vie data',
      select: 'Valitse',
      deleteSelected: 'Poista valitut',
      deleteSelectedConfirm: 'Poistetaanko {count} elementti(ä) listasta? Ne jätetään pois laskennasta ja Excel-viennistä.',
      deleteSelectedTitle: 'Poista valitut rivit',
      addLittera: 'Lisää Littera...',
      add: 'Lisää...',
      applyToGroup: 'Käytä ryhmään',
      group: 'Ryhmä',
      individual: 'Yksittäinen',
      close: 'Sulje',
      removeCode: 'Poista koodi',
      code: 'koodi',
      codes: 'koodit',
      noLitteraAvailable: 'Littera-koodeja ei saatavilla',
      noLitteraAssigned: 'Littera-koodeja ei ole määritetty',
      noTaloSuggestions: 'Ei TALO-ehdotuksia (määritä käsin)'
    },
    headerButtons: {
      downloadExcel: 'Excel',
      downloadExcelTitle: 'Lataa nykyinen määrälaskenta (.xlsx). Muokkaa kustannuksia "Measurement Data" -arkissa ja tuo uudelleen.',
      uploadExcel: 'Excel',
      uploadExcelTitle: 'Lataa muokattu Excel (.xlsx, .xls, .csv). Lukee "Measurement Data" tai "Sync" -arkista GUID:n mukaan. Vain kustannukset ja koodit päivitetään.',
      libraryUpload: 'Kirjasto',
      libraryUploadTitle: 'Lataa Littera/kustannuskirjasto (.json). TALO + tyyppi + nimi → Littera + kustannukset.',
      libraryDownload: 'Kirjasto',
      libraryDownloadTitle: 'Lataa Littera/kustannuskirjasto (.json). Uudelleenkäytettävä tietokanta.',
      libraryApply: 'Käytä',
      libraryApplyTitle: 'Käytä Littera/kustannuskirjasto vastaaviin elementteihin (TALO + tyyppi + nimi). Määrittää Littera-koodit ja kustannukset.'
    },
    syncImport: {
      resultTitle: 'Tuloksen tuonti',
      rowsUpdated: 'riviä päivitetty GUID:n mukaan',
      rowsIgnored: 'riviä jätetty huomiotta (GUID ei löytynyt mallista)',
      guidNotFound: 'GUID ei löytynyt mallista',
      close: 'Sulje',
      noDataError: 'Mallissa ei ole kustannustietoja. Lataa IFC ja poimi tiedot ensin.',
      noSheetError: 'Tiedostosta ei löytynyt arkkia.',
      noDataRowsError: 'Tiedostossa ei ole tietorivejä (vain otsikko tai tyhjä).',
      missingGuidColumnError: 'Pakollinen sarake "GUID" puuttuu tiedostosta.',
      invalidLitteraJsonError: 'LitteraCodes ei ole kelvollinen JSON, olemassa olevat arvot säilytetään.',
      fileReadError: 'Virhe tiedoston lukemisessa.'
    },
    errors: {
      invalidTaloCode: 'Virheellinen TALO-koodi. Odotettu muoto: X.X.X.X ja sen on oltava Hankenimikkeistossa.'
    },
    costTypes: {
      material: 'Materiaali',
      labor: 'Työ',
      subcontract: 'Aliurakka',
      aliurakka: 'Aliurakka', // legacy key
      total: 'Yhteensä'
    },
    analysisSections: {
      summary: 'Kustannusyhteenveto',
      breakdown: 'Kustannuserittely',
      details: 'Yksityiskohtainen analyysi',
      analysis: 'Kustannusanalyysi'
    },
    buildingTypes: {
      residential: 'Asuinrakennus',
      office: 'Toimistorakennus',
      commercial: 'Liikerakennus',
      industrial: 'Teollisuusrakennus',
      other: 'Rakennustyyppi'
    },
    metrics: {
      costPerArea: 'Kustannus pinta-alaa kohden',
      laborCostRatio: 'Työ vs aliurakka – kustannusosuus',
      materialCostRatio: 'Materiaalikustannusosuus',
      subcontractCostRatio: 'Työ vs aliurakka – määrien osuus',
      aliurakkaCostRatio: 'Aliurakakustannusosuus', // legacy
      buildingServicesEstimate: 'Talotekniikka (LVIS) – karkea arvio'
    },
    buildingServices: {
      projectType: 'Projektityyppi',
      grossArea: 'Bruttoala',
      shareOfModel: 'Osuus nykyisestä mallista',
      roughEstimate: 'karkea arvio',
      totalEstimated: 'Arvioitu talotekniikka (LVIS) yhteensä',
      note: 'Tämä kortti antaa karkean arvion talotekniikan (LVIS) kustannuksista nykyisen mallin perusteella. Säädä prosenttia oman kokemuksesi ja hanketyypin mukaan.'
    },
    projectTypes: {
      residential: 'Asuinkerrostalo / asuntokohde',
      commercial: 'Toimisto / liikerakennus',
      industrial: 'Teollisuus / erityiskohde',
      infrastructure: 'Infrarakentaminen'
    },
    tableHeaders: {
      code: 'TALO-koodi',
      name: 'Elementin nimi',
      type: 'Tyyppi',
      quantity: 'Määrä',
      unit: 'Yksikkö',
      baseQuantities: 'Perusmäärät',
      totalQuantity: 'Kokonaismäärä',
      count: 'Lukumäärä',
      description: 'Kuvaus',
      total: 'Yhteensä',
      variants: 'varianttia',
      viewVariants: 'Näytä variantit'
    },
    units: {
      currency: '€',
      area: 'm²',
      volume: 'm³',
      length: 'm',
      pieces: 'kpl'
    },
    breakdownNotes: {
      laborVsSubCost:
        'Näyttää, miten työkustannukset ja aliurakkakustannukset jakautuvat kaikista työn kustannuksista (työ + aliurakka). Mallin ulkopuolelta syötetyt talotekniikan (LVIS) kustannukset eivät sisälly tähän.',
      laborVsSubQty:
        'Vertaa työn ja aliurakan osuutta mitattujen määrien (pinta-ala, tilavuus, lukumäärä) perusteella, ei kustannusten perusteella. Mallin ulkopuoliset talotekniikan (LVIS) määrät eivät sisälly tähän.'
    },
    comparison: {
      title: {
        en: 'Cost Comparison with Finnish Building Standards',
        fi: 'Kustannusvertailu suomalaisten rakennusstandardien kanssa'
      },
      yourProject: {
        en: 'Your Project',
        fi: 'Sinun projektisi'
      },
      finnishAverage: {
        en: 'Finnish Average',
        fi: 'Suomen keskiarvo'
      },
      note: {
        en: 'Reference Data',
        fi: 'Viitetiedot'
      },
      noteData: {
        en: 'Based on Finnish Construction Cost Index',
        fi: 'Perustuu Suomen rakennuskustannusindeksiin'
      },
      noteRange: {
        en: 'Typical cost range',
        fi: 'Tyypillinen kustannusalue'
      },
      noteLocation: {
        en: 'Costs may vary by region and specific project requirements',
        fi: 'Kustannukset voivat vaihdella alueittain ja projektikohtaisesti'
      },
      perBrm2: '€/m² (brm²)',
      perHm2: '€/hm²'
    },
    schedule: {
      title: 'Rakentamisaikataulu',
      startDate: 'Aloituspäivä',
      endDate: 'Lopetuspäivä',
      duration: 'Kokonaiskesto',
      workers: 'Työntekijät',
      equipment: 'Kalusto',
      criticalPath: 'Kriittinen polku',
      note: 'Huom: Tämä aikataulu on arvio, joka perustuu suomalaisiin rakennusstandardeihin ja voi vaihdella useiden tekijöiden mukaan:',
      noteWeather: 'Sääolosuhteet ja vuodenaikavaihtelut',
      noteResources: 'Resurssien saatavuus ja kohdentaminen',
      notePermits: 'Lupakäsittelyajat ja paikalliset määräykset'
    },
    phases: {
      preparation: 'Pohjatyöt',
      foundation: 'Perustukset',
      structure: 'Runko',
      envelope: 'Ulkovaippa',
      interior: 'Sisätyöt',
      mep: 'LVIS-järjestelmät',
      finishes: 'Viimeistely'
    },
    export: {
      ifcTaskTitle: 'IFC-tehtävävienti',
      ifcTaskDescription: 'Vie IFC-yhteensopivaa tehtäväaikataulutietoa',
      ifcTaskDetails: 'Luo kattava IFC-tehtäväaikataulutieto, joka voidaan tuoda BIM-ohjelmistoihin 4D-rakennussuunnitteluun ja projektinhallintaan. Vienti sisältää yksityiskohtaisen resurssikohdentamisen, kustannuserittelyn ja suomalaiset TALO 2000 -luokittelukoodit.',
      readyToExport: 'Valmis vientiin',
      exportDescription: 'Vie IFC-tehtäväaikataulutieto useassa muodossa BIM-integraatiota ja projektinhallintaa varten',
      exportButton: 'Vie IFC-tehtävät'
    },
    littera: {
      ifcSourceTooltip: 'IFC-mallista tuotu Littera-koodi (Pset_Talo 2000 -ominaisuus).',
      suggestionTooltip: 'Järjestelmän ehdottama Littera-koodi TALO-koodin/elementtityypin perusteella. Voit muokata tai korvata sen.'
    }
  }
};

export function getTranslation(path: string[], language: Language): string {
  let current = costAnalysisTranslations[language] as TranslationTree;
  
  for (const key of path) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key] as TranslationTree;
    } else {
      console.warn(`Translation not found for path: ${path.join('.')} in language: ${language}`);
      return path[path.length - 1];
    }
  }
  
  return typeof current === 'string' ? current : path[path.length - 1];
} 