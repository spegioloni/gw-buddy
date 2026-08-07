// Gemeinsames Vokabular: kanonische Keys <-> deutsche Anzeigenamen.
// Reihenfolge = Anzeigereihenfolge in der Gesamtübersicht.

export const RESOURCES = [
  { key: 'iron', de: 'Eisen', icon: '⛏️' },
  { key: 'lutinum', de: 'Lutinum', icon: '💠' },
  { key: 'water', de: 'Wasser', icon: '💧' },
  { key: 'hydrogen', de: 'Wasserstoff', icon: '🔥' },
];

export const BUILDINGS = [
  { key: 'commandCenter', de: 'Kommandozentrale' },
  { key: 'researchCenter', de: 'Forschungszentrum' },
  { key: 'tradingPost', de: 'Handelsposten' },
  { key: 'ironMine', de: 'Eisenmine' },
  { key: 'lutinumRefinery', de: 'Lutinumraffinerie' },
  { key: 'drillingTower', de: 'Bohrturm' },
  { key: 'chemicalFactory', de: 'Chemiefabrik' },
  { key: 'extendedChemicalFactory', de: 'Erweiterte Chemiefabrik' },
  { key: 'ironStorage', de: 'Eisenspeicher' },
  { key: 'lutinumStorage', de: 'Lutinumspeicher' },
  { key: 'waterStorage', de: 'Wassertanks' },
  { key: 'hydrogenStorage', de: 'Wasserstofftanks' },
  { key: 'shipFactory', de: 'Schiffsfabrik' },
  { key: 'orbitalDefenceStation', de: 'Orbitale Verteidigungsstation' },
  { key: 'planetaryShield', de: 'Planetarer Schild' },
  { key: 'fusionReactor', de: 'Fusionsreaktor' },
];

export const SHIPS = [
  { key: 'schakal', de: 'Schakal' },
  { key: 'recycler', de: 'Recycler' },
  { key: 'spyProbe', de: 'Spionagesonde' },
  { key: 'renegade', de: 'Renegade' },
  { key: 'raider', de: 'Raider' },
  { key: 'falcon', de: 'Falcon' },
  { key: 'colonisationShip', de: 'Kolonisationsschiff' },
  { key: 'tjuger', de: 'Tjuger' },
  { key: 'cougar', de: 'Cougar' },
  { key: 'longeagleV', de: 'Longeagle V' },
  { key: 'smallTrader', de: 'Kleines Handelsschiff' },
  { key: 'largeTrader', de: 'Großes Handelsschiff' },
  { key: 'noah', de: 'Noah' },
  { key: 'longeagleX', de: 'Longeagle X' },
];

export const DEFENSE = [
  { key: 'lightLaser', de: 'Leichter Laserturm' },
  { key: 'laser', de: 'Laserturm' },
  { key: 'empLauncher', de: 'EMP-Werfer' },
  { key: 'plasma', de: 'Plasmaturm' },
  { key: 'raks', de: 'Raks' },
];

const buildIndex = (list) => {
  const m = new Map();
  for (const it of list) m.set(norm(it.de), it.key);
  return m;
};
const norm = (s) => String(s || '').trim().toLowerCase();

const B_IDX = buildIndex(BUILDINGS);
const S_IDX = buildIndex(SHIPS);
const D_IDX = buildIndex(DEFENSE);
const R_IDX = buildIndex(RESOURCES);

export const buildingKey = (de) => B_IDX.get(norm(de)) ?? null;
export const shipKey = (de) => S_IDX.get(norm(de)) ?? null;
export const defenceKey = (de) => D_IDX.get(norm(de)) ?? null;
export const resourceKey = (de) => R_IDX.get(norm(de)) ?? null;

export const deLabel = {
  building: (key) => BUILDINGS.find((b) => b.key === key)?.de ?? key,
  ship: (key) => SHIPS.find((s) => s.key === key)?.de ?? key,
  defence: (key) => DEFENSE.find((d) => d.key === key)?.de ?? key,
  resource: (key) => RESOURCES.find((r) => r.key === key)?.de ?? key,
};
