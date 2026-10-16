/**
 * Utilidades para agregación de costes por grupo principal (pääryhmä).
 * Mapeo aproximado Hankenimikkeisto/TALO → Talo 80 -style main groups (0-9)
 * para comparación €/hm² según tesis Kauppinen (kerrostalojen hinnoitteludata).
 */

export interface MainGroupInfo {
  id: number;
  nameFi: string;
  nameEn: string;
}

/** Talo 80 -style main groups (pääryhmät) para comparación de costes */
export const MAIN_GROUPS: MainGroupInfo[] = [
  { id: 0, nameFi: 'Rakennuttajan kustannukset', nameEn: 'Client costs' },
  { id: 1, nameFi: 'Maa- ja pohjarakennus', nameEn: 'Earth and foundation' },
  { id: 2, nameFi: 'Perustukset ja ulkopuoliset rakenteet', nameEn: 'Foundations and external structures' },
  { id: 3, nameFi: 'Runko- ja vesikattorakenteet', nameEn: 'Frame and roof structures' },
  { id: 4, nameFi: 'Täydentävät rakenteet', nameEn: 'Complementary structures' },
  { id: 5, nameFi: 'Pintarakenteet', nameEn: 'Surface structures' },
  { id: 6, nameFi: 'Kalusteet, varusteet ja laitteet', nameEn: 'Furniture, equipment' },
  { id: 7, nameFi: 'Konetekniset työt', nameEn: 'MEP / technical' },
  { id: 8, nameFi: 'Työmaan käyttökustannukset', nameEn: 'Site usage costs' },
  { id: 9, nameFi: 'Työmaan yhteiskustannukset', nameEn: 'Site overhead' },
];

/**
 * Deriva el grupo principal (0-9) desde taloCode (ej. "1212", "1241").
 * Primer dígito del código → pääryhmä.
 * Si no se puede derivar, devuelve -1 (sin grupo).
 */
export function getMainGroupFromTaloCode(taloCode: string): number {
  if (!taloCode || typeof taloCode !== 'string') return -1;
  const cleaned = taloCode.replace(/[.\s]/g, '');
  const first = cleaned.charAt(0);
  const n = parseInt(first, 10);
  return n >= 0 && n <= 9 ? n : -1;
}

/**
 * Deriva el grupo principal desde Littera code (ej. "111005", "3152040").
 * Primer dígito → pääryhmä.
 */
export function getMainGroupFromLitteraCode(litteraCode: string): number {
  if (!litteraCode || typeof litteraCode !== 'string') return -1;
  const cleaned = String(litteraCode).replace(/\D/g, '');
  if (cleaned.length === 0) return -1;
  const n = parseInt(cleaned.charAt(0), 10);
  return n >= 0 && n <= 9 ? n : -1;
}
