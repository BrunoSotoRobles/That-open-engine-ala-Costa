import * as React from "react";
import ExcelJS from "exceljs";
import { useCostStore } from "../stores/CostStore";
import { getCostBridgeUiText } from "../locales/costBridgeUi";
import type { BaseCostElement } from "../types/cost";
import {
  normalizeRevitName,
  buildGroupedData,
  calculateBaseQuantitiesByUnitForElements,
  pickAssemblyGroupLead,
  assemblyHostCount,
} from "../utils/costTableGrouping";
import {
  buildBridgeDynamicColumns,
  resolveAuditColumnValue,
  resolveBaseQuantityValue,
  resolvePublishedFields,
} from "../utils/measurementBridgeExport";
import { applyBridgeCorrectorToGuidRow } from "../utils/measurementBridgeCorrector";
import { COSTA_MEASUREMENT_BRIDGE_CORRECTOR_V1 } from "../utils/measurementFeatureFlags";
import {
  buildBridgeExportFilename,
  sha256HexFromBuffer,
  type BridgeExportMeta,
} from "../utils/bridgeExportMeta";
import { COSTA_BRIDGE_MODEL_HEALTH_SHEET_V1 } from "../utils/measurementFeatureFlags";
import { appendModelHealthSheet } from "../utils/measurementBridgeHealth";
import { listNamedGroups, type CostaNamedGroup } from "../utils/costaGroups";
import {
  IFCMeasurementPanelGuide,
  MeasurementSectionHelp,
} from "./IFCMeasurementPanelGuide";

/** Pilot UX guide + friendlier section copy. Set false to restore previous chrome. */
const COSTA_MEASUREMENT_PANEL_GUIDE_V1 = true;

interface DynamicColumnConfig {
  id: string;
  header: string;
  enabled: boolean;
  sourceKey?: string;
}

interface ListingPreset {
  id: string;
  label: string;
  ifcTypes: string[];
  /** Claves completas Pset.Property que se corresponden con extraProperties */
  propertyKeys: string[];
}

/**
 * Conjunto de Property Sets IFC estándar y globales que tienen sentido
 * como plantillas "genéricas" detectadas automáticamente.
 *
 * NOTA: los luettelot finlandeses van como plantillas curadas en LISTING_PRESETS
 * y no pasan por este filtro.
 */
const GLOBAL_IFC_PSET_WHITELIST = new Set<string>([
  // Puertas / ventanas / espacios / elementos comunes
  "Pset_DoorCommon",
  "Pset_WindowCommon",
  "Pset_SpaceCommon",
  "Pset_WallCommon",
  "Pset_SlabCommon",
  "Pset_RoofCommon",
  "Pset_ColumnCommon",
  "Pset_BeamCommon",
  "Pset_MemberCommon",
  "Pset_RailingCommon",
  "Pset_StairFlightCommon",
  "Pset_RampFlightCommon",
  "Pset_CoveringCommon",
  "Pset_BuildingElementProxyCommon",
  "Pset_FurnishingElementCommon",
  // Cantidades estándar
  "Pset_QuantityTakeOff",
  // Algunos Pset_*Common adicionales son posibles; se pueden añadir aquí según necesidad.
]);

