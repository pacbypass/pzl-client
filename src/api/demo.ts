/**
 * Demo mode — lets the app run with no backend so the UI can be tested offline
 * or on a host the PZŁ auth server won't accept. When enabled, apiRequest is
 * short-circuited to these in-memory fixtures. The hunts store is *stateful*, so
 * signing up / ending hunts actually works and persists within the session.
 */
let demoEnabled = false;

const FLAG_KEY = 'pzl.demoMode';

export function isDemo(): boolean {
  return demoEnabled;
}

export function setDemo(on: boolean) {
  demoEnabled = on;
  if (typeof localStorage !== 'undefined') {
    if (on) localStorage.setItem(FLAG_KEY, '1');
    else localStorage.removeItem(FLAG_KEY);
  }
}

export function loadDemoFlag() {
  if (typeof localStorage !== 'undefined') {
    demoEnabled = localStorage.getItem(FLAG_KEY) === '1';
  }
}

/** A base64url id_token payload so Profile shows a demo name. */
export function demoIdToken(): string {
  const payload = { name: 'Jan Kowalski (demo)', email: 'demo@pzl.local' };
  const b64 =
    typeof btoa === 'function'
      ? btoa(JSON.stringify(payload))
      : Buffer.from(JSON.stringify(payload)).toString('base64');
  const url = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `demo.${url}.demo`;
}

// ---- stateful hunts ----
type Hunt = {
  id: string;
  hunterName: string;
  huntingDistrictId: string;
  huntingDistrictName: string;
  standNumber?: string;
  animalTypeName?: string;
  startTimestamp: string;
  endTimestamp?: string | null;
  isActive: boolean;
  status: string;
};

function minsAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}

let hunts: Hunt[] = [
  {
    id: 'h1',
    hunterName: 'Andrzej Nowak',
    huntingDistrictId: 'd1',
    huntingDistrictName: 'Obwód 123 — Ponowa',
    standNumber: 'A-4',
    animalTypeName: 'Dzik',
    startTimestamp: minsAgo(95),
    isActive: true,
    status: 'ACTIVE',
  },
  {
    id: 'h2',
    hunterName: 'Marek Wiśniewski',
    huntingDistrictId: 'd2',
    huntingDistrictName: 'Obwód 088 — Bór',
    standNumber: 'B-1',
    animalTypeName: 'Sarna',
    startTimestamp: minsAgo(40),
    isActive: true,
    status: 'ACTIVE',
  },
];

let seq = 100;

// ---- geo fixtures (near Warsaw so they're easy to find) ----
function ring(cx: number, cy: number, r: number) {
  return [
    [cx - r, cy - r],
    [cx + r, cy - r],
    [cx + r, cy + r],
    [cx - r, cy + r],
    [cx - r, cy - r],
  ];
}

const districtsGeo = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 'd1', number: '123', name: 'Ponowa' },
      geometry: { type: 'Polygon', coordinates: [ring(21.0, 52.2, 0.12)] },
    },
    {
      type: 'Feature',
      properties: { id: 'd2', number: '088', name: 'Bór' },
      geometry: { type: 'Polygon', coordinates: [ring(21.35, 52.05, 0.1)] },
    },
  ],
};

// Rewiry (sub-sectors) within the demo obwód.
const groundsData = [
  { huntingGroundId: 1, huntingDistrictId: 1, name: '1', color: '#007fff', geometry: { type: 'Polygon', coordinates: [ring(20.95, 52.24, 0.05)] } },
  { huntingGroundId: 2, huntingDistrictId: 1, name: '2', color: '#007fff', geometry: { type: 'Polygon', coordinates: [ring(21.05, 52.24, 0.05)] } },
  { huntingGroundId: 3, huntingDistrictId: 1, name: '3', color: '#007fff', geometry: { type: 'Polygon', coordinates: [ring(20.95, 52.15, 0.05)] } },
  { huntingGroundId: 4, huntingDistrictId: 1, name: '4', color: '#007fff', geometry: { type: 'Polygon', coordinates: [ring(21.05, 52.15, 0.05)] } },
];

const devicesGeo = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { id: 'dev1', type: 'Ambona' }, geometry: { type: 'Point', coordinates: [21.02, 52.22] } },
    { type: 'Feature', properties: { id: 'dev2', type: 'Paśnik' }, geometry: { type: 'Point', coordinates: [20.95, 52.16] } },
    { type: 'Feature', properties: { id: 'dev3', type: 'Lizawka' }, geometry: { type: 'Point', coordinates: [21.33, 52.06] } },
  ],
};

