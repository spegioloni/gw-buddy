// Produktionswerte pro Stunde je Gebaeudestufe (aus den Spielwerten, Stufe 1-100).
// Verwendung: NICHT als absolute Rate, sondern nur fuer die *Differenz* bei einem
// anstehenden Ausbau. Die tatsaechliche Rate eines Planeten steht in der
// Gesamtuebersicht und enthaelt zusaetzlich eine Planeten-Grundproduktion; die
// wird je Planet aus (gemessen - Tabellenwert) kalibriert und bleibt erhalten.
/** Produktion pro Stunde je Ausbaustufe (Index = Stufe, 0 = kein Gebaeude). */
export const IRON_MINE = [
  0, 32, 64, 113, 178, 261, 376, 509, 660, 828, 1015, 1236,
  1475, 1733, 2010, 2306, 2638, 2990, 3361, 3753, 4164, 4613, 5083, 5573,
  6084, 6617, 7189, 7782, 8397, 9035, 9694, 10394, 11117, 11863, 12632, 13424,
  14258, 15116, 15998, 16905, 17836, 18810, 19809, 20833, 21883, 22958, 24077, 25223,
  26395, 27594, 28819, 30090, 31388, 32714, 34067, 35448, 36876, 38333, 39818, 41331,
  42874, 44465, 46086, 47736, 49416, 51125, 52885, 54676, 56497, 58348, 60231, 62166,
  64132, 66129, 68159, 70220, 72335, 74482, 76662, 78875, 81121, 83422, 85756, 88125,
  90527, 92963, 95456, 97983, 100545, 103142, 105775, 108465, 111191, 113952, 116750, 119585,
  122478, 125408, 128375, 131380, 134422,
];

/** Produktion pro Stunde je Ausbaustufe (Index = Stufe, 0 = kein Gebaeude). */
export const LUTINUM_REFINERY = [
  0, 20, 40, 70, 111, 163, 235, 318, 412, 518, 634, 772,
  922, 1083, 1256, 1441, 1649, 1869, 2101, 2345, 2602, 2883, 3176, 3483,
  3803, 4136, 4493, 4864, 5248, 5646, 6059, 6496, 6948, 7414, 7895, 8390,
  8911, 9448, 9999, 10565, 11147, 11756, 12380, 13020, 13676, 14348, 15048, 15764,
  16497, 17246, 18012, 18806, 19617, 20446, 21292, 22155, 23047, 23958, 24886, 25832,
  26796, 27790, 28803, 29835, 30885, 31953, 33053, 34172, 35310, 36468, 37644, 38853,
  40082, 41331, 42599, 43888, 45209, 46551, 47914, 49297, 50701, 52139, 53598, 55078,
  56579, 58102, 59660, 61239, 62840, 64464, 66109, 67790, 69494, 71220, 72969, 74740,
  76549, 78380, 80234, 82112, 84014,
];

/** Produktion pro Stunde je Ausbaustufe (Index = Stufe, 0 = kein Gebaeude). */
export const CHEMICAL_FACTORY = [
  0, 8, 16, 28, 44, 65, 94, 127, 165, 207, 253, 309,
  368, 433, 502, 576, 659, 747, 840, 938, 1041, 1153, 1270, 1393,
  1521, 1654, 1797, 1945, 2099, 2258, 2423, 2598, 2779, 2965, 3158, 3356,
  3564, 3779, 3999, 4226, 4459, 4702, 4952, 5208, 5470, 5739, 6019, 6305,
  6598, 6898, 7204, 7522, 7847, 8178, 8516, 8862, 9219, 9583, 9954, 10332,
  10718, 11116, 11521, 11934, 12354, 12781, 13221, 13669, 14124, 14587, 15057, 15541,
  16033, 16532, 17039, 17555, 18083, 18620, 19165, 19718, 20280, 20855, 21439, 22031,
  22631, 23240, 23864, 24495, 25136, 25785, 26443, 27116, 27797, 28488, 29187, 29896,
  30619, 31352, 32093, 32845, 33605,
];

/** Produktion pro Stunde je Ausbaustufe (Index = Stufe, 0 = kein Gebaeude). */
export const EXT_CHEMICAL_FACTORY = [
  0, 100, 201, 354, 558, 816, 1177, 1593, 2064, 2590, 3172, 3862,
  4611, 5417, 6283, 7208, 8246, 9345, 10505, 11728, 13014, 14417, 15884, 17417,
  19015, 20680, 22466, 24320, 26243, 28234, 30296, 32483, 34742, 37073, 39476, 41952,
  44558, 47240, 49996, 52829, 55738, 58781, 61904, 65104, 68384, 71744, 75243, 78823,
  82486, 86231, 90060, 94032, 98089, 102232, 106460, 110776, 115239, 119791, 124432, 129161,
  133982, 138954, 144019, 149175, 154425, 159768, 165268, 170863, 176553, 182340, 188224, 194269,
  200412, 206655, 212997, 219440, 226048, 232758, 239571, 246486, 253506, 260695, 267990, 275391,
  282898, 290512, 298300, 306198, 314204, 322321, 330547, 338953, 347472, 356102, 364846, 373703,
  382745, 391901, 401174, 410563, 420070,
];


/** Welches Gebaeude erzeugt welchen Rohstoff (Wasser bleibt aussen vor). */
export const PRODUCERS = {
  iron: ['ironMine'],
  lutinum: ['lutinumRefinery'],
  hydrogen: ['chemicalFactory', 'extendedChemicalFactory'],
};

/** Tabelle je Gebaeude-Key. */
export const PRODUCTION_TABLE = {
  ironMine: IRON_MINE,
  lutinumRefinery: LUTINUM_REFINERY,
  chemicalFactory: CHEMICAL_FACTORY,
  extendedChemicalFactory: EXT_CHEMICAL_FACTORY,
};

/** Tabellenwert einer Stufe, oberhalb der Tabelle auf den letzten Eintrag begrenzt. */
export function tableRate(buildingKey, level) {
  const t = PRODUCTION_TABLE[buildingKey];
  if (!t || !level || level < 1) return 0;
  return t[Math.min(level, t.length - 1)] ?? 0;
}
