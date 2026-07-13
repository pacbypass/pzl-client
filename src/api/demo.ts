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

const devicesGeo = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { id: 'dev1', type: 'Ambona' }, geometry: { type: 'Point', coordinates: [21.02, 52.22] } },
    { type: 'Feature', properties: { id: 'dev2', type: 'Paśnik' }, geometry: { type: 'Point', coordinates: [20.95, 52.16] } },
    { type: 'Feature', properties: { id: 'dev3', type: 'Lizawka' }, geometry: { type: 'Point', coordinates: [21.33, 52.06] } },
  ],
};

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

const planExecution = {
  year: new Date().getFullYear(),
  planDetails: [
    { animalTypeId: 'a3', animalTypeName: 'Jeleń szlachetny', category: 'byki', target: 12, done: 7 },
    { animalTypeId: 'a3b', animalTypeName: 'Jeleń szlachetny', category: 'łanie', target: 20, done: 18 },
    { animalTypeId: 'a2', animalTypeName: 'Sarna', category: 'kozły', target: 30, done: 9 },
    { animalTypeId: 'a1', animalTypeName: 'Dzik', target: 45, done: 46 },
    { animalTypeId: 'a4', animalTypeName: 'Lis', target: 25, done: 4 },
  ],
};

/** Route the request to a fixture. `path` is the API path (no origin). */
export function demoResponse(
  path: string,
  method: string,
  body: unknown,
): unknown {
  const m = method.toUpperCase();

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

  if (path.endsWith('/units')) return units;
  if (path.includes('/annual-hunting-plans/execution-plan')) return planExecution;
  if (path.includes('/hunting-districts/map')) return districtsGeo;
  if (path.includes('/hunting-districts/active/simple')) return districtOptions;
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
