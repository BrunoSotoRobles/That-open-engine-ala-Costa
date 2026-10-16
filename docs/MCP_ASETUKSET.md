# Costa MCP — ensiasennus

Lyhyt ohje tiimille. Sama tapa kuin aiemmin: **Claude-config käsin**, ei erillistä setup-skriptiä.

## Tarvitset

1. **Node.js** (vähintään 16, suositus LTS) — [nodejs.org](https://nodejs.org)  
   `node -v` ja `npm -v`
2. **Claude Desktop** — [claude.ai/download](https://claude.ai/download)
3. **Costa-repositorio** kloonattuna omalle koneelle

## Asennus (kerran)

```bash
git pull
npm install
cd mcp-server && npm install
```

`.env` repositorion juuressa (kerran):

```env
VITE_MCP_WS_URL=ws://localhost:8081
```

### Claude Desktop — `costa-mcp` JSON:iin

Avaa Claude → **Settings → Developer → Edit config**.

Lisää (tai päivitä) `costa-mcp` **omalla repositorion polulla**. Älä poista muita MCP-palvelimia (esim. Revit).

```json
"costa-mcp": {
  "command": "C:\\Program Files\\nodejs\\node.exe",
  "args": [
    "C:\\POLKU\\REPOON\\mcp-server\\node_modules\\tsx\\dist\\cli.mjs",
    "C:\\POLKU\\REPOON\\mcp-server\\main.ts"
  ]
}
```

**Missä config-tiedosto on (Windows):**

| Asennus | Polku |
|---------|--------|
| Microsoft Store | `%LOCALAPPDATA%\\Packages\\Claude_*\\LocalCache\\Roaming\\Claude\\claude_desktop_config.json` |
| Asentaja (.exe) | `%APPDATA%\\Claude\\claude_desktop_config.json` |

Jos et ole varma, käytä **Edit config** Claudessa — se avaa oikean tiedoston.

Sulje ja avaa **Claude Desktop**. Developer-näkymässä: `costa-mcp` = running.

Esimerkki: `docs/claude_desktop_config.costa.example.json`

## Päivittäinen käyttö

1. **Claude Desktop** auki
2. `npm run dev`
3. Avaa **projekti** (IFCViewer)
4. Selaimen konsolissa: `✅ [Costa MCP] Connected to WebSocket`
5. Claudessa: `costa_groups_list`, `costa_ping_store_connection`, jne.

Ilman avointa projektia: *"No Costa app WebSocket client connected"*. Jos välilehti oli auki ennen Clauden käynnistystä → **F5**.

## Päivitys reposta

```bash
git pull
npm install
```

Jos muuttui `mcp-server/package-lock.json`: `cd mcp-server && npm install`

**Jos pull muutti `mcp-server/`-koodia:**

1. Sulje ja avaa **Claude Desktop**
2. `npm run dev` + projekti IFCViewerissä
3. **F5** selaimessa (konsoli: Connected)
4. Testaa Claudessa: `costa_ping_store_connection`

Jos pull ei koskenut `mcp-server/`: riittää Claude + Costa auki.

Jos repositorion **polku** muuttui, päivitä `args` Clauden configissa ja käynnistä Claude uudelleen.

## Testaus

1. Developer → `costa-mcp` running  
2. `npm run dev` + projekti IFCViewerissä + **F5** tarvittaessa  
3. Claudessa: `costa_ping_store_connection` tai `costa_groups_list`

Osittainen tarkistus (ei korvaa pingiä Claudessa):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify-costa-mcp-health.ps1
```

Loki: `%LOCALAPPDATA%\\Claude\\logs\\mcp-server-costa-mcp.log` tai `%APPDATA%\\Claude\\logs\\…`

- Hyvä: `Bridge primary` / `Bridge secondary`
- Huono: `Couldn't start for Cowork`, `WebSocket bridge failed`, `Exiting duplicate` (vanha koodi → pull + Claude uudelleen)

**Revit-MCP** voi olla samassa configissa — älä poista muita palvelimia.

---

Työkalut: `docs/MCP_SETUP.md`