// Hunting devices (urządzenia łowieckie) with coordinates + types.
const deviceTypes = [
  { value: 34, label: 'Zwyżka' },
  { value: 3, label: 'Ambona' },
  { value: 1, label: 'Paśnik' },
  { value: 2, label: 'Lizawka' },
];
function dev(id: number, name: string, typeId: number, typeName: string, lng: number, lat: number) {
  return {
    registerId: id,
    registerName: name,
    registerTypeId: typeId,
    registerTypeName: typeName,
    marker: { type: 'Point', coordinates: [lng, lat] },
    huntingDistrictId: 1,
  };
}
const devices = [
  dev(1, 'Ambona przy lesie', 3, 'Ambona', 21.01, 52.21),
  dev(2, 'Zwyżka za kurnikami', 34, 'Zwyżka', 21.03, 52.19),
  dev(3, 'Ambona łąkowa', 3, 'Ambona', 20.98, 52.17),
  dev(4, 'Paśnik centralny', 1, 'Paśnik', 21.34, 52.06),
  dev(5, 'Lizawka nad rzeką', 2, 'Lizawka', 21.36, 52.04),
];

// Książka ewidencji — some entries, one currently hunting.
const bookEntries = [
  {
    id: 1, number: 145, startDate: minsAgo(70), endDate: null, huntingDistrictId: 1,
    leadingPersonFullname: 'Andrzej Nowak', huntingPlace: 'Rewir: 17 (Ambona A-4)',
    permitNumber: '12/2026', isStarted: true, isEnded: false, shotsFired: 0, animals: null,
    checkoutPersonFullname: 'Andrzej Nowak',
  },
  {
    id: 2, number: 144, startDate: minsAgo(40), endDate: null, huntingDistrictId: 1,
    leadingPersonFullname: 'Marek Wiśniewski', huntingPlace: 'Rewir: 18 (Zwyżka B-1)',
    permitNumber: '09/2026', isStarted: true, isEnded: false, shotsFired: 1, animals: null,
    checkoutPersonFullname: 'Marek Wiśniewski',
  },
  {
    id: 3, number: 140, startDate: minsAgo(1500), endDate: minsAgo(1350), huntingDistrictId: 1,
    leadingPersonFullname: 'Piotr Zieliński', huntingPlace: 'Rewir: 4 (Paśnik C-2)',
    permitNumber: '07/2026', isStarted: true, isEnded: true, shotsFired: 2,
    animals: [{ animalName: 'Dzik', amount: 1, sex: 'samiec' }],
    checkoutPersonFullname: 'Piotr Zieliński', checkinPersonFullname: 'Piotr Zieliński',
  },
];

const eventAnimals = [
  { animalTypeId: 1, animalName: 'Dzik' },
  { animalTypeId: 2, animalName: 'Sarna' },
  { animalTypeId: 3, animalName: 'Jeleń szlachetny' },
  { animalTypeId: 4, animalName: 'Lis' },
];
const eventTypes = [
  { eventTypeId: 1, eventTypeName: 'Odstrzał' },
  { eventTypeId: 4, eventTypeName: 'Odłów' },
  { eventTypeId: 3, eventTypeName: 'Odstrzał niezgodny z pozwoleniem' },
];

const units = [
  { id: 'demo-unit', name: 'KŁ Demo „Ponowa”', type: 'Koło łowieckie', number: '123' },
];

const districtOptions = [
  { id: 'd1', number: '123', name: 'Obwód 123 — Ponowa' },
  { id: 'd2', number: '088', name: 'Obwód 088 — Bór' },
];

const standOptions = [
  { id: 's1', number: 'A-4' },
  { id: 's2', number: 'B-1' },
  { id: 's3', number: 'C-2' },
];

const hunterOptions = [
  { id: 'p1', fullName: 'Andrzej Nowak' },
  { id: 'p2', fullName: 'Marek Wiśniewski' },
  { id: 'p3', fullName: 'Piotr Zieliński' },
  { id: 'p4', fullName: 'Tomasz Lewandowski' },
];

const animalTypes = [
  { id: 'a1', name: 'Dzik' },
  { id: 'a2', name: 'Sarna' },
  { id: 'a3', name: 'Jeleń' },
  { id: 'a4', name: 'Lis' },
];

function planRow(fullName: string, plannedHarvest: number, harvested: number) {
  return {
    animal: { name: fullName, fullName },
    plannedHarvest,
    harvested,
    remainingToHarvest: Math.max(0, plannedHarvest - harvested),
    executionRate: plannedHarvest > 0 ? harvested / plannedHarvest : 0,
  };
}

const planExecution = {
  huntingLargeAnimal: [
    planRow('Jeleń szlachetny · byki', 12, 7),
    planRow('Jeleń szlachetny · łanie', 20, 18),
    planRow('Sarna · kozły', 30, 9),
    planRow('Dzik', 45, 46),
  ],
  huntingSmallAnimal: [planRow('Lis', 25, 4)],
  animals: [],
  igoAnimals: [],
};

const years = [
  { value: 2026, label: '2026-2027', isActual: true },
  { value: 2025, label: '2025-2026', isActual: false },
];

