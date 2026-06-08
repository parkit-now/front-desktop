interface BrandEntry {
  name: string;
  aliases: string[];
  models: string[];
}

const BRANDS: BrandEntry[] = [
  {
    name: 'Volkswagen',
    aliases: ['vw', 'volks', 'volkswagen'],
    models: [
      'Gol',
      'Golf',
      'Polo',
      'Bora',
      'Vento',
      'Suran',
      'Saveiro',
      'Fox',
      'Amarok',
      'Tiguan',
      'T-Cross',
      'Virtus',
      'Taos',
      'Nivus',
      'Up',
    ],
  },
  {
    name: 'Ford',
    aliases: ['ford'],
    models: [
      'Fiesta',
      'Focus',
      'Ka',
      'EcoSport',
      'Kuga',
      'Ranger',
      'Mondeo',
      'Fusion',
      'Expedition',
      'Bronco',
      'Territory',
      'Bronco Sport',
    ],
  },
  {
    name: 'Chevrolet',
    aliases: ['chev', 'chevy', 'chevrolet', 'gm'],
    models: [
      'Onix',
      'Cruze',
      'Tracker',
      'Equinox',
      'Spin',
      'Prisma',
      'Montana',
      'S10',
      'Corsa',
      'Agile',
      'Cobalt',
      'Sail',
    ],
  },
  {
    name: 'Renault',
    aliases: ['renault', 'reno'],
    models: [
      'Kangoo',
      'Sandero',
      'Logan',
      'Duster',
      'Kwid',
      'Oroch',
      'Captur',
      'Megane',
      'Symbol',
      'Clio',
      'Fluence',
    ],
  },
  {
    name: 'Fiat',
    aliases: ['fiat'],
    models: [
      'Palio',
      'Siena',
      'Uno',
      'Punto',
      'Cronos',
      'Argo',
      'Toro',
      'Pulse',
      'Mobi',
      'Strada',
      'Fiorino',
      '500',
    ],
  },
  {
    name: 'Toyota',
    aliases: ['toyota', 'toy'],
    models: [
      'Corolla',
      'Yaris',
      'Hilux',
      'SW4',
      'RAV4',
      'Land Cruiser',
      'Etios',
      'Camry',
      'Fortuner',
      'C-HR',
      'GR86',
    ],
  },
  {
    name: 'Honda',
    aliases: ['honda'],
    models: [
      'Civic',
      'Fit',
      'HR-V',
      'CR-V',
      'WR-V',
      'City',
      'Jazz',
      'Accord',
      'Pilot',
      'Ridgeline',
    ],
  },
  {
    name: 'Peugeot',
    aliases: ['peugeot', 'peug'],
    models: [
      '208',
      '308',
      '408',
      '2008',
      '3008',
      '5008',
      'Partner',
      'Expert',
      '107',
      '206',
      '207',
      '301',
      '307',
      '308',
      '308 SW',
    ],
  },
  {
    name: 'Citroën',
    aliases: ['citroen', 'citroën', 'cit'],
    models: [
      'C3',
      'C4',
      'C5',
      'C3 Aircross',
      'Berlingo',
      'Jumper',
      'Jumpy',
      'Picasso',
      'C-Elysée',
    ],
  },
  {
    name: 'Nissan',
    aliases: ['nissan'],
    models: [
      'March',
      'Versa',
      'Sentra',
      'Tiida',
      'Frontier',
      'X-Trail',
      'Kicks',
      'Qashqai',
      'Navara',
      'Patrol',
    ],
  },
  {
    name: 'Hyundai',
    aliases: ['hyundai', 'hyund'],
    models: [
      'HB20',
      'i10',
      'i20',
      'i30',
      'Tucson',
      'Santa Fe',
      'Creta',
      'Elantra',
      'Accent',
      'Veloster',
    ],
  },
  {
    name: 'Kia',
    aliases: ['kia'],
    models: [
      'Picanto',
      'Rio',
      'Cerato',
      'Sportage',
      'Sorento',
      'Soul',
      'Stinger',
      'Seltos',
      'Carnival',
    ],
  },
  {
    name: 'Jeep',
    aliases: ['jeep'],
    models: [
      'Renegade',
      'Compass',
      'Cherokee',
      'Grand Cherokee',
      'Wrangler',
      'Gladiator',
    ],
  },
  {
    name: 'Audi',
    aliases: ['audi'],
    models: [
      'A1',
      'A3',
      'A4',
      'A5',
      'A6',
      'A7',
      'A8',
      'Q2',
      'Q3',
      'Q5',
      'Q7',
      'Q8',
      'TT',
      'RS3',
      'RS5',
    ],
  },
  {
    name: 'BMW',
    aliases: ['bmw'],
    models: [
      '116i',
      '118i',
      '120i',
      '316i',
      '318i',
      '320i',
      '330i',
      'X1',
      'X2',
      'X3',
      'X4',
      'X5',
      'X6',
      'M3',
      'M5',
    ],
  },
  {
    name: 'Mercedes-Benz',
    aliases: ['mercedes', 'benz', 'mb', 'mercedez'],
    models: [
      'Clase A',
      'Clase C',
      'Clase E',
      'Clase S',
      'GLA',
      'GLB',
      'GLC',
      'GLE',
      'GLS',
      'Sprinter',
      'Vito',
    ],
  },
  {
    name: 'Subaru',
    aliases: ['subaru'],
    models: ['Impreza', 'Legacy', 'Outback', 'Forester', 'XV', 'WRX', 'BRZ'],
  },
  {
    name: 'Mitsubishi',
    aliases: ['mitsubishi', 'mitsu'],
    models: ['L200', 'Outlander', 'Eclipse Cross', 'ASX', 'Pajero', 'Lancer'],
  },
  {
    name: 'Mazda',
    aliases: ['mazda'],
    models: ['2', '3', '6', 'CX-3', 'CX-5', 'CX-30', 'MX-5'],
  },
  {
    name: 'Dodge',
    aliases: ['dodge'],
    models: ['Ram', 'Durango', 'Challenger', 'Charger', 'Journey'],
  },
  {
    name: 'Ram',
    aliases: ['ram'],
    models: ['700', '1500', '2500', '3500'],
  },
  {
    name: 'Suzuki',
    aliases: ['suzuki', 'suzu'],
    models: ['Swift', 'Vitara', 'S-Cross', 'Jimny', 'Baleno', 'Ignis'],
  },
  {
    name: 'Chery',
    aliases: ['chery'],
    models: [
      'Tiggo 2',
      'Tiggo 3',
      'Tiggo 4',
      'Tiggo 7',
      'Tiggo 8',
      'Arrizo 5',
      'QQ',
    ],
  },
  {
    name: 'Geely',
    aliases: ['geely'],
    models: ['Emgrand', 'Coolray', 'Okavango', 'GX3 Pro'],
  },
  {
    name: 'BYD',
    aliases: ['byd'],
    models: ['Dolphin', 'Atto 3', 'Han', 'Tang', 'Song Pro', 'Yuan Pro'],
  },
  {
    name: 'Great Wall',
    aliases: ['great wall', 'greatwall', 'gw', 'gwm'],
    models: ['Wingle', 'Poer', 'Haval H6', 'Haval Jolion'],
  },
  {
    name: 'Lifan',
    aliases: ['lifan'],
    models: ['520', '620', '720', 'X50', 'X60', 'X70'],
  },
];

export function searchBrands(query: string): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return BRANDS.filter(
    (b) =>
      b.name.toLowerCase().includes(q) || b.aliases.some((a) => a.includes(q)),
  ).map((b) => b.name);
}

export function searchModels(brand: string, query: string): string[] {
  const b = BRANDS.find((e) => e.name.toLowerCase() === brand.toLowerCase());
  if (!b) return [];
  const q = query.toLowerCase().trim();
  if (!q) return b.models;
  return b.models.filter((m) => m.toLowerCase().includes(q));
}

export const ALL_BRAND_NAMES = BRANDS.map((b) => b.name);

export interface StaticVehicle {
  brand: string;
  model: string;
}

export function getAllStaticVehicles(): StaticVehicle[] {
  return BRANDS.flatMap((b) =>
    b.models.map((m) => ({ brand: b.name, model: m })),
  );
}
