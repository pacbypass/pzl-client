/**
 * Endpoint catalog reconstructed from the decompiled bundle.
 * Full raw list: docs/api-endpoints.txt
 *
 * Almost every business resource is scoped to a hunting-club `unitId`:
 *   /units/{unit-id}/<resource>/...
 */

const unit = (unitId: string) => `/units/${encodeURIComponent(unitId)}`;

export const endpoints = {
  // ---- global / cross-cutting ----
  dictionaries: {
    byName: (name: string) => `/dictionaries/${encodeURIComponent(name)}`,
    byNameFull: (name: string) => `/dictionaries/${encodeURIComponent(name)}/full`,
    animalType: '/dictionaries/animal-type',
    counties: '/dictionaries/counties',
    voivodeship: '/dictionaries/voivodeship',
    countries: '/dictionaries/countries',
    measurementUnit: '/dictionaries/measurement-unit',
    years: '/dictionaries/years',
  },

  notifications: {
    unreadCount: '/number-of-unread-notification',
  },

  // ---- unit-scoped resources ----
  units: '/units',

  annualHuntingPlans: (u: string) => ({
    list: `${unit(u)}/annual-hunting-plans`,
    byHash: (hash: string) => `${unit(u)}/annual-hunting-plans/${hash}`,
    executionPlan: `${unit(u)}/annual-hunting-plans/execution-plan`,
    executionPlanDocument: `${unit(u)}/annual-hunting-plans/execution-plan/document`,
    newPlanAvailable: `${unit(u)}/annual-hunting-plans/new-plan-available`,
    huntingDistrictsSimple: (year: string | number) =>
      `${unit(u)}/annual-hunting-plans/hunting-districts/simple/${year}`,
  }),

  // Electronic hunting book (LOW-1) + individual hunting entries.
  huntingBook: (u: string) => ({
    // "Who's hunting now" — individual hunting entries, filter by active status.
    huntings: `${unit(u)}/huntings`,
    huntingById: (id: string) => `${unit(u)}/huntings/${id}`,
    mine: `${unit(u)}/huntings/me`,
    book: `${unit(u)}/electronic-hunting-book`,
    // Create / read a hunt entry — district-scoped collection (POST creates a
    // sign-up; GET lists the book). NOTE: `electronic-hunting-book/forms/solo-sign-up`
    // is a SCREEN route in the original app, NOT an API path (POSTing there 404s).
    districtHuntings: (districtId: string | number) =>
      `${unit(u)}/hunting-districts/${districtId}/huntings`,
    districtHuntingById: (districtId: string | number, id: string) =>
      `${unit(u)}/hunting-districts/${districtId}/huntings/${id}`,
    inspections: `${unit(u)}/electronic-hunting-book/inspections`,
    low1: `${unit(u)}/low1`,
    low1Statuses: `${unit(u)}/low1/dictionaries/statuses`,
  }),

  // GeoJSON layers for the map (drawn + cached locally for offline use).
  geo: (u: string) => ({
    huntingDistrictsMap: `${unit(u)}/hunting-districts/map`,
    huntingDistrictsSimple: `${unit(u)}/hunting-districts/active/simple`,
    groundsMap: `${unit(u)}/hunting-districts/grounds-map`,
    grounds: `${unit(u)}/grounds/all`,
    huntingDevicesMap: `${unit(u)}/hunting-devices/map`,
    huntingStationsMap: `${unit(u)}/hunting-stations/map`,
    huntingToolsGeometries: `${unit(u)}/hunting-tools/geometries`,
    standsAll: `${unit(u)}/hunting-tools/stands/all`,
  }),

  multiYearPlans: (u: string) => ({
    list: `${unit(u)}/multi-year-plans`,
  }),

  collectiveHuntings: (u: string) => ({
    list: `${unit(u)}/collective-huntings`,
    byId: (id: string) => `${unit(u)}/collective-huntings/${id}`,
    mine: `${unit(u)}/collective-huntings/me`,
    map: `${unit(u)}/collective-huntings/map`,
    nextNumber: `${unit(u)}/collective-huntings/next-number`,
    approve: (id: string) => `${unit(u)}/collective-huntings/${id}:approve`,
    cancel: (id: string) => `${unit(u)}/collective-huntings/${id}:cancel`,
  }),

  collectiveHuntingSettlements: (u: string) => ({
    list: `${unit(u)}/collective-hunting-settlements`,
    balance: `${unit(u)}/collective-hunting-settlements/balance`,
    toSettle: `${unit(u)}/collective-hunting-settlements/to-settle`,
  }),

  huntings: (u: string) => ({
    list: `${unit(u)}/huntings`,
    settlements: `${unit(u)}/hunting-settlements`,
    financialSettlements: `${unit(u)}/hunting-financial-settlements`,
    ekep: `${unit(u)}/hunting-settlements-ekep`,
  }),

  electronicHuntingBook: (u: string) => ({
    low1: `${unit(u)}/low1`,
    low1Attach: `${unit(u)}/low1-attach`,
  }),

  materialBook: (u: string) => ({
    list: `${unit(u)}/material-book`,
  }),

  huntingDamages: (u: string) => ({
    list: `${unit(u)}/hunting-damages`,
    byId: (id: string) => `${unit(u)}/hunting-damages/${id}`,
    details: (id: string) => `${unit(u)}/hunting-damages/${id}/details-hunting-damages`,
  }),

  gameBreedingCenters: (u: string) => ({
    list: `${unit(u)}/game-breeding-centers`,
    authorizations: `${unit(u)}/game-breeding-centers/authorizations`,
  }),

  boardMeetings: (u: string) => ({
    list: `${unit(u)}/board-meetings`,
    protocols: `${unit(u)}/board-protocols`,
    resolutions: `${unit(u)}/management-resolution`,
    announcements: `${unit(u)}/management-announcements`,
  }),

  districtBoardReports: (u: string) => ({
    asfWeekly: `${unit(u)}/district-board-reports/asf-weekly`,
    asfWeeklySummaries: `${unit(u)}/district-board-reports/asf-weekly/summaries`,
  }),

  economicActivity: (u: string) => ({
    plans: `${unit(u)}/economic-activity-plans`,
    protocols: `${unit(u)}/economic-activity-protocols`,
  }),

  authorizations: (u: string) => ({
    list: `${unit(u)}/authorizations`,
    mine: `${unit(u)}/authorizations/me`,
    nextNumber: `${unit(u)}/authorizations/next-number`,
    schemas: `${unit(u)}/authorizations/schemas`,
    summary: `${unit(u)}/authorizations/summary`,
    issue: (id: string) => `${unit(u)}/authorizations/${id}:issue`,
    extend: (id: string) => `${unit(u)}/authorizations/${id}:extend`,
    block: (id: string) => `${unit(u)}/authorizations/${id}:block`,
    return: (id: string) => `${unit(u)}/authorizations/${id}:return`,
    reserve: (id: string) => `${unit(u)}/authorizations/${id}:reserve`,
    generateDocument: (id: string) =>
      `${unit(u)}/authorizations/${id}:generate-document`,
  }),

  hunters: (u: string) => ({
    list: `${unit(u)}/hunters`,
    // hunters-list is officer-only (403 for regular members). For picking a
    // hunter to book (sign-up "Inny myśliwy") use the active-hunters picker,
    // then that hunter's permits.
    simpleList: `${unit(u)}/hunters-list`,
    activeHuntersSimple: `${unit(u)}/persons/active-hunters/simple`,
    permits: (hunterId: string | number) =>
      `${unit(u)}/persons/hunters/${hunterId}/permits`,
    invited: `${unit(u)}/hunter-invited`,
    localization: `${unit(u)}/hunter-localization`,
    trainees: `${unit(u)}/trainees`,
    candidates: `${unit(u)}/candidates`,
    applications: `${unit(u)}/applications`,
    roleApplications: `${unit(u)}/role-applications`,
  }),

  finances: (u: string) => ({
    list: `${unit(u)}/finances`,
    deposits: `${unit(u)}/deposits`,
    contractsLeases: `${unit(u)}/contracts-leases`,
  }),

  communication: (u: string) => ({
    messages: `${unit(u)}/messages`,
    inbox: `${unit(u)}/inbox`,
    readInbox: `${unit(u)}/read-inbox`,
    readAllInbox: `${unit(u)}/read-all-inbox`,
    sms: `${unit(u)}/sms`,
    email: `${unit(u)}/email`,
    news: `${unit(u)}/news`,
  }),

  personalData: (u: string) => ({
    self: `${unit(u)}/personal-data`,
    persons: `${unit(u)}/persons`,
    users: `${unit(u)}/users`,
  }),

  huntingDistricts: (u: string) => ({
    list: `${unit(u)}/hunting-districts`,
  }),
} as const;