const LISTING_PRESETS: ListingPreset[] = [
  {
    id: "windows-1242-ikkunaluettelo",
    label: "Window 1242 Ikkunaluettelo",
    ifcTypes: ["IfcWindow"],
    propertyKeys: [
      "1242 Ikkunaluettelo.G-arvo Gg",
      "1242 Ikkunaluettelo.Huomautuksia",
      "1242 Ikkunaluettelo.Ikkunatyyppi, koko, kätisyys",
      "1242 Ikkunaluettelo.Numero",
      "1242 Ikkunaluettelo.Paloluokka",
      "1242 Ikkunaluettelo.Savunpoiston/Korvausilman toimintaperiaate",
      "1242 Ikkunaluettelo.Turvalasi TL",
      "1242 Ikkunaluettelo.Ulkopuolen väri",
      "1242 Ikkunaluettelo.Valoaukko",
      "1242 Ikkunaluettelo.Vesipellin väri",
      "1242 Ikkunaluettelo.ip korkeus",
    ],
  },
  {
    id: "furnishing-1332-1334",
    label: "Furnishing 1332–1334",
    ifcTypes: ["IfcFurnishingElement"],
    propertyKeys: [
      "1332 Kiintokalusteet, 1333 Varusteet ja 1334 Laitteet.Tunnus",
      "1332 Kiintokalusteet, 1333 Varusteet ja 1334 Laitteet.Kaluste, varuste, laite",
      "1332 Kiintokalusteet, 1333 Varusteet ja 1334 Laitteet.Tyyppi",
      "1332 Kiintokalusteet, 1333 Varusteet ja 1334 Laitteet.Lisätieto",
      "1332-1333 Kalusteet ja varusteet, tilatieto, asennuskorko.Bottom Elevation",
      "1332 01 Kiintokalusteluettelo_Tasot.Tunnus",
      "1332 01 Kiintokalusteluettelo_Tasot.Kaluste",
      "1332 01 Kiintokalusteluettelo_Tasot.Tason leveys",
      "1332 01 Kiintokalusteluettelo_Tasot.Lisätieto",
    ],
  },
  {
    id: "furnishing-1332-tasot",
    label: "Furnishing 1332 01 Kiintokalusteluettelo_Tasot",
    ifcTypes: ["IfcFurnishingElement"],
    propertyKeys: [
      "1332 01 Kiintokalusteluettelo_Tasot.Altaan sijainti",
      "1332 01 Kiintokalusteluettelo_Tasot.Kaluste",
      "1332 01 Kiintokalusteluettelo_Tasot.Lisätieto",
      "1332 01 Kiintokalusteluettelo_Tasot.Tason leveys",
      "1332 01 Kiintokalusteluettelo_Tasot.Tunnus",
    ],
  },
  {
    id: "furnishing-1326-taustalaatoitusten",
    label: "Furnishing 1326 Taustalaatoitusten tarkistusluettelo",
    ifcTypes: ["IfcFurnishingElement"],
    propertyKeys: [
      "1326 Taustalaatoitusten tarkistusluettelo.Family",
      "1326 Taustalaatoitusten tarkistusluettelo.Height",
      "1326 Taustalaatoitusten tarkistusluettelo.Level",
      "1326 Taustalaatoitusten tarkistusluettelo.Type",
      "1326 Taustalaatoitusten tarkistusluettelo.Width Instance",
    ],
  },
  {
    id: "furnishing-1332-main",
    label: "Furnishing 1332 01 Kiintokalusteluettelo",
    ifcTypes: ["IfcFurnishingElement"],
    propertyKeys: [
      "1332 01 Kiintokalusteluettelo.Jalustatyyppi",
      "1332 01 Kiintokalusteluettelo.Kaluste",
      "1332 01 Kiintokalusteluettelo.Lisätieto",
      "1332 01 Kiintokalusteluettelo.Tunnus",
      "1332 01 Kiintokalusteluettelo.Yläsokkeli",
    ],
  },
  {
    id: "furnishing-1332-aloituspohja",
    label: "Furnishing 1332 01 Kiintokalusteluettelo Aloituspohjasta",
    ifcTypes: ["IfcFurnishingElement"],
    propertyKeys: [
      "1332 01 Kiintokalusteluettelo_Aloituspohjasta, älä muuta.Amount Locks",
      "1332 01 Kiintokalusteluettelo_Aloituspohjasta, älä muuta.Base-Top Type",
      "1332 01 Kiintokalusteluettelo_Aloituspohjasta, älä muuta.Kuvaus",
      "1332 01 Kiintokalusteluettelo_Aloituspohjasta, älä muuta.Lisätieto",
      "1332 01 Kiintokalusteluettelo_Aloituspohjasta, älä muuta.Locking",
      "1332 01 Kiintokalusteluettelo_Aloituspohjasta, älä muuta.Tunnus",
    ],
  },
  {
    id: "furnishing-1333-varusteluettelo",
    label: "Furnishing 1333 01 Varusteluettelo",
    ifcTypes: ["IfcFurnishingElement"],
    propertyKeys: [
      "1333 01 Varusteluettelo.Lisätieto",
      "1333 01 Varusteluettelo.Tunnus",
      "1333 01 Varusteluettelo.Tuotetieto",
      "1333 01 Varusteluettelo.Varuste",
    ],
  },
  {
    id: "furnishing-5111-irtokalusteluettelo",
    label: "Furnishing 5111 01 Irtokalusteluettelo",
    ifcTypes: ["IfcFurnishingElement"],
    propertyKeys: [
      "5111 01 Irtokalusteluettelo.Irtokaluste",
      "5111 01 Irtokalusteluettelo.Tunnus",
      "5111 01 Irtokalusteluettelo.Tyyppi",
    ],
  },
  {
    id: "furnishing-tyoskentelyluettelo-hki",
    label: "Furnishing Työskentelyluettelo HKi",
    ifcTypes: ["IfcFurnishingElement"],
    propertyKeys: [
      "Työskentelyluettelo HKi.Family",
      "Työskentelyluettelo HKi.Height Instance",
      "Työskentelyluettelo HKi.Level",
      "Työskentelyluettelo HKi.Type",
    ],
  },
  {
    id: "equipment-1334",
    label: "Equipment 1334 schedule",
    ifcTypes: ["IfcBuildingElementProxy"],
    propertyKeys: [
      "Pset_BuildingElementProxyCommon.Reference",
      "Pset_QuantityTakeOff.Reference",
      "1332 Kiintokalusteet, 1333 Varusteet ja 1334 Laitteet.Tunnus",
      "1332 Kiintokalusteet, 1333 Varusteet ja 1334 Laitteet.Kaluste, varuste, laite",
      "1332 Kiintokalusteet, 1333 Varusteet ja 1334 Laitteet.Tyyppi",
      "1332 Kiintokalusteet, 1333 Varusteet ja 1334 Laitteet.Lisätieto",
      "Keynote ja Type Mark tarkastus.Family",
      "Keynote ja Type Mark tarkastus.Type",
      "Keynote ja Type Mark tarkastus.Keynote",
      "Keynote ja Type Mark tarkastus.Type Mark",
      "1332-1333 Kalusteet ja varusteet, tilatieto, asennuskorko.Bottom Elevation",
    ],
  },
  {
    id: "equipment-1334-laiteluettelo",
    label: "Equipment 1334 01 Laiteluettelo",
    ifcTypes: ["IfcBuildingElementProxy"],
    propertyKeys: [
      "1334 01 Laiteluettelo.Lisätieto",
      "1334 01 Laiteluettelo.Tunnus",
      "1334 01 Laiteluettelo.Tuotetieto",
      "1334 01 Laiteluettelo.Tyyppi",
      "1334 01 Laiteluettelo.Urakka",
    ],
  },
  {
    id: "equipment-5111-irtokalusteluettelo",
    label: "Equipment 5111 01 Irtokalusteluettelo",
    ifcTypes: ["IfcBuildingElementProxy"],
    propertyKeys: [
      "5111 01 Irtokalusteluettelo.Irtokaluste",
      "5111 01 Irtokalusteluettelo.Tyyppi",
    ],
  },
  {
    id: "equipment-sahkolaitteet-tyoskentely",
    label: "Equipment Sähkölaitteet työskentelyluettelo",
    ifcTypes: ["IfcBuildingElementProxy"],
    propertyKeys: [
      "Sähkölaitteet työskentelyluettelo.Family and Type",
      "Sähkölaitteet työskentelyluettelo.Keynote",
    ],
  },
  {
    id: "door-1315-sisaovi-hki-copy1",
    label: "Door 1315 00 Sisäoviluettelo HKi Copy 1",
    ifcTypes: ["IfcDoor"],
    propertyKeys: [
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi Copy 1.Avautuu sisäänpäin",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi Copy 1.Construction Type",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi Copy 1.Construction Type Rough WidthxRough Height",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi Copy 1.Family",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi Copy 1.Huomautuksia",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi Copy 1.Kerros",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi Copy 1.Key Schedule",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi Copy 1.Keynote",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi Copy 1.Kynnys",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi Copy 1.Näkösuoja",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi Copy 1.Ovinumero",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi Copy 1.Paloluokka",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi Copy 1.Rw (dB)",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi Copy 1.Säteilysuoja",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi Copy 1.Type",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi Copy 1.Törmäyssuoja",
    ],
  },
  {
    id: "door-1315-luukkuluettelo-vss",
    label: "Door 1315 00 Luukkuluettelo VSS",
    ifcTypes: ["IfcDoor"],
    propertyKeys: [
      "1315 00 Luukkuluettelo VSS.Ovityyppi",
      "1315 00 Luukkuluettelo VSS.Paloluokka",
    ],
  },
  {
    id: "door-1315-ovilista-tyypit-hki",
    label: "Door 1315 00 Oviluettelo kaikki tyypit HKi",
    ifcTypes: ["IfcDoor"],
    propertyKeys: [
      "1315 00 Oviluettelo, yksilöity, kaikki tyypit TYÖSKENTELY HKi.Avautuu sisäänpäin",
      "1315 00 Oviluettelo, yksilöity, kaikki tyypit TYÖSKENTELY HKi.Construction Type",
      "1315 00 Oviluettelo, yksilöity, kaikki tyypit TYÖSKENTELY HKi.Construction Type Rough WidthxRough Height",
      "1315 00 Oviluettelo, yksilöity, kaikki tyypit TYÖSKENTELY HKi.Family",
      "1315 00 Oviluettelo, yksilöity, kaikki tyypit TYÖSKENTELY HKi.Huomautuksia",
      "1315 00 Oviluettelo, yksilöity, kaikki tyypit TYÖSKENTELY HKi.Kerros",
      "1315 00 Oviluettelo, yksilöity, kaikki tyypit TYÖSKENTELY HKi.Keynote",
      "1315 00 Oviluettelo, yksilöity, kaikki tyypit TYÖSKENTELY HKi.Näkösuoja",
      "1315 00 Oviluettelo, yksilöity, kaikki tyypit TYÖSKENTELY HKi.Paloluokka",
      "1315 00 Oviluettelo, yksilöity, kaikki tyypit TYÖSKENTELY HKi.Rw (dB)",
      "1315 00 Oviluettelo, yksilöity, kaikki tyypit TYÖSKENTELY HKi.Type",
      "1315 00 Oviluettelo, yksilöity, kaikki tyypit TYÖSKENTELY HKi.Törmäyssuoja",
    ],
  },
  {
    id: "door-1243-ulkoovi",
    label: "Door 1243 Ulko-oviluettelo",
    ifcTypes: ["IfcDoor"],
    propertyKeys: [
      "1243 Ulko-oviluettelo.Avautuu sisäänpäin",
      "1243 Ulko-oviluettelo.Huomautuksia",
      "1243 Ulko-oviluettelo.Karmin väri",
      "1243 Ulko-oviluettelo.Oven väri",
      "1243 Ulko-oviluettelo.Ovinumero",
      "1243 Ulko-oviluettelo.Ovityyppi",
      "1243 Ulko-oviluettelo.Paloluokka",
    ],
  },
  {
    id: "door-1315-sisaovi-malli",
    label: "Door 1315 00 Sisäoviluettelo MALLI",
    ifcTypes: ["IfcDoor"],
    propertyKeys: [
      "1315 00 Sisäoviluettelo, yksilöity, kaikki MALLI.Avautuu sisäänpäin",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki MALLI.Huomautuksia",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki MALLI.Karmin syvyys",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki MALLI.Karmin väri",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki MALLI.Kynnys",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki MALLI.Oven väri",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki MALLI.Ovinumero",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki MALLI.Paloluokka",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki MALLI.Rw (dB)",
    ],
  },
  {
    id: "door-1315-valiovi-kaikki",
    label: "Door 1315 00 Välioviluettelo kaikki",
    ifcTypes: ["IfcDoor"],
    propertyKeys: [
      "1315 00 Välioviluettelo, kaikki.Avautuu sisäänpäin",
      "1315 00 Välioviluettelo, kaikki.Huomautuksia",
      "1315 00 Välioviluettelo, kaikki.Karmin väri",
      "1315 00 Välioviluettelo, kaikki.Kynnys",
      "1315 00 Välioviluettelo, kaikki.Oven väri",
      "1315 00 Välioviluettelo, kaikki.Ovityyppi",
      "1315 00 Välioviluettelo, kaikki.Paloluokka",
      "1315 00 Välioviluettelo, kaikki.Rw (dB)",
      "1315 00 Välioviluettelo, kaikki.Säteilysuoja",
    ],
  },
  {
    id: "door-1315-valiovi-metalli",
    label: "Door 1315 00 Välioviluettelo metalli",
    ifcTypes: ["IfcDoor"],
    propertyKeys: [
      "1315 00 Välioviluettelo, metalli.Huomautuksia",
      "1315 00 Välioviluettelo, metalli.Kynnys",
      "1315 00 Välioviluettelo, metalli.Näkösuoja",
      "1315 00 Välioviluettelo, metalli.Ovinumero",
      "1315 00 Välioviluettelo, metalli.Ovityyppi ja koko",
      "1315 00 Välioviluettelo, metalli.Paloluokka",
      "1315 00 Välioviluettelo, metalli.Rw (dB)",
    ],
  },
  {
    id: "door-1315-lasiovet-tyoskentely",
    label: "Door 1315 xx Sisäoviluettelo lasiovet TYÖSKENTELY",
    ifcTypes: ["IfcDoor"],
    propertyKeys: [
      "1315 xx Sisäoviluettelo, lasiovet TYÖSKENTELY.Avautuu sisäänpäin",
      "1315 xx Sisäoviluettelo, lasiovet TYÖSKENTELY.Construction Type",
      "1315 xx Sisäoviluettelo, lasiovet TYÖSKENTELY.Construction Type Rough WidthxRough Height",
      "1315 xx Sisäoviluettelo, lasiovet TYÖSKENTELY.Family",
      "1315 xx Sisäoviluettelo, lasiovet TYÖSKENTELY.Huomautuksia",
      "1315 xx Sisäoviluettelo, lasiovet TYÖSKENTELY.Kerros",
      "1315 xx Sisäoviluettelo, lasiovet TYÖSKENTELY.Keynote",
      "1315 xx Sisäoviluettelo, lasiovet TYÖSKENTELY.Ovinumero",
      "1315 xx Sisäoviluettelo, lasiovet TYÖSKENTELY.Paloluokka",
      "1315 xx Sisäoviluettelo, lasiovet TYÖSKENTELY.Rw (dB)",
      "1315 xx Sisäoviluettelo, lasiovet TYÖSKENTELY.Säteilysuoja",
      "1315 xx Sisäoviluettelo, lasiovet TYÖSKENTELY.Type",
    ],
  },
  {
    id: "door-1315-valiovi-liukuovi",
    label: "Door 1315 00 Välioviluettelo liukuovi",
    ifcTypes: ["IfcDoor"],
    propertyKeys: [
      "1315 00 Välioviluettelo, liukuovi.Avautuu sisäänpäin",
      "1315 00 Välioviluettelo, liukuovi.Huomautuksia",
      "1315 00 Välioviluettelo, liukuovi.Kynnys",
      "1315 00 Välioviluettelo, liukuovi.Näkösuoja",
      "1315 00 Välioviluettelo, liukuovi.Ovinumero",
      "1315 00 Välioviluettelo, liukuovi.Ovityyppi ja koko",
      "1315 00 Välioviluettelo, liukuovi.Paloluokka",
      "1315 00 Välioviluettelo, liukuovi.Rw (dB)",
      "1315 00 Välioviluettelo, liukuovi.Säteilysuoja",
      "1315 00 Välioviluettelo, liukuovi.Törmäyssuoja",
    ],
  },
  {
    id: "door-1315-db-liukuovi-tyoskentely",
    label: "Door 1315 xx Sisäoviluettelo dB-liukuovet TYÖSKENTELY",
    ifcTypes: ["IfcDoor"],
    propertyKeys: [
      "1315 xx Sisäoviluettelo, dB-liukuovet TYÖSKENTELY.Construction Type",
      "1315 xx Sisäoviluettelo, dB-liukuovet TYÖSKENTELY.Construction Type Rough WidthxRough Height",
      "1315 xx Sisäoviluettelo, dB-liukuovet TYÖSKENTELY.Family",
      "1315 xx Sisäoviluettelo, dB-liukuovet TYÖSKENTELY.Huomautuksia",
      "1315 xx Sisäoviluettelo, dB-liukuovet TYÖSKENTELY.Kerros",
      "1315 xx Sisäoviluettelo, dB-liukuovet TYÖSKENTELY.Keynote",
      "1315 xx Sisäoviluettelo, dB-liukuovet TYÖSKENTELY.Ovinumero",
      "1315 xx Sisäoviluettelo, dB-liukuovet TYÖSKENTELY.Rw (dB)",
      "1315 xx Sisäoviluettelo, dB-liukuovet TYÖSKENTELY.Säteilysuoja",
      "1315 xx Sisäoviluettelo, dB-liukuovet TYÖSKENTELY.Type",
    ],
  },
  {
    id: "door-1315-sisaovi-hki",
    label: "Door 1315 00 Sisäoviluettelo HKi",
    ifcTypes: ["IfcDoor"],
    propertyKeys: [
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi.Construction Type",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi.Construction Type Rough WidthxRough Height",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi.Family",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi.Huomautuksia",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi.Kerros",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi.Key Schedule",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi.Keynote",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi.Kynnys",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi.Näkösuoja",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi.Ovinumero",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi.Rw (dB)",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi.Säteilysuoja",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi.Type",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY HKi.Törmäyssuoja",
    ],
  },
  {
    id: "door-1315-valiovi-puuväliovet",
    label: "Door 1315 00 Välioviluettelo puuväliovet",
    ifcTypes: ["IfcDoor"],
    propertyKeys: [
      "1315 00 Välioviluettelo, puuväliovet.Avautuu sisäänpäin",
      "1315 00 Välioviluettelo, puuväliovet.Huomautuksia",
      "1315 00 Välioviluettelo, puuväliovet.Kynnys",
      "1315 00 Välioviluettelo, puuväliovet.Näkösuoja",
      "1315 00 Välioviluettelo, puuväliovet.Ovinumero",
      "1315 00 Välioviluettelo, puuväliovet.Ovityyppi",
      "1315 00 Välioviluettelo, puuväliovet.Paloluokka",
      "1315 00 Välioviluettelo, puuväliovet.Rw (dB)",
      "1315 00 Välioviluettelo, puuväliovet.Säteilysuoja",
      "1315 00 Välioviluettelo, puuväliovet.Törmäyssuoja",
    ],
  },
  {
    id: "door-1315-sisaovi-shy",
    label: "Door 1315 00 Sisäoviluettelo SHy",
    ifcTypes: ["IfcDoor"],
    propertyKeys: [
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY SHy.Construction Type",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY SHy.Construction Type Rough WidthxRough Height",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY SHy.Family",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY SHy.Huomautuksia",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY SHy.Kerros",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY SHy.Key Schedule",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY SHy.Keynote",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY SHy.Kynnys",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY SHy.Ovinumero",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY SHy.Rw (dB)",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY SHy.Type",
      "1315 00 Sisäoviluettelo, yksilöity, kaikki, TYÖSKENTELY SHy.Törmäyssuoja",
    ],
  },
  {
    id: "door-1316-erityisovi-malli",
    label: "Door 1316 00 Erityisoviluettelo MALLI",
    ifcTypes: ["IfcDoor"],
    propertyKeys: [
      "1316 00 Erityisoviluettelo, yksilöity MALLI.Karmin syvyys",
      "1316 00 Erityisoviluettelo, yksilöity MALLI.Karmin väri",
      "1316 00 Erityisoviluettelo, yksilöity MALLI.Kynnys",
      "1316 00 Erityisoviluettelo, yksilöity MALLI.Oven väri",
      "1316 00 Erityisoviluettelo, yksilöity MALLI.Ovinumero",
      "1316 00 Erityisoviluettelo, yksilöity MALLI.Paloluokka",
      "1316 00 Erityisoviluettelo, yksilöity MALLI.Rw (dB)",
    ],
  },
  {
    id: "door-1315-valiovi-erityisovet",
    label: "Door 1315 00 Välioviluettelo erityisovet",
    ifcTypes: ["IfcDoor"],
    propertyKeys: [
      "1315 00 Välioviluettelo, erityisovet.Kynnys",
      "1315 00 Välioviluettelo, erityisovet.Ovinumero",
      "1315 00 Välioviluettelo, erityisovet.Ovityyppi",
      "1315 00 Välioviluettelo, erityisovet.Paloluokka",
      "1315 00 Välioviluettelo, erityisovet.Rw (dB)",
    ],
  },
  {
    id: "space-tilaluettelo-kerroksittain",
    label: "Space Tilaluettelo kerroksittain",
    ifcTypes: ["IfcSpace"],
    propertyKeys: [
      "Tilaluettelo kerroksittain.Area Target Value",
      "Tilaluettelo kerroksittain.Count Target Value",
      "Tilaluettelo kerroksittain.Department",
      "Tilaluettelo kerroksittain.Level",
      "Tilaluettelo kerroksittain.Name",
      "Tilaluettelo kerroksittain.Name Short",
      "Tilaluettelo kerroksittain.Number",
      "Tilaluettelo kerroksittain.Occupancy",
    ],
  },
  {
    id: "space-tilaluettelo-pju",
    label: "Space Tilaluettelo PJU-laskenta",
    ifcTypes: ["IfcSpace"],
    propertyKeys: [
      "Tilaluettelo PJU-laskenta.Lyhennös",
      "Tilaluettelo PJU-laskenta.Nimi",
      "Tilaluettelo PJU-laskenta.Numero",
      "Tilaluettelo PJU-laskenta.Osasto",
      "Tilaluettelo PJU-laskenta.Tilatyyppi",
    ],
  },
];

