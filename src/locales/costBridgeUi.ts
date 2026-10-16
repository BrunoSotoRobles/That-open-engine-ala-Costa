import type { Language } from "../stores/CostStore";

/** Viewer ↔ Quantities & Cost bridge copy (toolbar Cost panel + measurement side panel). */
const BRIDGE: Record<Language, Record<string, string>> = {
  en: {
    measurementPanelTitle: "CostaBIM Quantities",
    sendToQuantitiesCost: "Send to Quantities & Cost",
    costPanelSection: "Quantities & Cost",
    sendSuccessTitle: "Success!",
    sendSuccessBody: "Data sent to Quantities & Cost",
    measurementPanelSubtitleGuide:
      "Build the Excel bridge for Quantities & Cost and Claude: choose scope, IFC listing, columns — then download.",
    measurementPanelSubtitleLegacy:
      "Export IFC quantities for types or CostaBIM groups (bridge to Quantities & Cost).",
    noCostDataHint: "No cost data yet. Load an IFC, then use",
    noCostDataHintSuffix: "before exporting.",
    guideTitle: "How measurement works here",
    guideIntro:
      "This panel builds the Excel bridge for Quantities & Cost and Claude. It does not replace the 3D tools — use the viewer toolbar to load and inspect the model first.",
    guideStepOpenIfc: "Open an IFC",
    guideStepOpenIfcDetail: "— File in the viewer toolbar (or drop a model).",
    guideStepSend: "Send quantities",
    guideStepSendDetail: "fills the store this export reads.",
    guideStepReturn: "Come back here",
    guideStepReturnDetail: "— Scope, listing and Download Excel unlock once data is available.",
    guideTip:
      "Tip: after download, filters reset but your column setup is kept for the next export.",
    guideAfterSendTitle: "After Send, this panel will let you",
    guideAfterSend1Lead: "Filter by",
    guideAfterSend1Bold: "CostaBIM group",
    guideAfterSend1Tail: "or export all elements",
    guideAfterSend2Lead: "Choose a",
    guideAfterSend2Bold: "listing template",
    guideAfterSend2Tail: "(doors, walls, slabs, …) or bridge columns only",
    guideAfterSend3Lead: "Preview Excel columns and",
    guideAfterSend3Bold: "Download Excel",
    guideAfterSend3Tail: "for Quantities & Cost / Claude",
    scopeTitleGuide: "1. Scope — who to include",
    scopeTitleLegacy: "1. Scope",
    scopeHelp:
      "Export the whole model, or only a CostaBIM group from Model / Selection. Groups are optional.",
    scopeAllElements: "All elements (no group filter)",
    scopeNoGroupsGuide:
      "No groups yet — leave All elements, or save one in Model / Selection.",
    scopeNoGroupsLegacy: "Save a group in Model / Selection to limit the export scope.",
    listingTitleGuide: "2. Listing — which IFC types",
    listingTitleLegacy: "2. Listing (IFC type + template)",
    listingHelp:
      "A template pre-selects typical IFC types and columns (doors, walls, …). “Bridge columns only” keeps the standard Excel layout without a type filter.",
    listingNoTemplate: "No template — bridge columns only",
    optgroupCurated: "Curated templates",
    optgroupDetected: "Detected from IFC model",
    columnsTitleGuide: "3. Columns — Excel preview",
    columnsTitleLegacy: "3. Columns (Excel preview)",
    columnsHelp:
      "Headers below match the Excel file. Pick IFC types in the first column; toggle or reorder other columns as needed.",
    previewColIfcType: "IFC Type",
    previewColName: "Name",
    previewColGuid: "GUID",
    previewColFloor: "Floor",
    selectTypePlaceholder: "Select type…",
    addTypePlaceholder: "Add another type…",
    colHeaderDragTitle: "Click to hide/show, drag to reorder",
    advancedTitleGuide: "Advanced — add IFC properties (optional)",
    advancedTitleLegacy: "Advanced — add IFC properties",
    advancedHelpGuide:
      "Extra Property Set fields if bridge columns are not enough. Templates already add the usual ones.",
    advancedHelpLegacy:
      "Optional columns from Property Sets on the filtered elements. Templates above already add typical ones.",
    addIfcProperty: "+ Add IFC Property",
    addIfcPropertyTitle: "Add IFC property as column",
    modalAddPropertyTitle: "Add property column",
    modalAddPropertyDesc:
      "Add IFC Property Set properties as columns (from filtered elements).",
    modalSearchPlaceholder: "Search by Pset or property name...",
    modalNoProperties:
      "No IFC properties found in filtered elements. Send data from the Cost panel in the viewer first.",
    modalNoPset: "(no Pset)",
    modalCancel: "Cancel",
    modalAddSelected: "Add selected",
    clearFilters: "Clear filters",
    downloadExcel: "Download Excel",
    footerHintGuide: "Filters reset after download; columns stay.",
    footerHintLegacy: "After download, filters reset; columns stay as configured.",
    wsRetrySend:
      "Re-run Cost → Send to Quantities & Cost if the model changed.",
    exportHintEn:
      "No Cost data yet. In CostaBIM, click **Cost** → **Send to Quantities & Cost**, then ask for the export again.",
    exportHintEs:
      "No hay datos en Cost. En CostaBIM, pulsa **Cost** → **Send to Quantities & Cost**, y vuelve a pedir el export.",
  },
  fi: {
    measurementPanelTitle: "CostaBIM-määrät",
    sendToQuantitiesCost: "Lähetä määrille ja kustannukselle",
    costPanelSection: "Määrät ja kustannus",
    sendSuccessTitle: "Valmis!",
    sendSuccessBody: "Tiedot lähetetty määrille ja kustannukselle",
    measurementPanelSubtitleGuide:
      "Excel-silta määrille ja kustannukselle ja Claudelle: valitse laajuus, IFC-luettelo, sarakkeet — lataa sitten.",
    measurementPanelSubtitleLegacy:
      "Vie IFC-määrät tyypeittäin tai CostaBIM-ryhmittäin (silta määrille ja kustannukselle).",
    noCostDataHint: "Ei kustannustietoja vielä. Lataa IFC ja käytä",
    noCostDataHintSuffix: "ennen vientiä.",
    guideTitle: "Näin mittaus toimii tässä",
    guideIntro:
      "Tämä paneeli rakentaa Excel-sillan määrille ja kustannukselle ja Claudelle. Se ei korvaa 3D-työkaluja — lataa ja tarkista malli ensin katseluohjelman työkalupalkista.",
    guideStepOpenIfc: "Avaa IFC",
    guideStepOpenIfcDetail: "— Tiedosto työkalupalkista (tai pudota malli).",
    guideStepSend: "Lähetä määrät",
    guideStepSendDetail: "täyttää tämän viennin lukeman storen.",
    guideStepReturn: "Palaa tänne",
    guideStepReturnDetail: "— Laajuus, luettelo ja Excel-lataus avautuvat, kun tiedot ovat saatavilla.",
    guideTip:
      "Vinkki: latauksen jälkeen suodattimet nollautuvat, mutta sarakeasetukset säilyvät seuraavaa vientiä varten.",
    guideAfterSendTitle: "Lähetyksen jälkeen voit",
    guideAfterSend1Lead: "Suodata",
    guideAfterSend1Bold: "CostaBIM-ryhmän",
    guideAfterSend1Tail: "mukaan tai vie kaikki elementit",
    guideAfterSend2Lead: "Valitse",
    guideAfterSend2Bold: "luettelomalli",
    guideAfterSend2Tail: "(ovet, seinät, laatat, …) tai vain siltasarakkeet",
    guideAfterSend3Lead: "Esikatsele Excel-sarakkeita ja",
    guideAfterSend3Bold: "Lataa Excel",
    guideAfterSend3Tail: "määrille ja kustannukselle / Claudelle",
    scopeTitleGuide: "1. Laajuus — mitkä mukaan",
    scopeTitleLegacy: "1. Laajuus",
    scopeHelp:
      "Vie koko malli tai vain CostaBIM-ryhmä Model / Selection -paneelista. Ryhmät ovat valinnaisia.",
    scopeAllElements: "Kaikki elementit (ei ryhmäsuodatinta)",
    scopeNoGroupsGuide:
      "Ei ryhmiä vielä — jätä Kaikki elementit tai tallenna ryhmä Model / Selectionissa.",
    scopeNoGroupsLegacy:
      "Tallenna ryhmä Model / Selectionissa rajataksesi viennin laajuuden.",
    listingTitleGuide: "2. Luettelo — mitkä IFC-tyypit",
    listingTitleLegacy: "2. Luettelo (IFC-tyyppi + malli)",
    listingHelp:
      "Malli valitsee tyypilliset IFC-tyypit ja sarakkeet (ovet, seinät, …). ”Vain siltasarakkeet” pitää vakiomuotoisen Excel-asettelun ilman tyyppisuodatinta.",
    listingNoTemplate: "Ei mallia — vain siltasarakkeet",
    optgroupCurated: "Valmiit mallit",
    optgroupDetected: "Havaittu IFC-mallista",
    columnsTitleGuide: "3. Sarakkeet — Excel-esikatselu",
    columnsTitleLegacy: "3. Sarakkeet (Excel-esikatselu)",
    columnsHelp:
      "Alla olevat otsikot vastaavat Excel-tiedostoa. Valitse IFC-tyypit ensimmäisessä sarakkeessa; muut sarakkeet päälle/pois tai järjestyksen muutos.",
    previewColIfcType: "IFC-tyyppi",
    previewColName: "Nimi",
    previewColGuid: "GUID",
    previewColFloor: "Kerros",
    selectTypePlaceholder: "Valitse tyyppi…",
    addTypePlaceholder: "Lisää toinen tyyppi…",
    colHeaderDragTitle: "Näytä/piilota napsautuksella, järjestä vetämällä",
    advancedTitleGuide: "Lisäasetukset — IFC-ominaisuudet (valinnainen)",
    advancedTitleLegacy: "Lisäasetukset — IFC-ominaisuudet",
    advancedHelpGuide:
      "Lisä Property Set -kentät, jos siltasarakkeet eivät riitä. Mallit lisäävät jo tyypilliset kentät.",
    advancedHelpLegacy:
      "Valinnaiset sarakkeet suodatettujen elementtien Property Seteistä. Yllä olevat mallit lisäävät tyypilliset kentät.",
    addIfcProperty: "+ Lisää IFC-ominaisuus",
    addIfcPropertyTitle: "Lisää IFC-ominaisuus sarakkeeksi",
    modalAddPropertyTitle: "Lisää ominaisuussarake",
    modalAddPropertyDesc:
      "Lisää IFC Property Set -ominaisuuksia sarakkeiksi (suodatetuista elementeistä).",
    modalSearchPlaceholder: "Hae Psetin tai ominaisuuden nimellä...",
    modalNoProperties:
      "IFC-ominaisuuksia ei löytynyt suodatetuista elementeistä. Lähetä tiedot ensin katseluohjelman Cost-paneelista.",
    modalNoPset: "(ei Psetiä)",
    modalCancel: "Peruuta",
    modalAddSelected: "Lisää valitut",
    clearFilters: "Tyhjennä suodattimet",
    downloadExcel: "Lataa Excel",
    footerHintGuide: "Suodattimet nollautuvat latauksen jälkeen; sarakkeet säilyvät.",
    footerHintLegacy:
      "Latauksen jälkeen suodattimet nollautuvat; sarakkeet pysyvät asetettuina.",
    wsRetrySend:
      "Suorita uudelleen Cost → Lähetä määrille ja kustannukselle, jos malli on vaihtunut.",
    exportHintEn:
      "No Cost data yet. In CostaBIM, click **Cost** → **Send to Quantities & Cost**, then ask for the export again.",
    exportHintEs:
      "No hay datos en Cost. En CostaBIM, pulsa **Cost** → **Send to Quantities & Cost**, y vuelve a pedir el export.",
  },
};

export function getCostBridgeUiText(key: string, language: Language): string {
  return BRIDGE[language]?.[key] ?? BRIDGE.en[key] ?? key;
}

/** MCP / logs — English UI path for tools (FIN label in parentheses when needed). */
export const COST_BRIDGE_MCP_UI_PATH_EN =
  "Cost → Send to Quantities & Cost";
