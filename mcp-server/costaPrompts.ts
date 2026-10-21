import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const COSTA_WELCOME_FI = [
  "Tervetuloa CostaBIM + Claude -työhön!",
  "",
  "Suositus aloitus (Netlify tai paikallinen viewer):",
  "  1) Avaa CostaBIM selaimessa ja siirry /viewer -näkymään.",
  "  2) Lataa IFC (File tai pyydä minua käyttämään costa_load_ifc).",
  "  3) Cost-sivulla: täytä / tarkista kustannukset → **Send to Quantities & Cost**.",
  "  4) Sen jälkeen voin auttaa Littera/Talo-koodeissa, ryhmissä ja Excel-viennissä.",
  "",
  "Varmista että Claude Desktop ja selain ovat samalla koneella (MCP localhost).",
  "Voit pyytää tarkistuksen: costa_ping_store_connection.",
  "",
  "Kieli: suomi oletus; voit pyytää espanjaa tai englantia.",
].join("\n");

function buildCostaTervetuloaPlaybook(): string {
  return `
COSTABIM PLAYBOOK — noudata tätä kun käyttäjä aloittaa tai pyytää ohjeita.

═══ ALKU ═══
- Näytä COSTA_WELCOME_FI -tyyppinen tervetuloviesti suomeksi (ellei käyttäjä pyydä muuta kieltä).
- Älä oleta että store on täynnä: ehdota IFC + Send to Quantities & Cost jos store tyhjä.

═══ TYÖKULKU ═══
- Viewer auki (/viewer), WebSocket yhdistetty (ping).
- IFC ladattu ennen syvää Littera/Excel-työtä.
- costa_get_ifc_types_in_store hyödyllinen ennen massatoimia.

═══ TYÖKALUT ═══
- Käytä costa_* -työkaluja (älä sekoita muihin MCP:ihin).
`.trim();
}

/** MCP prompt: user starts Costa session via Claude prompts menu (like ayra_tervetuloa). */
export function registerCostaPrompts(server: McpServer): void {
  server.registerPrompt(
    "costa_tervetuloa",
    {
      title: "CostaBIM: tervetuloa",
      description:
        "CostaBIM Claude -aloitus: Netlify/viewer, IFC, Cost → Send to Quantities & Cost. Finnish default.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [buildCostaTervetuloaPlaybook(), "", "Näytä käyttäjälle:", "", COSTA_WELCOME_FI].join(
              "\n"
            ),
          },
        },
      ],
    })
  );
}