/**
 * Deriva una etiqueta corta y legible para la cabecera de columna
 * a partir de una clave completa Pset.Property.
 *
 * Ejemplos:
 * - "Tilaluettelo kerroksittain.Occupancy"        -> "Occupancy"
 * - "1315 00 Välioviluettelo, erityisovet.Rw (dB)" -> "erityisovet.Rw (dB)"
 * - "1334 01 Laiteluettelo.Tunnus"                -> "Tunnus"
 */
function getDisplayLabelForPropertyKey(key: string): string {
  const [pset, prop] = key.split(".");
  if (!prop) return key;

  const trimmedPset = pset.trim();
  const lowerPset = trimmedPset.toLowerCase();

  // Listas de espacios (Tilaluettelo ...): mostrar solo el nombre de la propiedad
  if (lowerPset.includes("tilaluettelo")) {
    return prop;
  }

  // Listas de puertas / mobiliario con códigos 13xx...: usar la última palabra del Pset como prefijo breve
  if (/^13\d{2}/.test(trimmedPset) || lowerPset.includes("välioviluettelo")) {
    const lastWord = trimmedPset.split(/\s+/).pop() || trimmedPset;
    return `${lastWord}.${prop}`;
  }

  // Por defecto, usar solo el nombre de la propiedad
  return prop;
}

/**
 * Resuelve el valor a mostrar para una clave de plantilla concreta en un elemento.
 *
 * Orden de resolución:
 * 1. Valor exacto en extraProperties["Pset.Property"] (si existe).
 * 2. Fallbacks para casos comunes:
 *    - *.Level  -> element.floor (nivel IFC / Constraints.Level)
 *    - *.Name / *.Tilanimi / *.Nimi -> element.name (nombre IFC)
 */
function resolvePropertyValueForElement(
  element: any,
  ifcType: string,
  propertyKey: string
): string | number | null {
  if (!element) return null;

  const extra = element.extraProperties as Record<string, any> | undefined;
  if (extra && Object.prototype.hasOwnProperty.call(extra, propertyKey)) {
    const v = extra[propertyKey];
    if (v !== undefined && v !== null) return v;
  }

  const lowerKey = propertyKey.toLowerCase();

  // Fallback para Level (nivel / planta)
  if (lowerKey.endsWith(".level")) {
    const floor = element.floor;
    if (floor !== undefined && floor !== null && floor !== "") {
      return floor;
    }
  }

  // Fallback para nombres (espacios / habitaciones, etc.)
  if (
    lowerKey.endsWith(".name") ||
    lowerKey.endsWith(".tilanimi") ||
    lowerKey.endsWith(".nimi")
  ) {
    const name = element.name;
    if (name !== undefined && name !== null && name !== "") {
      return name;
    }
  }

  return null;
}

