#!/usr/bin/env python3
"""
Puente aislado: Excel simplificado (Jesse) <-> littera-filter-templates.csv (CostaBIM).

NO modifica el CSV vivo del repo salvo --apply explícito.

Uso:
  # Generar Excel para Jesse (Downloads)
  python scripts/littera_filter_templates_jesse_bridge.py generate

  # Cuando Jesse devuelva el Excel aprobado → CSV técnico (salida paralela)
  python scripts/littera_filter_templates_jesse_bridge.py reintegrate ^
    --input "C:/Users/.../littera-filter-templates_Jesse_v2.xlsx" ^
    --output "C:/Users/.../littera-filter-templates.from-jesse.csv"

  # Solo tras aprobación explícita: escribir al CSV del repo
  python scripts/littera_filter_templates_jesse_bridge.py reintegrate ... --apply
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import OrderedDict
from pathlib import Path

try:
    from openpyxl import Workbook, load_workbook
    from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.datavalidation import DataValidation
except ImportError:
    print("Necesitas openpyxl: pip install openpyxl", file=sys.stderr)
    sys.exit(1)

# ─── Paths ───────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[1]
REPO_CSV = REPO_ROOT / "src" / "data" / "littera-filter-templates.csv"
DEFAULT_JESSE_V1 = Path.home() / "Downloads" / "ejemplos maraluetelo" / "litteratemplates (version 1).xlsx"
DEFAULT_OUT_DIR = Path.home() / "Downloads" / "ejemplos maraluetelo"
DEFAULT_EXCEL = DEFAULT_OUT_DIR / "littera-filter-templates_Jesse_v2.xlsx"
DEFAULT_REINTEGRATE_OUT = DEFAULT_OUT_DIR / "littera-filter-templates.from-jesse.csv"

# Cabeceras CSV técnico (LitteraTemplateService)
TECH_HEADER = [
    "Nimikkeistö-koodi",
    "Nimikkeistö-nimi",
    "IFC Type",
    "Rakennusmenetelmä / Construction Method",
    "Vaadittu konteksti / Context Required",
    "Työvaihe / Activity",
    "Littera-koodialue / Code Range",
    "Yksikkö / Unit",
    "Avainsanat / Keywords",
    "Poissulkevat avainsanat / Exclude Keywords",
    "Prioriteetti / Priority",
    "Maksimi koodit / Max Codes",
    "Required",
    "Huomautukset / Notes",
]

# Cabeceras Excel simplificado (Jesse)
SIMPLE_HEADER = [
    "Tila",
    "Nimikkeistö-koodi",
    "Nimikkeistö-nimi",
    "IFC Type",
    "Rakennusmenetelmä",
    "Konteksti",
    "Työvaihe",
    "Littera-koodialue",
    "Yksikkö",
    "Pakollinen",
    "Huomautus",
]

# Keywords / priority por työvaihe (relleno automático al reintegrar)
ACTIVITY_DEFAULTS: dict[str, dict] = {
    "toimitus": {"keywords": "elementti,toimitus", "exclude": "asennus", "priority": 1, "max": 1},
    "asennus": {"keywords": "asennus", "exclude": "", "priority": 1, "max": 1},
    "saumat": {"keywords": "sauma,liitos", "exclude": "", "priority": 2, "max": 2},
    "juotos": {"keywords": "juotos,saumaus", "exclude": "", "priority": 1, "max": 1},
    "saumateräs": {"keywords": "saumateräs,saumaterakset", "exclude": "", "priority": 2, "max": 1},
    "reiät": {"keywords": "reiät,paikkaus", "exclude": "", "priority": 2, "max": 1},
    "jälkityö": {"keywords": "jälkityö,jalkityo", "exclude": "", "priority": 2, "max": 1},
    "muottityö": {"keywords": "muott", "exclude": "", "priority": 1, "max": 2},
    "muottityö_reuna": {"keywords": "reunamuott", "exclude": "", "priority": 1, "max": 1},
    "muottityö_alapinta": {"keywords": "alapinnan muott", "exclude": "", "priority": 1, "max": 1},
    "raudoitus": {"keywords": "raudoit", "exclude": "", "priority": 1, "max": 2},
    "raudoitus_pää": {"keywords": "raudoitus B500A,verkkoraudoit", "exclude": "", "priority": 1, "max": 1},
    "raudoitus_lisä": {"keywords": "jatkosteräks,lisäraudoit", "exclude": "", "priority": 2, "max": 1},
    "betonointi": {"keywords": "betonointi", "exclude": "", "priority": 1, "max": 1},
    "hierto": {"keywords": "hierto,pinnanteko", "exclude": "", "priority": 2, "max": 1},
    "eriste": {"keywords": "eriste,villa", "exclude": "", "priority": 2, "max": 1},
    "pintavalu": {"keywords": "pintavalu,tasoite", "exclude": "", "priority": 2, "max": 3},
    "muuraus": {"keywords": "muuraus,harkko,kahi", "exclude": "", "priority": 1, "max": 1},
    "liitokset": {"keywords": "liittym", "exclude": "", "priority": 3, "max": 2},
    "aukonylitys": {"keywords": "aukonylityspalkki", "exclude": "", "priority": 2, "max": 1},
    "runko_ja_levy": {"keywords": "GN,ranka,levy", "exclude": "", "priority": 1, "max": 1},
    "runko": {"keywords": "runko", "exclude": "", "priority": 1, "max": 1},
    "levytys": {"keywords": "levy,tuulensuoja", "exclude": "", "priority": 2, "max": 2},
    "ikkuna_toimitus": {"keywords": "", "exclude": "asennus,listoitus,kittaus", "priority": 1, "max": 1},
    "ovi_toimitus": {"keywords": "", "exclude": "asennus,listoitus", "priority": 1, "max": 1},
    "listoitus": {"keywords": "listoitus", "exclude": "", "priority": 3, "max": 1},
    "kittaus": {"keywords": "kittaus,tilkitseminen", "exclude": "", "priority": 3, "max": 1},
    "kate": {"keywords": "kate,pelti,kermi", "exclude": "", "priority": 1, "max": 2},
    "varusteet": {"keywords": "räystäs,kouru,lape", "exclude": "", "priority": 3, "max": 3},
    "saumaterakset": {"keywords": "saumateräs", "exclude": "", "priority": 2, "max": 1},
}


def _norm(s: object) -> str:
    if s is None:
        return ""
    t = str(s).strip()
    # Mojibake típico UTF-8 leído/guardado mal (Jesse V1 / consola)
    if "√" in t or "Ã" in t:
        fixes = (
            ("√§", "ä"),
            ("√∂", "ö"),
            ("√¶", "ö"),
            ("√£", "ä"),
            ("√µ", "å"),
            ("√Ñ", "Ä"),
            ("√ñ", "Ö"),
            ("Ã¤", "ä"),
            ("Ã¶", "ö"),
            ("Ã¥", "å"),
            ("Ã„", "Ä"),
            ("Ã–", "ö"),
        )
        for a, b in fixes:
            t = t.replace(a, b)
    return t.strip()


def _pakollinen_to_yes(val: str) -> str:
    v = _norm(val).lower()
    if v in ("yes", "kyllä", "kylla", "true", "1", "x"):
        return "YES"
    return "NO"


def _yes_to_pakollinen(val: str) -> str:
    return "kyllä" if _norm(val).upper() == "YES" else "ei"


def _defaults_for_activity(activity: str) -> dict:
    act = _norm(activity).lower()
    if act in ACTIVITY_DEFAULTS:
        return ACTIVITY_DEFAULTS[act]
    # fuzzy
    for key, conf in ACTIVITY_DEFAULTS.items():
        if key in act or act in key:
            return conf
    return {"keywords": act.replace("_", ","), "exclude": "", "priority": 2, "max": 1}


def _row_key(talo: str, ifc: str, method: str, ctx: str, act: str) -> tuple:
    return (
        _norm(talo),
        _norm(ifc).lower(),
        _norm(method).lower(),
        _norm(ctx).lower(),
        _norm(act).lower(),
    )


# ─── Load sources ────────────────────────────────────────────────────────────


def load_repo_csv(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            if not (r.get("Nimikkeistö-koodi") or "").strip():
                continue
            rows.append(
                {
                    "talo": _norm(r.get("Nimikkeistö-koodi")),
                    "nimi": _norm(r.get("Nimikkeistö-nimi")),
                    "ifc": _norm(r.get("IFC Type")),
                    "method": _norm(r.get("Rakennusmenetelmä / Construction Method")),
                    "ctx": _norm(r.get("Vaadittu konteksti / Context Required")),
                    "act": _norm(r.get("Työvaihe / Activity")),
                    "rng": _norm(r.get("Littera-koodialue / Code Range")),
                    "unit": _norm(r.get("Yksikkö / Unit")),
                    "kw": _norm(r.get("Avainsanat / Keywords")),
                    "ex": _norm(r.get("Poissulkevat avainsanat / Exclude Keywords")),
                    "prio": _norm(r.get("Prioriteetti / Priority")) or "2",
                    "maxc": _norm(r.get("Maksimi koodit / Max Codes")) or "1",
                    "req": _norm(r.get("Required")) or "NO",
                    "notes": _norm(r.get("Huomautukset / Notes")),
                    "tila": "ehdotus",
                    "source": "repo",
                }
            )
    return rows


def load_jesse_v1(path: Path) -> list[dict]:
    if not path.exists():
        return []
    wb = load_workbook(path, read_only=True, data_only=True)
    sheet = wb[wb.sheetnames[0]]
    raw = list(sheet.iter_rows(values_only=True))
    wb.close()
    if not raw:
        return []
    out = []
    for r in raw[1:]:
        if not r or not any(c is not None and str(c).strip() for c in r):
            continue
        talo = _norm(r[0])
        ifc = _norm(r[2]) if len(r) > 2 else ""
        act = _norm(r[5]) if len(r) > 5 else ""
        rng = _norm(r[6]) if len(r) > 6 else ""
        if not (talo and ifc and act and rng):
            continue
        # Prefer finer ranges from Jesse (3152/3155/3156)
        out.append(
            {
                "talo": talo,
                "nimi": _norm(r[1]) if len(r) > 1 else "",
                "ifc": ifc,
                "method": _norm(r[3]) if len(r) > 3 else "",
                "ctx": _norm(r[4]) if len(r) > 4 else "",
                "act": act,
                "rng": rng,
                "unit": _norm(r[7]) if len(r) > 7 else "",
                "kw": _norm(r[8]) if len(r) > 8 else "",
                "ex": _norm(r[9]) if len(r) > 9 else "",
                "prio": _norm(r[10]) if len(r) > 10 else "2",
                "maxc": _norm(r[11]) if len(r) > 11 else "1",
                "req": _norm(r[12]) if len(r) > 12 else "NO",
                "notes": _norm(r[13]) if len(r) > 13 else "",
                "tila": "vahvistettava",
                "source": "jesse_v1",
            }
        )
    return out


def ontelolaatta_example_rows() -> list[dict]:
    """Bloque ejemplo IfcSlab Oxx — vahvistettava, no norma Costa."""
    base = {
        "talo": "1235",
        "nimi": "Välipohjat — ontelolaatta Oxx (esimerkki)",
        "ifc": "IfcSlab",
        "method": "elementti",
        "ctx": "ontelolaatta,välipohja",
        "tila": "esimerkki",
        "source": "ml_example",
        "notes": "ESIMERKKI vahvistettava. Ei Costa-norma. Vikby/Nokian/SKES-kuvio. Holvi ≠ tämä (331).",
    }
    specs = [
        ("toimitus", "3152", "M2", "YES", "esim. 3152510 O27 — vain huomautus"),
        ("asennus", "3155", "KPL", "YES", "esim. 3155060"),
        ("saumateräs", "3156", "KG", "ei", "esim. 3156102 / 3156110"),
        ("juotos", "3156", "M2", "YES", "esim. 3156109 h=265; joskus aggregoitu 3156105"),
        ("reiät", "3156", "ERÄ", "ei", "esim. 3156119 tai Vikby 3156115 — kysy Jesse"),
        ("jälkityö", "3157", "M2", "YES", "esim. 315720"),
    ]
    rows = []
    for act, rng, unit, req, note in specs:
        rows.append(
            {
                **base,
                "act": act,
                "rng": rng,
                "unit": unit,
                "req": "YES" if req == "YES" else "NO",
                "notes": f"{base['notes']} | {note}",
                "kw": "",
                "ex": "",
                "prio": "",
                "maxc": "",
            }
        )
    return rows


def gap_rows_ifc() -> list[dict]:
    """Gaps IFC claros si faltan tras merge (pilarit/palkit/nosto-ovet ya suelen venir de Jesse)."""
    extras = []
    # 1316 nosto-ovet — a menudo confundido con 1315
    for act, rng, unit, req, note in [
        ("toimitus", "443", "M2,KPL", "YES", "Nosto-ovet lastaus — Biltema/Vikby/S-market"),
        ("asennus", "443", "KPL", "ei", "Jos erillinen; usein kokonaisurakka"),
        ("liittymät", "443", "JM", "YES", "listoitus + tilkitys — esim. 443025"),
    ]:
        extras.append(
            {
                "talo": "1316",
                "nimi": "Erityisovet — nosto-ovet",
                "ifc": "IfcDoor",
                "method": "toimitus",
                "ctx": "lastaus,nosto-ovi",
                "act": act,
                "rng": rng,
                "unit": unit,
                "req": "YES" if req == "YES" else "NO",
                "notes": note,
                "tila": "vahvistettava",
                "source": "ml_gap",
                "kw": "",
                "ex": "",
                "prio": "",
                "maxc": "",
            }
        )
    return extras


def consolidate(repo_rows: list[dict], jesse_rows: list[dict]) -> list[dict]:
    """
    Preferencia: Jesse V1 (rangos más finos) gana sobre repo en la misma clave.
    Luego gaps + ontelolaatta ejemplo.
    """
    merged: OrderedDict[tuple, dict] = OrderedDict()

    for r in repo_rows:
        if not r["ifc"] or not r["act"] or not r["rng"]:
            continue
        merged[_row_key(r["talo"], r["ifc"], r["method"], r["ctx"], r["act"])] = r

    for r in jesse_rows:
        k = _row_key(r["talo"], r["ifc"], r["method"], r["ctx"], r["act"])
        # Jesse overwrites / adds
        prev = merged.get(k)
        if prev and prev.get("source") == "repo":
            r = {**r, "tila": "vahvistettava"}
        merged[k] = r

    for r in gap_rows_ifc():
        k = _row_key(r["talo"], r["ifc"], r["method"], r["ctx"], r["act"])
        if k not in merged:
            merged[k] = r

    # Ontelolaatta example: always add under distinct context so it doesn't clash
    # with generic 1235 elementti rows
    for r in ontelolaatta_example_rows():
        k = _row_key(r["talo"], r["ifc"], r["method"], r["ctx"], r["act"])
        merged[k] = r

    # Sort: talo, method, ctx, act
    items = list(merged.values())
    items.sort(key=lambda x: (x["talo"], x["method"], x["ctx"], x["act"], x["ifc"]))
    return items


# ─── Generate Excel ───────────────────────────────────────────────────────────


def write_excel(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    wb = Workbook()

    # Sheet Ohje
    ws0 = wb.active
    ws0.title = "Ohje"
    instructions = [
        "LITTERA FILTER TEMPLATES — Jesse (v2, yksinkertaistettu)",
        "",
        "Tarkoitus: vahvistaa TALO + IFC + rakennusmenetelmä + työvaihe → Littera-koodialue (~3–4 numeroa).",
        "Tämä EI ole määräluettelo eikä 6-numeroinen Littera-koodi. Laskija sulkee tarkan koodin Excelissä.",
        "CostaBIM ei muutu ennen kuin tämä tiedosto on tarkistettu ja hyväksytty.",
        "",
        "Sarakkeet:",
        "  Tila = ehdotus | vahvistettava | esimerkki",
        "  Littera-koodialue = esim. 315, 3152, 331, 443 (ei 3152510)",
        "  Pakollinen = kyllä / ei",
        "",
        "Mitä tehdä:",
        "  1) Korjaa väärät koodialueet / työvaiheet",
        "  2) Poista rivit joita ei käytetä",
        "  3) Lisää puuttuvia työvaiheita tarvittaessa (kopioi rivi)",
        "  4) Älä täytä Avainsanat / Prioriteetti — ne täytetään myöhemmin automaattisesti",
        "",
        "Ontelolaatta (IfcSlab Oxx): rivit Tila=esimerkki — vahvista kuvio, EI Costa-norma.",
        "Holvi paikallavalu = 331. Ontelolaatta elementti = 3152/3155/3156.",
        "",
        "Palauta korjattu tiedosto Brunolle. Integraatio CostaBIMiin vasta hyväksynnän jälkeen.",
    ]
    for i, line in enumerate(instructions, 1):
        ws0.cell(1 if i == 0 else i, 1, line)
        if i == 1:
            ws0.cell(i, 1).font = Font(bold=True, size=14)
    ws0.column_dimensions["A"].width = 110

    # Sheet Templates
    ws = wb.create_sheet("Templates", 1)
    header_fill = PatternFill("solid", fgColor="1F4E79")
    header_font = Font(bold=True, color="FFFFFF")
    thin = Border(
        left=Side(style="thin", color="CCCCCC"),
        right=Side(style="thin", color="CCCCCC"),
        top=Side(style="thin", color="CCCCCC"),
        bottom=Side(style="thin", color="CCCCCC"),
    )
    fills = {
        "esimerkki": PatternFill("solid", fgColor="FFF2CC"),
        "vahvistettava": PatternFill("solid", fgColor="E2EFDA"),
        "ehdotus": PatternFill("solid", fgColor="DDEBF7"),
    }

    for col, h in enumerate(SIMPLE_HEADER, 1):
        cell = ws.cell(1, col, h)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(wrap_text=True, vertical="center")

    for i, r in enumerate(rows, 2):
        tila = _norm(r.get("tila") or "ehdotus")
        values = [
            tila,
            _norm(r["talo"]),
            _norm(r["nimi"]),
            _norm(r["ifc"]),
            _norm(r["method"]),
            _norm(r["ctx"]),
            _norm(r["act"]),
            _norm(r["rng"]),
            _norm(r["unit"]),
            _yes_to_pakollinen(r.get("req", "NO")),
            _norm(r.get("notes", "")),
        ]
        fill = fills.get(tila, fills["ehdotus"])
        for col, val in enumerate(values, 1):
            cell = ws.cell(i, col, val)
            cell.fill = fill
            cell.border = thin
            cell.alignment = Alignment(wrap_text=True, vertical="top")

    widths = [14, 12, 42, 12, 16, 22, 16, 16, 12, 12, 55]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:K{len(rows) + 1}"

    dv_tila = DataValidation(type="list", formula1='"ehdotus,vahvistettava,esimerkki"', allow_blank=True)
    dv_pak = DataValidation(type="list", formula1='"kyllä,ei"', allow_blank=True)
    ws.add_data_validation(dv_tila)
    ws.add_data_validation(dv_pak)
    dv_tila.add(f"A2:A{len(rows) + 1}")
    dv_pak.add(f"J2:J{len(rows) + 1}")

    # Solo Ohje + Templates (sin Lahteet)
    wb.save(path)
    print(f"Excel generado: {path} ({len(rows)} filas Templates)")


# ─── Reintegrate ──────────────────────────────────────────────────────────────


def read_simple_excel(path: Path) -> list[dict]:
    wb = load_workbook(path, read_only=True, data_only=True)
    if "Templates" in wb.sheetnames:
        ws = wb["Templates"]
    else:
        ws = wb[wb.sheetnames[0]]
    raw = list(ws.iter_rows(values_only=True))
    wb.close()
    if not raw:
        return []
    # Find header row
    header_idx = 0
    for i, row in enumerate(raw[:5]):
        cells = [_norm(c).lower() for c in row]
        if any("työvaihe" in c or "tyovaihe" in c or c == "työvaihe" for c in cells) or "tila" in cells:
            header_idx = i
            break
    header = [_norm(c) for c in raw[header_idx]]

    def col(*names: str) -> int | None:
        for n in names:
            for i, h in enumerate(header):
                if n.lower() in h.lower():
                    return i
        return None

    idx = {
        "tila": col("Tila"),
        "talo": col("Nimikkeistö-koodi", "koodi"),
        "nimi": col("Nimikkeistö-nimi", "nimi"),
        "ifc": col("IFC"),
        "method": col("Rakennusmenetelmä", "menetelmä"),
        "ctx": col("Konteksti", "konteksti"),
        "act": col("Työvaihe"),
        "rng": col("Littera-koodialue", "koodialue"),
        "unit": col("Yksikkö"),
        "pak": col("Pakollinen"),
        "notes": col("Huomautus", "Huomautukset"),
    }
    rows = []
    for r in raw[header_idx + 1 :]:
        if not r:
            continue

        def g(key: str) -> str:
            i = idx.get(key)
            if i is None or i >= len(r):
                return ""
            return _norm(r[i])

        talo, ifc, act, rng = g("talo"), g("ifc"), g("act"), g("rng")
        if not (talo and ifc and act and rng):
            continue
        rows.append(
            {
                "tila": g("tila") or "vahvistettava",
                "talo": talo,
                "nimi": g("nimi"),
                "ifc": ifc,
                "method": g("method"),
                "ctx": g("ctx"),
                "act": act,
                "rng": rng,
                "unit": g("unit"),
                "req": _pakollinen_to_yes(g("pak")),
                "notes": g("notes"),
            }
        )
    return rows


def simple_to_tech_rows(simple_rows: list[dict]) -> list[list[str]]:
    out = []
    for r in simple_rows:
        conf = _defaults_for_activity(r["act"])
        # Prefer notes already containing context; append tila tag
        notes = r.get("notes") or ""
        tila = r.get("tila") or ""
        if tila and tila not in notes.lower():
            notes = f"[{tila}] {notes}".strip()
        prio = str(conf["priority"])
        maxc = str(conf["max"])
        # Required YES → priority 1 nudge
        if r.get("req") == "YES" and int(prio) > 1:
            prio = "1"
        out.append(
            [
                r["talo"],
                r["nimi"],
                r["ifc"],
                r["method"],
                r["ctx"],
                r["act"],
                r["rng"],
                r["unit"],
                conf["keywords"],
                conf["exclude"],
                prio,
                maxc,
                r.get("req") or "NO",
                notes,
            ]
        )
    return out


def write_tech_csv(rows: list[list[str]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(TECH_HEADER)
        w.writerows(rows)
    print(f"CSV técnico escrito: {path} ({len(rows)} filas)")


# ─── CLI ──────────────────────────────────────────────────────────────────────


def cmd_generate(args: argparse.Namespace) -> None:
    jesse_v1 = Path(args.jesse_v1) if args.jesse_v1 else DEFAULT_JESSE_V1
    out = Path(args.output) if args.output else DEFAULT_EXCEL
    repo = load_repo_csv(REPO_CSV)
    jesse = load_jesse_v1(jesse_v1)
    print(f"Repo: {len(repo)} filas | Jesse V1 usable: {len(jesse)} | V1 path: {jesse_v1.exists()}")
    consolidated = consolidate(repo, jesse)
    write_excel(consolidated, out)
    print("Aislado: NO se modificó src/data/littera-filter-templates.csv")


def cmd_reintegrate(args: argparse.Namespace) -> None:
    inp = Path(args.input)
    if not inp.exists():
        print(f"No existe: {inp}", file=sys.stderr)
        sys.exit(1)
    simple = read_simple_excel(inp)
    if not simple:
        print("No se leyeron filas válidas del Excel.", file=sys.stderr)
        sys.exit(1)
    tech = simple_to_tech_rows(simple)
    out = Path(args.output) if args.output else DEFAULT_REINTEGRATE_OUT
    if args.apply:
        out = REPO_CSV
        print("ADVERTENCIA: --apply escribirá el CSV vivo del repo.")
    write_tech_csv(tech, out)
    if not args.apply:
        print("Salida paralela. Para sustituir el repo: añade --apply (solo tras aprobación).")


def main() -> None:
    p = argparse.ArgumentParser(description="Puente Excel Jesse <-> filter-templates CSV")
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="Generar Excel simplificado para Jesse")
    g.add_argument("--jesse-v1", default=str(DEFAULT_JESSE_V1))
    g.add_argument("--output", default=str(DEFAULT_EXCEL))
    g.set_defaults(func=cmd_generate)

    r = sub.add_parser("reintegrate", help="Excel Jesse → CSV técnico (paralelo por defecto)")
    r.add_argument("--input", required=True, help="Excel revisado por Jesse")
    r.add_argument("--output", default=str(DEFAULT_REINTEGRATE_OUT))
    r.add_argument(
        "--apply",
        action="store_true",
        help="Escribir a src/data/littera-filter-templates.csv (peligroso; solo tras OK)",
    )
    r.set_defaults(func=cmd_reintegrate)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
