import type { Language } from "../stores/CostStore";

/**
 * About page copy. FI wording follows costalaskenta.fi
 * (kustannuslaskenta, määrälaskenta, kustannustieto).
 */
const ABOUT: Record<Language, Record<string, string>> = {
  en: {
    productTitle: "CostaBIM",
    overview:
      "CostaBIM supports Costa Laskenta Oy — a Finnish cost-calculation specialist — with IFC-based quantity takeoff, cost data, and documentation workflows grounded in Finnish standards (TALO 2000, RT-kortti, Littera).",
    statusTitle: "Status: evaluation phase",
    statusBody:
      "This application is in evaluation and development. Features may change as we improve accuracy and efficiency.",
    featuresTitle: "Key features",
    featMgmtTitle: "Project tools",
    featMgmt1: "User and project management",
    featMgmt2: "BIM visualization (IFC 4.3, @thatopen)",
    featMgmt3: "Document management",
    featIntelTitle: "Quantity & cost intelligence",
    featIntel1: "Cost and performance dashboards",
    featIntel2: "Cost calculation (TALO 2000, RT-kortti, Littera)",
    featIntel3: "Carbon footprint analysis",
    featIntel4: "Talo–Littera mapping & cost libraries",
    featDocTitle: "Documentation & export",
    featDoc1: "Professional BOQ export (Excel, Littera format)",
    featDoc2: "Excel-style cost table with sync",
    featDoc3: "Site plans & cadastral data",
    featDoc4: "Building permit documentation",
    techTitle: "Technical stack & developer information",
    coreTech: "Core technologies",
    labelFrontend: "Frontend:",
    labelLanguage: "Language:",
    labelBuild: "Build tool:",
    labelState: "State management:",
    labelBackend: "Backend:",
    labelBim: "BIM framework:",
    labelCharts: "Charts:",
    labelExcel: "Excel export:",
    companyDevTitle: "Company & developer information",
    companyHeading: "About Costa Laskenta Oy",
    companyP1:
      "Costa Laskenta is a leading cost-calculation specialist. We produce reliable, efficient, and highly accurate calculations — a trusted partner in quantity and cost calculation.",
    companyP2:
      "Services include quantity takeoff, tender calculation, budget estimates, cost-data models, and carbon footprint calculation for construction projects across Finland.",
    developer: "Developer",
    linksTitle: "Professional links",
    linkLinkedIn: "LinkedIn profile",
    linkGitHub: "GitHub repository",
    linkCo2: "CO2Data.fi database",
  },
  fi: {
    productTitle: "CostaBIM",
    overview:
      "CostaBIM tukee Costa Laskenta Oy:tä — alan kustannuslaskennan asiantuntijaa — IFC-pohjaisella määrälaskennalla, kustannustiedolla ja dokumentoinnilla suomalaisiin standardeihin (TALO 2000, RT-kortti, Littera) nojaten.",
    statusTitle: "Tila: arviointi- ja kehitysvaihe",
    statusBody:
      "Sovellus on arviointi- ja kehitysvaiheessa. Ominaisuudet voivat muuttua, kun tarkkuutta ja tehokkuutta kehitetään.",
    featuresTitle: "Keskeiset ominaisuudet",
    featMgmtTitle: "Projektityökalut",
    featMgmt1: "Käyttäjä- ja projektinhallinta",
    featMgmt2: "BIM-visualisointi (IFC 4.3, @thatopen)",
    featMgmt3: "Dokumentinhallinta",
    featIntelTitle: "Määrä- ja kustannustieto",
    featIntel1: "Kustannus- ja suorituskykyikkunat",
    featIntel2: "Kustannuslaskenta (TALO 2000, RT-kortti, Littera)",
    featIntel3: "Hiilijalanjälkilaskenta",
    featIntel4: "Talo–Littera-määritys ja kustannuskirjastot",
    featDocTitle: "Dokumentointi ja vienti",
    featDoc1: "Ammattimainen määrälaskentavienti (Excel, Littera)",
    featDoc2: "Excel-tyylinen kustannustaulukko synkronoinnilla",
    featDoc3: "Asemapiirrokset ja kiinteistötiedot",
    featDoc4: "Rakennuslupadokumentaatio",
    techTitle: "Tekninen pino ja kehittäjätiedot",
    coreTech: "Keskeiset teknologiat",
    labelFrontend: "Käyttöliittymä:",
    labelLanguage: "Kieli:",
    labelBuild: "Rakennustyökalu:",
    labelState: "Tilanhallinta:",
    labelBackend: "Taustajärjestelmä:",
    labelBim: "BIM-kehys:",
    labelCharts: "Kaaviot:",
    labelExcel: "Excel-vienti:",
    companyDevTitle: "Yritys- ja kehittäjätiedot",
    companyHeading: "Tietoa Costa Laskenta Oy:stä",
    companyP1:
      "Costa Laskenta on alan johtava kustannuslaskennan asiantuntijayritys. Tuotamme laskelmat luotettavasti, tehokkaasti ja äärimmäisellä tarkkuudella — luotettava kumppani määrä- ja kustannuslaskennassa.",
    companyP2:
      "Palveluihin kuuluvat muun muassa määrälaskenta, tarjouslaskenta, budjettiarvio, kustannustietomalli ja hiilijalanjälkilaskenta rakennushankkeisiin ympäri Suomen.",
    developer: "Kehittäjä",
    linksTitle: "Ammatilliset linkit",
    linkLinkedIn: "LinkedIn-profiili",
    linkGitHub: "GitHub-repositorio",
    linkCo2: "CO2Data.fi-tietokanta",
  },
};

export function getAboutPageText(key: string, language: Language): string {
  return ABOUT[language]?.[key] ?? ABOUT.en[key] ?? key;
}