export function IFCMeasurementPanel() {
  const costData = useCostStore((state: any) => state.costData ?? []);
  const language = useCostStore((s) => s.language);
  const bridgeT = (key: string) => getCostBridgeUiText(key, language);
  const panelGuide = COSTA_MEASUREMENT_PANEL_GUIDE_V1;
  const hasData = Array.isArray(costData) && costData.length > 0;

  const [selectedIfcTypes, setSelectedIfcTypes] = React.useState<string[]>([]);
  /** "" = all elements (no Costa group filter). */
  const [selectedCostaGroupId, setSelectedCostaGroupId] = React.useState("");
  /** Controlled template select: "curated:id" | "auto:id" | "". */
  const [selectedTemplateKey, setSelectedTemplateKey] = React.useState("");
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [namedGroups, setNamedGroups] = React.useState<CostaNamedGroup[]>(() => listNamedGroups());
  const refreshNamedGroups = React.useCallback(() => {
    setNamedGroups(listNamedGroups());
  }, []);

  React.useEffect(() => {
    refreshNamedGroups();
    const onGroupsChanged = () => refreshNamedGroups();
    window.addEventListener("costa-named-groups-changed", onGroupsChanged);
    (window as any).__costaRefreshMeasurementGroupSelect = refreshNamedGroups;
    return () => {
      window.removeEventListener("costa-named-groups-changed", onGroupsChanged);
      if ((window as any).__costaRefreshMeasurementGroupSelect === refreshNamedGroups) {
        delete (window as any).__costaRefreshMeasurementGroupSelect;
      }
    };
  }, [refreshNamedGroups]);

  const selectedCostaGroup = React.useMemo(
    () => namedGroups.find((g) => g.id === selectedCostaGroupId) ?? null,
    [namedGroups, selectedCostaGroupId]
  );
  /** Plantilla puente: IFC raw → Published* → unidades Cost (sin TALO). */
  const [dynamicColumns, setDynamicColumns] = React.useState<DynamicColumnConfig[]>(() =>
    buildBridgeDynamicColumns().map(({ id, header, enabled, sourceKey }) => ({
      id,
      header,
      enabled,
      sourceKey,
    }))
  );
  const [draggingColId, setDraggingColId] = React.useState<string | null>(null);
  const [propertyModalOpen, setPropertyModalOpen] = React.useState(false);
  const [propertySearch, setPropertySearch] = React.useState("");
  const [selectedPropertyKeys, setSelectedPropertyKeys] = React.useState<string[]>([]);
  const headerRowRef = React.useRef<HTMLDivElement | null>(null);
  const listingTemplates = useCostStore(
    (state: any) => state.listingTemplates ?? {}
  );

  const availableIfcTypes = React.useMemo(() => {
    const types = new Set<string>();
    if (!hasData) return [];
    for (const element of costData as any[]) {
      if (element?.type) {
        types.add(element.type);
      }
    }
    return Array.from(types).sort();
  }, [costData, hasData]);

  const filteredData = React.useMemo(() => {
    if (!hasData) return [];
    let result = [...(costData as any[])];
    if (selectedIfcTypes.length > 0) {
      result = result.filter((el) => selectedIfcTypes.includes(el.type));
    }
    if (selectedCostaGroup && selectedCostaGroup.expressIds?.length) {
      const idSet = new Set(selectedCostaGroup.expressIds.map(Number));
      result = result.filter((el) => {
        const id = Number(el?.id ?? el?.expressId);
        return Number.isFinite(id) && idSet.has(id);
      });
    }
    return result;
  }, [costData, hasData, selectedIfcTypes, selectedCostaGroup]);

  /** Properties discovered from filtered elements (extraProperties), grouped by Pset name */
  const availablePropertiesByPset = React.useMemo(() => {
    const byPset = new Map<string, string[]>();
    if (!hasData || filteredData.length === 0) return byPset;
    for (const el of filteredData as BaseCostElement[]) {
      const extra = (el as any).extraProperties;
      if (!extra || typeof extra !== "object") continue;
      for (const key of Object.keys(extra)) {
        const dot = key.indexOf(".");
        const pset = dot > 0 ? key.slice(0, dot) : "";
        const prop = dot > 0 ? key.slice(dot + 1) : key;
        if (!byPset.has(pset)) byPset.set(pset, []);
        const arr = byPset.get(pset)!;
        if (!arr.includes(prop)) arr.push(prop);
      }
    }
    byPset.forEach((arr) => arr.sort());
    return byPset;
  }, [hasData, filteredData]);

  const autoTemplates: ListingPreset[] = React.useMemo(() => {
    if (!hasData) return [];
    const detected: ListingPreset[] = [];
    Object.entries(listingTemplates as Record<string, any>).forEach(
      ([ifcType, data]) => {
        if (!data || !data.psets) return;
        Object.entries(data.psets as Record<string, string[]>).forEach(
          ([psetName, props]) => {
            if (!psetName || !Array.isArray(props) || props.length === 0) return;
            // Solo exponer como "Detected from IFC" los PropertySets IFC estándar/globales.
            if (!GLOBAL_IFC_PSET_WHITELIST.has(psetName)) return;
            const id = `${ifcType}:${psetName}`;
            const label =
              `${ifcType} – ${psetName}`.length > 70
                ? `${ifcType} – ${psetName.slice(0, 65)}…`
                : `${ifcType} – ${psetName}`;
            const propertyKeys = props.map(
              (propName: string) => `${psetName}.${propName}`
            );
            detected.push({
              id,
              label,
              ifcTypes: [ifcType],
              propertyKeys,
            });
          }
        );
      }
    );
    return detected;
  }, [hasData, listingTemplates]);

  const applyListingPreset = (preset: ListingPreset) => {
    // Aplicar tipos IFC predefinidos, ajustando al naming real presente en los datos
    if (preset.ifcTypes.length > 0 && availableIfcTypes.length > 0) {
      const effectiveTypes = availableIfcTypes.filter((type) =>
        preset.ifcTypes.some(
          (target) => target.toLowerCase() === String(type).toLowerCase()
        )
      );
      if (effectiveTypes.length > 0) {
        setSelectedIfcTypes(effectiveTypes);
      }
    }

    // Mantener columnas base (TALO + unidades) y añadir columnas de propiedades
    setDynamicColumns((prev) => {
      const baseColumns = prev.filter((c) => !c.id.startsWith("prop_"));
      const existingById = new Map(prev.map((c) => [c.id, c]));
      const newPropColumns: DynamicColumnConfig[] = [];

      preset.propertyKeys.forEach((key) => {
        const id = `prop_${key}`;
        const header = getDisplayLabelForPropertyKey(key);
        const existing = existingById.get(id);
        if (existing) {
          newPropColumns.push({ ...existing, enabled: true, header });
        } else {
          newPropColumns.push({
            id,
            header,
            enabled: true,
          });
        }
      });

      return [...baseColumns, ...newPropColumns];
    });
  };

  const handleResetFilters = () => {
    setSelectedIfcTypes([]);
    setSelectedCostaGroupId("");
    setSelectedTemplateKey("");
  };

  const applyTemplateFromSelect = (value: string) => {
    if (!value) {
      setSelectedTemplateKey("");
      // Volver a columnas puente sin propiedades de plantilla
      setDynamicColumns((prev) => prev.filter((c) => !c.id.startsWith("prop_")));
      return;
    }
    if (value.startsWith("curated:")) {
      const id = value.slice("curated:".length);
      const tpl = LISTING_PRESETS.find((t) => t.id === id);
      if (tpl) applyListingPreset(tpl);
    } else if (value.startsWith("auto:")) {
      const id = value.slice("auto:".length);
      const tpl = autoTemplates.find((t) => t.id === id);
      if (tpl) applyListingPreset(tpl);
    }
    setSelectedTemplateKey(value);
  };

  const selectStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    backgroundColor: "#111",
    color: "#e0e0e0",
    borderRadius: 4,
    border: "1px solid #404040",
    padding: "4px 8px",
    fontSize: "0.72rem",
  };

  const sectionLabelStyle: React.CSSProperties = {
    margin: "0 0 4px",
    fontSize: "0.62rem",
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "#969696",
  };

  // Cards fill the shell (shell stays aligned to 3D via flex:1). Scroll only when Advanced opens.
  const guidedSectionStyle: React.CSSProperties | undefined =
    COSTA_MEASUREMENT_PANEL_GUIDE_V1
      ? {
          marginBottom: 10,
          padding: "8px 10px 10px",
          borderRadius: 6,
          border: "1px solid #2a2a2a",
          backgroundColor: "#151515",
        }
      : undefined;

  const guidedLabelStyle: React.CSSProperties = COSTA_MEASUREMENT_PANEL_GUIDE_V1
    ? {
        margin: "0 0 4px",
        fontSize: "0.76rem",
        fontWeight: 600,
        color: "#e4e4e4",
        letterSpacing: "0.01em",
        textTransform: "none",
      }
    : sectionLabelStyle;

  const handleDownloadExcel = async (
    options?: {
      filename?: string;
      ifcTypes?: string[];
      sourceData?: any[];
      requireSourceData?: boolean;
      /** MCP/Claude: usar columnas puente aunque requireSourceData (no strip). */
      bridgePreset?: boolean;
      /** MCP IFC-only: solo identidad + dims IFC vía extras; sin unidades Cost. */
      ifcRawOnly?: boolean;
      extraColumns?: Array<{ key: string; header?: string }>;
      extraValuesById?: Record<string, Record<string, unknown>>;
    }
  ): Promise<BridgeExportMeta | undefined> => {
    // HARD GATE (2026-04-27):
    // In Claude/MCP-assisted export flows, quantity values must remain immutable.
    // We only surface diagnostics via QuantityWarnings; we do NOT rewrite quantities
    // from quantityResolution here.
    const toExcelScalar = (value: unknown): string | number | boolean | null => {
      if (value === undefined) return "";
      if (value === null) return null;
      if (typeof value === "number" || typeof value === "boolean") return value;
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return "";
        const numericLike = trimmed.replace(",", ".");
        if (/^-?\d+(\.\d+)?$/.test(numericLike)) {
          const n = Number(numericLike);
          if (!Number.isNaN(n)) return n;
        }
        return trimmed;
      }
      return String(value);
    };

    const resolveMcpExtraValueForElement = (
      element: any,
      sourceKey: string,
      map?: Record<string, Record<string, unknown>>
    ) => {
      const idKey = String(element?.id ?? "");
      const guidKey = String(element?.globalId ?? "");
      const fromById =
        (idKey && map?.[idKey]?.[sourceKey]) ??
        (guidKey && map?.[guidKey]?.[sourceKey]);
      const fromExtraProps = (element as any)?.extraProperties?.[sourceKey];
      return fromById ?? fromExtraProps;
    };

    const isSummableQuantitySourceKey = (sourceKey: string): boolean => {
      const key = String(sourceKey ?? "").trim().toLowerCase();
      if (!key) return false;
      // Evitar sumar códigos/identificadores aunque sean numéricos (p.ej. TALO/Littera).
      if (
        key.includes("talo") ||
        key.includes("littera") ||
        key.includes("code") ||
        key.includes("guid") ||
        key.includes("globalid") ||
        key.includes("ifc type") ||
        key.includes("ifctype") ||
        key.includes("name") ||
        key.includes("type name") ||
        key.includes("floor") ||
        key.includes("level")
      ) {
        return false;
      }
      // Solo cantidades físicas conocidas (longitudes/áreas/volúmenes).
      return (
        key.includes("perimeter") ||
        key.includes("length") ||
        key.includes("width") ||
        key.includes("height") ||
        key.includes("area") ||
        key.includes("volume")
      );
    };

    // Fuente de datos:
    // - MCP puede pasar `sourceData` directo (sin tocar CostStore).
    // - si no viene, usamos snapshot del store (flujo UI normal).
    const store = useCostStore.getState() as any;
    const snapshotCostData = Array.isArray(store?.costData) ? store.costData : [];
    const hasSourceData = Array.isArray(options?.sourceData);
    if (options?.requireSourceData && !hasSourceData) {
      throw new Error(
        "MCP export requires sourceData, but it was not provided."
      );
    }

    const effectiveSourceData = hasSourceData
      ? options!.sourceData
      : snapshotCostData;

    const requestedTypes = Array.isArray(options?.ifcTypes)
      ? options!.ifcTypes
          .filter((t) => typeof t === "string" && t.trim())
          .map((t) => t.toLowerCase())
      : [];
      // Columnas extra exclusivas de Claude/MCP:
      // solo se aceptan cuando el evento exige `sourceData` (flujo MCP).
      const requestedExtraColumns =
        options?.requireSourceData && Array.isArray(options?.extraColumns)
      ? options.extraColumns.filter(
          (c) => c && typeof c.key === "string" && c.key.trim().length > 0
        )
      : [];
    const extraValuesById =
      options?.extraValuesById && typeof options.extraValuesById === "object"
        ? options.extraValuesById
        : undefined;

    const snapshotHasData = Array.isArray(effectiveSourceData) && effectiveSourceData.length > 0;
    if (!snapshotHasData) {
      alert("No Cost data available. Please run the Cost panel in the IFC viewer first.");
      return undefined;
    }

    // Filtro:
    // - si MCP manda `ifcTypes`, lo usamos (case-insensitive)
    // - si no, usamos el filtro actual del panel (selectedIfcTypes)
    // - opcional: intersección con CostaBIM named group (UI)
    let effectiveFilteredData = effectiveSourceData as any[];
    if (requestedTypes.length > 0) {
      effectiveFilteredData = effectiveFilteredData.filter((el) =>
        requestedTypes.includes(String(el?.type ?? "").toLowerCase())
      );
    } else if (selectedIfcTypes.length > 0) {
      effectiveFilteredData = effectiveFilteredData.filter((el) =>
        selectedIfcTypes.includes(el?.type)
      );
    }

    const uiGroupFilter =
      !options?.requireSourceData && selectedCostaGroup && selectedCostaGroup.expressIds?.length
        ? selectedCostaGroup
        : null;
    if (uiGroupFilter) {
      const idSet = new Set(uiGroupFilter.expressIds.map(Number));
      effectiveFilteredData = effectiveFilteredData.filter((el) => {
        const id = Number(el?.id ?? el?.expressId);
        return Number.isFinite(id) && idSet.has(id);
      });
    }

    if (effectiveFilteredData.length === 0) {
      alert(
        uiGroupFilter
          ? `No CostStore elements match CostaBIM group "${uiGroupFilter.name}"` +
              (selectedIfcTypes.length ? " with the current IFC Type filter." : ".")
          : "No elements match the current filter."
      );
      return undefined;
    }

    const guidRowCount = effectiveFilteredData.length;

    try {
      const workbook = new ExcelJS.Workbook();
      const HEADER_ROW_INDEX = 3; // Reservamos filas 1-2 para el logo
      const worksheet = workbook.addWorksheet("IFC Measurements", {
        views: [{ state: "frozen", ySplit: HEADER_ROW_INDEX }],
      });

      const EXCEL_FONT = '&"Roboto Mono"';
      const ODD_HEADER = `${EXCEL_FONT}&R&D`; // Fecha (a la derecha) como en la plantilla
      const ODD_FOOTER = `${EXCEL_FONT}&LCosta Laskenta Oy\nY-tunnus: 3019665-7&R&P`;

      const loadCostaLogoPngBase64 = async (): Promise<string | null> => {
        try {
          // `public/` se sirve como raíz en Vite, así que el path apunta a `public/Costa_logo.svg`
          const res = await fetch("/Costa_logo.svg");
          if (!res.ok) return null;
          const svgText = await res.text();
          // En tu svg ya está embebido el PNG como `data:image/png;base64,...`
          const match = svgText.match(/base64,([^"]+)/);
          // Normalizamos por si el base64 viene con saltos de línea/espacios.
          return match?.[1]?.replace(/\s+/g, "") ?? null;
        } catch {
          return null;
        }
      };

      // Fixed columns consistent with CostPage measurement Excel (without Littera/costs)
      const standardColumns = [
        { header: "IFC Type", key: "ifcType", width: 15 },
        { header: "Name", key: "name", width: 40 },
        { header: "GUID", key: "globalId", width: 26 },
        { header: "Floor", key: "floor", width: 18 },
      ];

      // UI: columnas del panel. MCP bridge: mismas columnas puente. MCP IFC-only: sin dinámicas Cost.
      // MCP estricto legacy: solo standard + extras (si no bridgePreset).
      const bridgeCols = buildBridgeDynamicColumns().map(({ id, header, enabled, sourceKey }) => ({
        id,
        header,
        enabled,
        sourceKey,
      }));
      let activeDynamicColumns: DynamicColumnConfig[];
      if (options?.ifcRawOnly === true) {
        activeDynamicColumns = bridgeCols.filter((c) => c.id.startsWith("bq_"));
      } else if (options?.bridgePreset === true) {
        activeDynamicColumns = bridgeCols.filter((c) => c.enabled);
      } else if (options?.requireSourceData === true) {
        activeDynamicColumns = [];
      } else {
        activeDynamicColumns = dynamicColumns.filter((c) => c.enabled);
      }
      const unitColumns = activeDynamicColumns.map((c) => ({
        header: c.header,
        key: c.id,
        width: 12,
      }));

      // Columnas extra enviadas por Claude (p.ej. "Door Color").
      // Se anexan al final y se rellenan por elemento (GUID row).
      const mcpExtraColumns = requestedExtraColumns.map((c, index) => ({
        header: (typeof c.header === "string" && c.header.trim()) || c.key,
        key: `mcp_${index}_${c.key.replace(/[^a-zA-Z0-9_]/g, "_")}`,
        sourceKey: c.key,
        width: 18,
      }));

      // UI: grupo CostaBIM seleccionado → columna naranja "CostaBIM Group"
      if (uiGroupFilter) {
        const already = mcpExtraColumns.some(
          (c) =>
            c.sourceKey === "CostaGroup" ||
            String(c.header).toLowerCase().replace(/\s+/g, "") === "costabimgroup"
        );
        if (!already) {
          mcpExtraColumns.unshift({
            header: "CostaBIM Group",
            key: "mcp_ui_CostaGroup",
            sourceKey: "CostaGroup",
            width: 18,
          });
        }
      }

      const uiGroupExtraValuesById: Record<string, Record<string, unknown>> | undefined =
        uiGroupFilter
          ? Object.fromEntries(
              uiGroupFilter.expressIds.map((id) => [
                String(id),
                { CostaGroup: uiGroupFilter.name },
              ])
            )
          : undefined;
      const mergedExtraValuesById: Record<string, Record<string, unknown>> = {
        ...(extraValuesById ?? {}),
      };
      if (uiGroupExtraValuesById) {
        for (const [id, vals] of Object.entries(uiGroupExtraValuesById)) {
          mergedExtraValuesById[id] = { ...(mergedExtraValuesById[id] ?? {}), ...vals };
        }
      }

      const allColumnsForHeader = [...standardColumns, ...unitColumns, ...mcpExtraColumns];
      // Evitamos que ExcelJS genere headers automáticamente en la fila 1.
      // En su lugar, los ponemos manualmente en `HEADER_ROW_INDEX`.
      worksheet.columns = [
        ...standardColumns.map((c) => ({ key: c.key, width: c.width })),
        ...unitColumns.map((c) => ({ key: c.key, width: c.width })),
        ...mcpExtraColumns.map((c) => ({ key: c.key, width: c.width })),
      ] as any;

      // Logo como imagen repetible (en filas superiores), para acercarnos a la cabecera de la plantilla.
      const costaLogoPngBase64 = await loadCostaLogoPngBase64();
      if (costaLogoPngBase64) {
        const imageId = workbook.addImage({
          base64: costaLogoPngBase64,
          extension: "png",
        });

        worksheet.getRow(1).height = 15; // logo a ~1/2 tamaño
        worksheet.getRow(2).height = 0;

        // Posicionamos en celdas para que Excel lo repita al imprimir.
        worksheet.addImage(imageId, {
          tl: { col: 0, row: 0 }, // A1 (0-based)
          ext: { width: 100, height: 22 }, // Ajustado: ~1/2 tamaño
        });
      }

      // Repetir filas del logo + fila de encabezado en cada página impresa
      worksheet.pageSetup.printTitlesRow = `1:${HEADER_ROW_INDEX}`;

      // Header/Footer (texto + fecha/página, con la fuente de la plantilla)
      worksheet.headerFooter = {
        differentFirst: false,
        differentOddEven: false,
        firstHeader: ODD_HEADER,
        firstFooter: ODD_FOOTER,
        oddHeader: ODD_HEADER,
        oddFooter: ODD_FOOTER,
        evenHeader: ODD_HEADER,
        evenFooter: ODD_FOOTER,
      };

      // Header styling — IFC identity/raw = blue; CostaBIM (Published, units, Group) = orange
      const HEADER_BLUE = "FF4472C4";
      const HEADER_ORANGE = "FFDA7756";
      const headerRow = worksheet.getRow(HEADER_ROW_INDEX);
      headerRow.height = 20;

      const isCostaBimHeaderColumn = (col: { key?: string; header?: string; sourceKey?: string }) => {
        const key = String(col.key ?? "");
        if (key.startsWith("pub_") || key.startsWith("unit_") || key.startsWith("audit_") || key.startsWith("talo"))
          return true;
        const header = String(col.header ?? "").toLowerCase().replace(/\s+/g, "");
        if (header === "group" || header === "costabimgroup" || header.includes("costabim")) return true;
        const source = String(col.sourceKey ?? "");
        if (source === "CostaGroup" || /costagroup/i.test(source)) return true;
        // Other MCP extras (non-IFC-raw) count as CostaBIM-side / agent columns
        if (key.startsWith("mcp_")) return true;
        return false;
      };

      allColumnsForHeader.forEach((col, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = col.header;
        cell.font = { bold: true, name: "Roboto Mono", color: { argb: "FFFFFFFF" } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: isCostaBimHeaderColumn(col as any) ? HEADER_ORANGE : HEADER_BLUE },
        };
      });

      // Group data by IFC Type and by (TALO + normalized Revit name),
      // reusing the same logic as CostPage (buildGroupedData + normalizeRevitName)
      const { elementsByType } = buildGroupedData(
        effectiveFilteredData as BaseCostElement[]
      );

      let currentRow = 2;

      elementsByType.forEach((elementGroups, ifcType) => {
        // Type header row (outline level 0)
        const summaryRowData: Record<string, unknown> = {
          ifcType,
          name: `${elementGroups.size} group${elementGroups.size !== 1 ? "s" : ""}`,
        };

        const typeRow = worksheet.addRow(summaryRowData);
        typeRow.font = { bold: true, size: 11, name: "Roboto Mono", color: { argb: "FFFFFFFF" } };
        typeRow.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF4472C4" },
        };
        typeRow.alignment = { vertical: "middle", horizontal: "left" };
        typeRow.height = 18;
        typeRow.outlineLevel = 0;
        currentRow++;

        // elementGroups: Map<string, BaseCostElement[]> where key = normalizedTaloCode-normalizedName
        elementGroups.forEach((groupElements, _groupKey) => {
          const first = pickAssemblyGroupLead(groupElements);
          const normalizedName = normalizeRevitName(first.name || "");
          const isRevit = (first.name || "") !== normalizedName;
          const displayName = isRevit ? normalizedName : (first.name || "");
          const taloCode = (first.taloCode || "").trim();
          const hostCount = assemblyHostCount(groupElements);
          const variantCount = hostCount > 0 ? hostCount : groupElements.length;
          const variantText = variantCount > 1 ? ` (${variantCount} variants)` : "";

          // Calculate quantities per unit for this group (same logic as CostPage)
          const quantitiesByUnit = calculateBaseQuantitiesByUnitForElements(
            groupElements as BaseCostElement[],
            ifcType
          );

          const groupRowData: Record<string, unknown> = {
            ifcType: "",
            name: `${displayName}${variantText}`,
            globalId: "",
            floor: "",
            taloCode: taloCode,
          };

          // Fill unit / IFC raw / Published columns for the group row
          Object.entries(quantitiesByUnit).forEach(([unit, value]) => {
            const key = `unit_${unit}`;
            if (value !== "" && worksheet.getColumnKey(key)) {
              groupRowData[key] = value;
            }
          });
          // Property / bridge columns: leave IFC-raw & published empty on group summary (detail has values)
          activeDynamicColumns.forEach((c) => {
            if (c.id.startsWith("prop_")) groupRowData[c.id] = "";
            if (c.id.startsWith("bq_") || c.id.startsWith("pub_") || c.id.startsWith("audit_")) {
              groupRowData[c.id] = "";
            }
          });
          mcpExtraColumns.forEach((c) => {
            // Totales por grupo: sumar SOLO cantidades físicas.
            // No sumar códigos/props IFC aunque sean numéricos.
            if (!isSummableQuantitySourceKey(c.sourceKey)) {
              groupRowData[c.key] = "";
              return;
            }
            let hasNumeric = false;
            let sum = 0;
            for (const el of groupElements) {
              const v = resolveMcpExtraValueForElement(el as any, c.sourceKey, mergedExtraValuesById);
              const scalar = toExcelScalar(v);
              if (typeof scalar === "number" && Number.isFinite(scalar)) {
                hasNumeric = true;
                sum += scalar;
              }
            }
            groupRowData[c.key] = hasNumeric ? sum : "";
          });

          const groupRow = worksheet.addRow(groupRowData);
          groupRow.font = { bold: true, size: 10, name: "Roboto Mono", color: { argb: "FF000000" } };
          groupRow.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFDCE6F1" },
          };
          groupRow.alignment = { vertical: "middle", horizontal: "left" };
          groupRow.outlineLevel = 1;
          currentRow++;

          // Detail rows: one per GUID (outline level 2)
          groupElements.forEach((element) => {
            const guidRowData: Record<string, unknown> = {
              ifcType: "",
              name: "",
              globalId: element.globalId ?? "",
              floor: (element as any).floor ?? "",
              taloCode: element.taloCode ?? taloCode ?? "",
            };

            // Single-element quantities per unit, same helper as CostPage
            const singleQuantities = calculateBaseQuantitiesByUnitForElements(
              [element as BaseCostElement],
              ifcType
            );
            Object.entries(singleQuantities).forEach(([unit, value]) => {
              const key = `unit_${unit}`;
              if (value !== "" && worksheet.getColumnKey(key)) {
                guidRowData[key] = value;
              }
            });
            activeDynamicColumns.forEach((c) => {
              if (c.id.startsWith("bq_")) {
                const bqKey = c.id.slice(3);
                guidRowData[c.id] = resolveBaseQuantityValue(element, bqKey);
                return;
              }
              if (c.id === "pub_PublishedQuantity") {
                guidRowData[c.id] = resolvePublishedFields(element).quantity;
                return;
              }
              if (c.id === "pub_PublishedUnit") {
                guidRowData[c.id] = resolvePublishedFields(element).unit;
                return;
              }
              if (c.id.startsWith("audit_")) {
                guidRowData[c.id] = resolveAuditColumnValue(
                  element,
                  c.sourceKey ?? "__computed__"
                );
                return;
              }
              if (c.id.startsWith("prop_")) {
                const propKey = c.id.slice(5);
                const val = resolvePropertyValueForElement(
                  element as any,
                  ifcType as string,
                  propKey
                );
                guidRowData[c.id] = val !== undefined && val !== null ? String(val) : "";
              }
            });
            mcpExtraColumns.forEach((c) => {
              const val = resolveMcpExtraValueForElement(
                element as any,
                c.sourceKey,
                mergedExtraValuesById
              );
              guidRowData[c.key] = toExcelScalar(val);
            });

            if (COSTA_MEASUREMENT_BRIDGE_CORRECTOR_V1) {
              applyBridgeCorrectorToGuidRow(element as any, ifcType as string, guidRowData);
            }

            const guidRow = worksheet.addRow(guidRowData);
            guidRow.font = { size: 10, name: "Roboto Mono", color: { argb: "FF000000" } };
            guidRow.alignment = { vertical: "middle" };
            guidRow.outlineLevel = 2;
            currentRow++;
          });
        });

        // Blank row between type groups (optional)
        currentRow++;
      });

      // Outline configuration and collapse
      worksheet.properties.outlineLevelRow = 2;
      worksheet.properties.outlineLevelCol = 0;
      worksheet.properties.outlineProperties = {
        summaryBelow: false,
        summaryRight: false,
      };

      const lastRowNumber = worksheet.lastRow?.number || 0;
      for (let i = HEADER_ROW_INDEX + 1; i <= lastRowNumber; i++) {
        const row = worksheet.getRow(i);
        if (row.outlineLevel !== undefined && row.outlineLevel >= 1) {
          row.hidden = true;
        }
      }

      if (COSTA_BRIDGE_MODEL_HEALTH_SHEET_V1) {
        appendModelHealthSheet(workbook, snapshotCostData as any[]);
      }

      // Download — nombre: grupo → plantilla → tipos IFC → fecha
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      let defaultStem = "";
      if (uiGroupFilter?.name?.trim()) {
        defaultStem = uiGroupFilter.name.trim();
      } else if (selectedTemplateKey) {
        let templateLabel = "";
        if (selectedTemplateKey.startsWith("curated:")) {
          const id = selectedTemplateKey.slice("curated:".length);
          templateLabel = LISTING_PRESETS.find((t) => t.id === id)?.label ?? "";
        } else if (selectedTemplateKey.startsWith("auto:")) {
          const id = selectedTemplateKey.slice("auto:".length);
          templateLabel = autoTemplates.find((t) => t.id === id)?.label ?? "";
        }
        if (templateLabel) defaultStem = templateLabel;
      }
      if (!defaultStem) {
        const typesForName =
          options?.ifcTypes && options.ifcTypes.length > 0
            ? options.ifcTypes
            : selectedIfcTypes;
        if (typesForName.length > 0) {
          defaultStem = typesForName.join("+");
        }
      }

      const downloadName = buildBridgeExportFilename(
        defaultStem,
        guidRowCount,
        options?.filename
      );
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      const rowCount = worksheet.lastRow?.number ?? 0;
      const checksumSha256 = await sha256HexFromBuffer(buffer as ArrayBuffer);

      // Reset filters after export, keep configuration in store
      handleResetFilters();

      return {
        filename: downloadName,
        rowCount,
        guidRowCount,
        checksumSha256,
      };
    } catch (error) {
      console.error("[IFCMeasurementPanel] Error exporting IFC measurements Excel:", error);
      alert("Error exporting IFC measurements Excel. Please check the console for more details.");
      throw error;
    }
  };

  React.useEffect(() => {
    const onMcpExport = (evt: Event) => {
      const custom = evt as CustomEvent<{
        requestId: string;
        ifcTypes?: string[];
        filename?: string;
        sourceData?: any[];
        requireSourceData?: boolean;
        bridgePreset?: boolean;
        ifcRawOnly?: boolean;
        extraColumns?: Array<{ key: string; header?: string }>;
        extraValuesById?: Record<string, Record<string, unknown>>;
      }>;
      const detail = custom.detail;
      if (!detail?.requestId) return;

      const requestedTypes = Array.isArray(detail.ifcTypes)
        ? detail.ifcTypes.filter((t) => typeof t === "string" && t.trim())
        : [];

      window.setTimeout(async () => {
        try {
          const effectiveTypes =
            requestedTypes.length > 0 ? requestedTypes : undefined;
          const exportMeta = await handleDownloadExcel({
            filename: detail.filename,
            ifcTypes: effectiveTypes,
            sourceData: Array.isArray(detail.sourceData) ? detail.sourceData : undefined,
            requireSourceData: detail.requireSourceData === true,
            bridgePreset: detail.bridgePreset === true,
            ifcRawOnly: detail.ifcRawOnly === true,
            extraColumns: Array.isArray(detail.extraColumns)
              ? detail.extraColumns
              : undefined,
            extraValuesById:
              detail.extraValuesById && typeof detail.extraValuesById === "object"
                ? detail.extraValuesById
                : undefined,
          });
          window.dispatchEvent(
            new CustomEvent("costa-mcp-export-excel-result", {
              detail: {
                requestId: detail.requestId,
                ok: true,
                filename: exportMeta?.filename ?? detail.filename,
                rowCount: exportMeta?.rowCount,
                guidRowCount: exportMeta?.guidRowCount,
                checksumSha256: exportMeta?.checksumSha256,
              },
            })
          );
        } catch (error) {
          window.dispatchEvent(
            new CustomEvent("costa-mcp-export-excel-result", {
              detail: {
                requestId: detail.requestId,
                ok: false,
                error: error instanceof Error ? error.message : "Unknown error",
              },
            })
          );
        }
      }, 0);
    };

    window.addEventListener("costa-mcp-export-excel", onMcpExport);
    return () => window.removeEventListener("costa-mcp-export-excel", onMcpExport);
  }, [availableIfcTypes]);

  return (
    <div
      className="dashboard-card"
      style={{
        padding: "16px 16px 18px",
        backgroundColor: "#161616",
        borderRadius: 8,
        border: "1px solid #303030",
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <h4
        style={{
          margin: "0 0 4px",
          fontSize: 15,
          fontWeight: 600,
          color: "var(--primary)",
        }}
      >
        {bridgeT("measurementPanelTitle")}
      </h4>
      <p
        style={{
          fontSize: COSTA_MEASUREMENT_PANEL_GUIDE_V1 ? "0.74rem" : "0.68rem",
          color: "#969696",
          margin: "0 0 10px",
          lineHeight: 1.4,
        }}
      >
        {COSTA_MEASUREMENT_PANEL_GUIDE_V1
          ? bridgeT("measurementPanelSubtitleGuide")
          : bridgeT("measurementPanelSubtitleLegacy")}
      </p>

      {!hasData && (
        <>
          <p
            style={{
              fontSize: "0.8rem",
              color: "#ffb74d",
              marginBottom: 12,
            }}
          >
            {bridgeT("noCostDataHint")}{" "}
            <strong>Cost</strong> →{" "}
            <strong>{bridgeT("sendToQuantitiesCost")}</strong>{" "}
            {bridgeT("noCostDataHintSuffix")}
          </p>
          {COSTA_MEASUREMENT_PANEL_GUIDE_V1 && (
            <IFCMeasurementPanelGuide hasCostData={false} />
          )}
        </>
      )}

      {hasData && (
        <>
          <div
            style={
              guidedSectionStyle ?? {
                marginBottom: 10,
              }
            }
          >
            <p style={guidedLabelStyle}>
              {panelGuide
                ? bridgeT("scopeTitleGuide")
                : bridgeT("scopeTitleLegacy")}
            </p>
            {panelGuide && (
              <MeasurementSectionHelp>
                {bridgeT("scopeHelp")}
              </MeasurementSectionHelp>
            )}
            <select
              value={selectedCostaGroupId}
              onFocus={refreshNamedGroups}
              onChange={(e) => setSelectedCostaGroupId(e.target.value)}
              style={selectStyle}
            >
              <option value="">{bridgeT("scopeAllElements")}</option>
              {namedGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.expressIds?.length ?? g.elementCount ?? 0})
                </option>
              ))}
            </select>
            {namedGroups.length === 0 && (
              <p style={{ margin: "4px 0 0", fontSize: "0.65rem", color: "#777" }}>
                {panelGuide
                  ? bridgeT("scopeNoGroupsGuide")
                  : bridgeT("scopeNoGroupsLegacy")}
              </p>
            )}
          </div>

          <div
            style={
              guidedSectionStyle ?? {
                marginBottom: 8,
              }
            }
          >
            <p style={guidedLabelStyle}>
              {panelGuide
                ? bridgeT("listingTitleGuide")
                : bridgeT("listingTitleLegacy")}
            </p>
            {panelGuide && (
              <MeasurementSectionHelp>
                {bridgeT("listingHelp")}
              </MeasurementSectionHelp>
            )}
            <select
              value={selectedTemplateKey}
              onChange={(e) => applyTemplateFromSelect(e.target.value)}
              style={{
                ...selectStyle,
                marginBottom: panelGuide ? 0 : 6,
              }}
            >
              <option value="">{bridgeT("listingNoTemplate")}</option>
              <optgroup label={bridgeT("optgroupCurated")}>
                {LISTING_PRESETS.map((tpl) => (
                  <option key={`curated:${tpl.id}`} value={`curated:${tpl.id}`}>
                    {tpl.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label={bridgeT("optgroupDetected")}>
                {autoTemplates.map((tpl) => (
                  <option key={`auto:${tpl.id}`} value={`auto:${tpl.id}`}>
                    {tpl.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div
            style={
              guidedSectionStyle ?? {
                marginBottom: 8,
              }
            }
          >
          <p style={guidedLabelStyle}>
            {panelGuide
              ? bridgeT("columnsTitleGuide")
              : bridgeT("columnsTitleLegacy")}
          </p>
          {panelGuide && (
            <MeasurementSectionHelp>
              {bridgeT("columnsHelp")}
            </MeasurementSectionHelp>
          )}
          {/* Cabecera tipo tabla que replica la primera fila del Excel */}
          <div
            style={{
              borderRadius: 4,
              border: "1px solid #303030",
              backgroundColor: "#111",
              overflowX: "auto",
              overflowY: "hidden",
              paddingBottom: 8,
              marginBottom: COSTA_MEASUREMENT_PANEL_GUIDE_V1 ? 0 : 8,
            }}
          >
            <div
              ref={headerRowRef}
              style={{
                display: "inline-flex",
                minWidth: "100%",
                alignItems: "stretch",
                fontSize: "0.7rem",
              }}
            >
              {/* Columna IFC Type con dropdowns en filas (una selección por fila) */}
              <div
                style={{
                  flex: "0 0 140px",
                  borderRight: "1px solid #303030",
                  padding: "6px 8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    color: "#e0e0e0",
                    marginBottom: 4,
                    fontSize: "0.7rem",
                    borderBottom: "1px solid #404040",
                    paddingBottom: 2,
                    backgroundColor: "rgba(80,80,80,0.35)",
                    borderRadius: 3,
                  }}
                >
                  {bridgeT("previewColIfcType")}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    maxHeight: 100,
                    overflowY: "auto",
                  }}
                >
                  {[
                    ...selectedIfcTypes,
                    // Añadimos una fila extra vacía si aún hay tipos disponibles
                    ...(availableIfcTypes.filter((t) => !selectedIfcTypes.includes(t))
                      .length > 0
                      ? [""]
                      : []),
                  ].map((value, idx) => {
                    const alreadySelected = new Set(
                      selectedIfcTypes.filter((_, i) => i !== idx)
                    );
                    const optionsForRow = availableIfcTypes.filter(
                      (t) => !alreadySelected.has(t) || t === value
                    );

                    return (
                      <select
                        key={`${idx}-${value || "empty"}`}
                        value={value}
                        onChange={(e) => {
                          const chosen = e.target.value;
                          // Si el usuario limpia la selección en una fila intermedia
                          if (!chosen) {
                            setSelectedIfcTypes((prev) =>
                              prev.filter((_, i) => i !== idx)
                            );
                            return;
                          }
                          setSelectedIfcTypes((prev) => {
                            const next = [...prev];
                            if (idx < next.length) {
                              next[idx] = chosen;
                            } else {
                              next.push(chosen);
                            }
                            // Eliminar duplicados manteniendo el orden
                            const seen = new Set<string>();
                            return next.filter((t) => {
                              if (seen.has(t)) return false;
                              seen.add(t);
                              return true;
                            });
                          });
                        }}
                        style={{
                          width: "100%",
                          padding: "2px 4px",
                          backgroundColor: "#111",
                          color: "#f5f5f5",
                          border: "1px solid #404040",
                          borderRadius: 4,
                          fontSize: "0.72rem",
                        }}
                      >
                        <option value="">
                          {idx === 0
                            ? bridgeT("selectTypePlaceholder")
                            : bridgeT("addTypePlaceholder")}
                        </option>
                        {optionsForRow.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    );
                  })}
                </div>
              </div>

              {/* Columna Name */}
              <div
                style={{
                  flex: "0 0 160px",
                  borderRight: "1px solid #303030",
                  padding: "6px 8px",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    color: "#e0e0e0",
                    marginBottom: 4,
                    fontSize: "0.7rem",
                    borderBottom: "1px solid #404040",
                    paddingBottom: 2,
                    backgroundColor: "rgba(80,80,80,0.35)",
                    borderRadius: 3,
                  }}
                >
                  {bridgeT("previewColName")}
                </div>
              </div>

              {/* Columna GUID */}
              <div
                style={{
                  flex: "0 0 130px",
                  borderRight: "1px solid #303030",
                  padding: "6px 8px",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    color: "#e0e0e0",
                    marginBottom: 4,
                    fontSize: "0.7rem",
                    borderBottom: "1px solid #404040",
                    paddingBottom: 2,
                    backgroundColor: "rgba(80,80,80,0.35)",
                    borderRadius: 3,
                  }}
                >
                  {bridgeT("previewColGuid")}
                </div>
              </div>

              {/* Columna Floor (nivel / planta) */}
              <div
                style={{
                  flex: "0 0 110px",
                  borderRight: "1px solid #303030",
                  padding: "6px 8px",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    color: "#e0e0e0",
                    marginBottom: 4,
                    fontSize: "0.7rem",
                    borderBottom: "1px solid #404040",
                    paddingBottom: 2,
                    backgroundColor: "rgba(80,80,80,0.35)",
                    borderRadius: 3,
                    whiteSpace: "nowrap",
                  }}
                >
                  {bridgeT("previewColFloor")}
                </div>
              </div>

              {/* Columnas dinámicas (TALO Code + unidades), configurables */}
              {dynamicColumns.map((col, index) => {
                const isEnabled = col.enabled;
                return (
                  <div
                    key={col.id}
                    style={{
                      flex: "0 0 90px",
                      borderRight: "1px solid #303030",
                      padding: "4px 6px",
                    }}
                  >
                    <div
                      draggable
                      onDragStart={() => setDraggingColId(col.id)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!draggingColId || draggingColId === col.id) return;
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (!draggingColId || draggingColId === col.id) return;
                        setDynamicColumns((prev) => {
                          const fromIndex = prev.findIndex((c) => c.id === draggingColId);
                          const toIndex = prev.findIndex((c) => c.id === col.id);
                          if (fromIndex === -1 || toIndex === -1) return prev;
                          const next = [...prev];
                          const [moved] = next.splice(fromIndex, 1);
                          next.splice(toIndex, 0, moved);
                          return next;
                        });
                        setDraggingColId(null);
                      }}
                      onDragEnd={(e: React.DragEvent<HTMLDivElement>) => {
                        if (!draggingColId) return;
                        const header = headerRowRef.current;
                        if (header) {
                          const rect = header.getBoundingClientRect();
                          const { clientX, clientY } = e;
                          const inside =
                            clientX >= rect.left &&
                            clientX <= rect.right &&
                            clientY >= rect.top &&
                            clientY <= rect.bottom;
                          if (!inside) {
                            setDynamicColumns((prev) =>
                              prev.filter((c) => c.id !== draggingColId)
                            );
                          }
                        }
                        setDraggingColId(null);
                      }}
                      onClick={() =>
                        setDynamicColumns((prev) =>
                          prev.map((c) =>
                            c.id === col.id ? { ...c, enabled: !c.enabled } : c
                          )
                        )
                      }
                      style={{
                        fontWeight: 600,
                        color: isEnabled ? "#e0e0e0" : "#555",
                        marginBottom: 4,
                        whiteSpace: "nowrap",
                        fontSize: "0.7rem",
                        cursor: "grab",
                        textDecoration: isEnabled ? "none" : "line-through",
                        borderBottom: "1px solid #404040",
                        paddingBottom: 2,
                      }}
                      title={bridgeT("colHeaderDragTitle")}
                    >
                      {col.header}
                    </div>
                  </div>
                );
              })}

            </div>
          </div>
          </div>

          {/* Advanced stays flat when closed (no card) so panel height matches original; expand may scroll. */}
          <div
            style={
              COSTA_MEASUREMENT_PANEL_GUIDE_V1 && advancedOpen
                ? guidedSectionStyle
                : { marginBottom: 10 }
            }
          >
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontSize: COSTA_MEASUREMENT_PANEL_GUIDE_V1 ? "0.72rem" : "0.68rem",
                fontWeight: 600,
                color: COSTA_MEASUREMENT_PANEL_GUIDE_V1 ? "#e4e4e4" : "#969696",
                letterSpacing: "0.02em",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {advancedOpen ? "▼" : "▶"}{" "}
              {panelGuide
                ? bridgeT("advancedTitleGuide")
                : bridgeT("advancedTitleLegacy")}
            </button>
            {advancedOpen && (
              <div style={{ marginTop: 8 }}>
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: panelGuide ? "0.65rem" : "0.62rem",
                    color: "#888",
                    lineHeight: 1.35,
                  }}
                >
                  {panelGuide
                    ? bridgeT("advancedHelpGuide")
                    : bridgeT("advancedHelpLegacy")}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPropertyKeys([]);
                    setPropertySearch("");
                    setPropertyModalOpen(true);
                  }}
                  style={{
                    fontWeight: 600,
                    color: "#7cb342",
                    fontSize: COSTA_MEASUREMENT_PANEL_GUIDE_V1
                      ? "0.7rem"
                      : "0.72rem",
                    lineHeight: 1.2,
                    background: "none",
                    border: "1px solid #404040",
                    borderRadius: 4,
                    padding: COSTA_MEASUREMENT_PANEL_GUIDE_V1
                      ? "3px 8px"
                      : "4px 8px",
                    cursor: "pointer",
                  }}
                  title={bridgeT("addIfcPropertyTitle")}
                >
                  {bridgeT("addIfcProperty")}
                </button>
              </div>
            )}
          </div>

          {/* Modal: Add property column */}
          {propertyModalOpen && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 10000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.6)",
              }}
              onClick={() => setPropertyModalOpen(false)}
            >
              <div
                style={{
                  backgroundColor: "#1e1e1e",
                  border: "1px solid #404040",
                  borderRadius: 8,
                  padding: 16,
                  maxWidth: 420,
                  maxHeight: "70vh",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>
                  {bridgeT("modalAddPropertyTitle")}
                </h4>
                <p style={{ margin: "0 0 10px", fontSize: "0.75rem", color: "#969696" }}>
                  {bridgeT("modalAddPropertyDesc")}
                </p>
                <input
                  type="text"
                  placeholder={bridgeT("modalSearchPlaceholder")}
                  value={propertySearch}
                  onChange={(e) => setPropertySearch(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    marginBottom: 10,
                    backgroundColor: "#111",
                    border: "1px solid #404040",
                    borderRadius: 4,
                    color: "#f5f5f5",
                    fontSize: "0.8rem",
                    boxSizing: "border-box",
                  }}
                />
                <div
                  style={{
                    flex: 1,
                    overflowY: "auto",
                    marginBottom: 12,
                    maxHeight: 240,
                  }}
                >
                  {availablePropertiesByPset.size === 0 ? (
                    <p style={{ margin: 0, fontSize: "0.8rem", color: "#888" }}>
                      {bridgeT("modalNoProperties")}
                    </p>
                  ) : (
                    Array.from(availablePropertiesByPset.entries())
                      .filter(([pset, props]) => {
                        const q = propertySearch.trim().toLowerCase();
                        if (!q) return true;
                        const psetMatch = pset.toLowerCase().includes(q);
                        const propMatch = props.some((p) => p.toLowerCase().includes(q));
                        return psetMatch || propMatch;
                      })
                      .map(([pset, props]) => (
                        <div key={pset} style={{ marginBottom: 8 }}>
                          <div
                            style={{
                              fontSize: "0.7rem",
                              color: "#888",
                              marginBottom: 4,
                              fontWeight: 600,
                            }}
                          >
                            {pset || bridgeT("modalNoPset")}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {props
                              .filter(
                                (p) =>
                                  !propertySearch.trim() ||
                                  p.toLowerCase().includes(propertySearch.trim().toLowerCase())
                              )
                              .map((propName) => {
                              const key = pset ? `${pset}.${propName}` : propName;
                              const checked = selectedPropertyKeys.includes(key);
                              return (
                                <label
                                  key={key}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    fontSize: "0.75rem",
                                    color: "#e0e0e0",
                                    cursor: "pointer",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      setSelectedPropertyKeys((prev) =>
                                        prev.includes(key)
                                          ? prev.filter((k) => k !== key)
                                          : [...prev, key]
                                      );
                                    }}
                                  />
                                  {propName}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setPropertyModalOpen(false)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 4,
                      border: "1px solid #404040",
                      background: "#333",
                      color: "#e0e0e0",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                    }}
                  >
                    {bridgeT("modalCancel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      selectedPropertyKeys.forEach((key) => {
                        const existing = dynamicColumns.some((c) => c.id === `prop_${key}`);
                        if (!existing) {
                          setDynamicColumns((prev) => [
                            ...prev,
                            { id: `prop_${key}`, header: key, enabled: true },
                          ]);
                        }
                      });
                      setPropertyModalOpen(false);
                      setSelectedPropertyKeys([]);
                    }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 4,
                      border: "none",
                      background: "#129112",
                      color: "white",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                    }}
                  >
                    {bridgeT("modalAddSelected")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Pie anclado al fondo del shell (altura = columna 3D); sin hueco muerto bajo el botón. */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: COSTA_MEASUREMENT_PANEL_GUIDE_V1 ? "auto" : 8,
              paddingTop: COSTA_MEASUREMENT_PANEL_GUIDE_V1 ? 8 : 0,
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={handleResetFilters}
              style={{
                fontSize: "0.72rem",
                backgroundColor: "transparent",
                border: "none",
                color: "#bbbbbb",
                cursor: "pointer",
                textDecoration: "underline",
                padding: 0,
              }}
            >
              {bridgeT("clearFilters")}
            </button>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                rowGap: COSTA_MEASUREMENT_PANEL_GUIDE_V1 ? 2 : 4,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  void handleDownloadExcel();
                }}
                style={{
                  padding: COSTA_MEASUREMENT_PANEL_GUIDE_V1
                    ? "5px 10px"
                    : "8px 10px",
                  borderRadius: 4,
                  border: "none",
                  backgroundColor: "var(--primary)",
                  color: "white",
                  fontSize: COSTA_MEASUREMENT_PANEL_GUIDE_V1
                    ? "0.75rem"
                    : "0.8rem",
                  fontWeight: 500,
                  lineHeight: 1.2,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {bridgeT("downloadExcel")}
              </button>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.65rem",
                  color: "#777",
                  textAlign: "right",
                  maxWidth: 200,
                  lineHeight: 1.25,
                }}
              >
                {panelGuide
                  ? bridgeT("footerHintGuide")
                  : bridgeT("footerHintLegacy")}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