/** Route the request to a fixture. `path` is the API path (no origin). */
export function demoResponse(
  path: string,
  method: string,
  body: unknown,
): unknown {
  const m = method.toUpperCase();

  // current user's hunts: { result, total }
  if (path.endsWith('/huntings/me')) {
    return { result: hunts.filter((h) => h.isActive), total: hunts.length };
  }
  // hunts collection
  if (/\/huntings(\?|$)/.test(path) || /\/huntings$/.test(path)) {
    if (m === 'POST') {
      const b = (body ?? {}) as Record<string, unknown>;
      const hunter =
        hunterOptions.find((h) => h.id === b.hunterId)?.fullName ?? 'Ja (demo)';
      const district =
        districtOptions.find((d) => d.id === b.huntingDistrictId);
      const created: Hunt = {
        id: `h${seq++}`,
        hunterName: hunter,
        huntingDistrictId: String(b.huntingDistrictId ?? 'd1'),
        huntingDistrictName: district?.name ?? 'Obwód (demo)',
        standNumber: standOptions.find((s) => s.id === b.standId)?.number,
        animalTypeName: animalTypes.find((a) => a.id === b.animalTypeId)?.name,
        startTimestamp: String(b.startTimestamp ?? new Date().toISOString()),
        isActive: true,
        status: 'ACTIVE',
      };
      hunts = [...hunts, created];
      return created;
    }
    return hunts.filter((h) => h.isActive);
  }
  // solo sign-up form
  if (path.includes('/electronic-hunting-book/forms/solo-sign-up')) {
    const b = (body ?? {}) as Record<string, unknown>;
    const created: Hunt = {
      id: `h${seq++}`,
      hunterName: 'Jan Kowalski (demo)',
      huntingDistrictId: String(b.huntingDistrictId ?? 'd1'),
      huntingDistrictName:
        districtOptions.find((d) => d.id === b.huntingDistrictId)?.name ??
        'Obwód (demo)',
      standNumber: standOptions.find((s) => s.id === b.standId)?.number,
      animalTypeName: animalTypes.find((a) => a.id === b.animalTypeId)?.name,
      startTimestamp: String(b.startTimestamp ?? new Date().toISOString()),
      isActive: true,
      status: 'ACTIVE',
    };
    hunts = [...hunts, created];
    return created;
  }
  // end/patch a hunt
  const patchMatch = path.match(/\/huntings\/([^/?]+)$/);
  if (patchMatch && (m === 'PATCH' || m === 'PUT')) {
    const id = patchMatch[1];
    hunts = hunts.map((h) =>
      h.id === id
        ? { ...h, isActive: false, status: 'FINISHED', endTimestamp: new Date().toISOString() }
        : h,
    );
    return hunts.find((h) => h.id === id) ?? {};
  }

  if (path.includes('/userinfo')) {
    return {
      username: 'demo',
      firstname: 'Jan',
      lastname: 'Kowalski',
      email: 'demo@pzl.local',
      units: [
        {
          id: 'demo-unit',
          name: 'KŁ Demo „Ponowa”',
          type: 'KL',
          typeName: 'Koło Łowieckie',
          roles: [{ name: 'Łowczy', systemId: 'LOWCZY' }],
        },
      ],
    };
  }
  if (path.endsWith('/units')) return units;
  if (path.includes('/annual-hunting-plans/execution-plan')) return planExecution;
  if (path.includes('/dictionaries/years')) return years;
  if (path.includes('/hunting-events/animals')) return eventAnimals;
  if (path.includes('/hunting-events/event-types')) return eventTypes;
  if (path.includes('/hunting-tools/dictionaries/types')) return deviceTypes;
  if (path.includes('/hunting-tools/all')) return devices;
  if (path.includes('/hunting-districts/grounds/all')) return groundsData;
  if (/\/hunting-districts\/[^/]+\/huntings/.test(path)) {
    return { result: bookEntries, total: bookEntries.length };
  }
  if (path.includes('/hunting-districts/map')) return districtsGeo;
  if (path.includes('/hunting-districts/active/simple')) return districtOptions;
  if (path.endsWith('/hunting-districts')) return districtsGeo;
  if (path.includes('/hunting-districts/grounds-map')) return { type: 'FeatureCollection', features: [] };
  if (path.includes('/hunting-devices/map')) return devicesGeo;
  if (path.includes('/hunting-stations/map')) return { type: 'FeatureCollection', features: [] };
  if (path.includes('/hunting-tools/stands/all')) return standOptions;
  if (path.includes('/hunters-list') || path.includes('/hunters')) return hunterOptions;
  if (path.includes('/dictionaries/animal-type')) return animalTypes;
  if (path.includes('/inbox')) return [];

  // default: empty list is the safest shape for the app's normalizers
  return [];
}
