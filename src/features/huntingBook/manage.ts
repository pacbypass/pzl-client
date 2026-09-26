import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest } from '@/api/client';

/**
 * Hunt management — harvested animals are recorded as "hunting events", and a
 * hunt is finished by updating it (endDate/isEnded). Endpoints + field names
 * reversed from the original app; request shapes verified against the live
 * dictionaries. The two mutations are wired but intentionally NOT exercised.
 */

export type EventAnimal = { animalTypeId: number; animalName: string };
export type EventType = { eventTypeId: number; eventTypeName: string };

/** A harvested animal recorded on a hunt ("pozyskanie"). */
export type HarvestedAnimal = {
  id?: number | string;
  animalName?: string;
  animalTypeName?: string;
  name?: string;
  sex?: string;
  age?: string | number;
  weight?: number;
  carcassWeight?: number;
  amount?: number;
  quantity?: number;
  carcassIdentifier?: string;
};

/** A wounded animal record ("postrzałek"). */
export type WoundedAnimal = {
  id?: number | string;
  animalName?: string;
  animalTypeName?: string;
  name?: string;
  shotsFired?: number;
  reason?: string;
  date?: string;
};

/** Full hunt detail incl. the server capability flags that gate every action. */
export type HuntDetail = {
  id: string;
  number?: string | number;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
  treasurerNotes?: string | null;
  leadingPersonFullname?: string | null;
  huntingPlace?: string | null;
  permitNumber?: string | null;
  checkinPersonFullname?: string | null;
  checkoutPersonFullname?: string | null;
  shotsFired?: number | null;
  huntingDistrictId?: string | number | null;
  huntingDistrictNumber?: string | null;
  isStarted?: boolean;
  isEnded?: boolean;
  isApproved?: boolean;
  withWoundedAnimals?: boolean;
  /** Entry status — a BOOLEAN: false ⟺ crossed out ("wykreślone"). */
  status?: boolean | string | number | null;
  statusName?: string | null;
  animals?: HarvestedAnimal[] | null;
  woundedAnimals?: WoundedAnimal[] | null;
  /** Permits attached to this hunt → `authorizationId` when adding an animal. */
  permitNumbers?: { id: number; number?: string }[] | null;
  /** Rewir(y) of this hunt → `groundId` when adding an animal. */
  huntingGrounds?: { huntingGroundId: number; name?: string }[] | null;
  // Server-computed permissions — same page for own/other hunt; these decide
  // what you may do (a club officer gets canEdit on others' hunts too).
  canEdit?: boolean;
  canDeleteHunting?: boolean;
  canChangeDataAfterEnd?: boolean;
  canChangeWoundedAnimalsAfterEnd?: boolean;
};

/**
 * Fresh hunt detail (with permission flags + animals/wounded lists) from
 * `/units/{u}/hunting-districts/{districtId}/huntings/{id}`. Seeded with the
 * list row passed via params so the page renders instantly / offline.
 */
export function useHuntDetail(
  unitId: string,
  districtId: string | number | undefined,
  huntingId: string | undefined,
  initialData?: HuntDetail,
) {
  return useQuery({
    queryKey: ['huntDetail', unitId, String(districtId), huntingId],
    enabled: !!unitId && !!districtId && !!huntingId,
    // placeholderData (not initialData) so the seed shows instantly BUT the
    // query still fetches fresh — that fetch is what brings the permission
    // flags (canEdit, …) and the animals/wounded lists.
    placeholderData: initialData,
    staleTime: 1000 * 30,
    queryFn: async () => {
      const d = await apiRequest<Record<string, unknown>>(
        `/units/${unitId}/hunting-districts/${districtId}/huntings/${huntingId}`,
      );
      return { ...(d as object), id: String((d as { id: unknown }).id) } as HuntDetail;
    },
  });
}

/** A recorded animal on a hunt (harvest OR wounded — split by `isWounded`). */
export type HuntAnimal = {
  id: number | string;
  animalId?: number;
  name?: string | null;
  quantity?: number | null;
  weight?: number | null;
  age?: string | number | null;
  isMale?: boolean | null;
  date?: string | null;
  isWounded?: boolean;
  isPredatory?: boolean;
};

/**
 * The hunt's recorded animals — the REAL list, from the sub-resource:
 *   GET /units/{u}/hunting-districts/{d}/huntings/{id}/animals
 * (The hunt-detail object's own `animals` field is just a comma-joined name
 * STRING like "Lis", not the objects — using it showed an empty list.)
 * Harvested = `!isWounded`, postrzałki = `isWounded`.
 */
export function useHuntAnimals(
  unitId: string,
  districtId: string | number | undefined,
  huntingId: string | undefined,
) {
  return useQuery({
    queryKey: ['huntAnimals', unitId, String(districtId), huntingId],
    enabled: !!unitId && !!districtId && !!huntingId,
    staleTime: 1000 * 30,
    queryFn: async () => {
      const d = await apiRequest<unknown>(
        `/units/${unitId}/hunting-districts/${districtId}/huntings/${huntingId}/animals`,
      );
      const arr = Array.isArray(d)
        ? d
        : ((d as { result?: unknown[] })?.result ?? []);
      return arr.map((r) => r as HuntAnimal);
    },
  });
}

export function useEventAnimals(unitId: string) {
  return useQuery({
    queryKey: ['event-animals', unitId],
    enabled: !!unitId,
    staleTime: 1000 * 60 * 60 * 24,
    queryFn: () =>
      apiRequest<EventAnimal[]>(`/units/${unitId}/hunting-events/animals`),
  });
}

export function useEventTypes(unitId: string) {
  return useQuery({
    queryKey: ['event-types', unitId],
    enabled: !!unitId,
    staleTime: 1000 * 60 * 60 * 24,
    queryFn: () =>
      apiRequest<EventType[]>(`/units/${unitId}/hunting-events/event-types`),
  });
}

/** An animal you may harvest against a permit ("pozyskanie"). Includes permit
 *  animals AND IGO (invasive/foreign) species. */
export type PermitAnimalSlot = {
  /** The `id` from `/authorizations/{id}/animals` → request field
   *  `authorizationAnimalId`. (This is the ONLY animal id the POST needs — the
   *  separate `animalId` we used to send was an unknown property and 400'd.) */
  authorizationAnimalId: number;
  name: string;
  /** true for IGO (invasive/foreign) species — outside the normal permit. */
  igo: boolean;
  isFat: boolean;
  isPredatory: boolean;
  /** How many of this animal may still be taken on the permit. */
  remainingNumber: number;
};

/**
 * Animals available to harvest on a permit:
 *   GET /units/{u}/hunting-districts/{d}/authorizations/{id}/animals
 * Returns permit animals + IGO, each `{ id, name, igo, isFat, remainingNumber,
 * isPredatory }`. `id` becomes `authorizationAnimalId` in the POST.
 */
export function usePermitAnimals(
  unitId: string,
  districtId: string | number | undefined,
  authorizationId: number | undefined,
) {
  return useQuery({
    queryKey: ['permitAnimals', unitId, String(districtId), authorizationId],
    enabled: !!unitId && !!districtId && !!authorizationId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const d = await apiRequest<unknown>(
        `/units/${unitId}/hunting-districts/${districtId}/authorizations/${authorizationId}/animals`,
      );
      const arr = Array.isArray(d)
        ? d
        : ((d as { result?: unknown[] })?.result ?? []);
      return arr
        .map((r) => r as Record<string, unknown>)
        .filter((r) => r.id != null)
        .map(
          (r): PermitAnimalSlot => ({
            authorizationAnimalId: Number(r.id),
            name: String(r.name ?? ''),
            igo: !!r.igo,
            isFat: !!r.isFat,
            isPredatory: !!r.isPredatory,
            remainingNumber: Number(r.remainingNumber ?? 0),
          }),
        )
        // Only what can still be taken (IGO is always available).
        .filter((a) => a.remainingNumber > 0 || a.igo);
    },
  });
}

export type AddHarvestInput = {
  huntingId: string;
  districtId: string | number;
  authorizationId: number;
  groundId: number;
  authorizationAnimalId: number;
  /** COUNT — how many of this animal were shot (NOT a slot ordinal). */
  number: number;
  /** When the animal was harvested — set by the user (may be in the past, e.g.
   *  logged later than the shot). ISO string. */
  harvestDate: string;
  /** Kept by the dialog across attempts; see `addHarvestOnce`. */
  guard: HarvestGuard;
};

/**
 * What the harvest dialog remembers between attempts, so no attempt — a
 * double tap, an automatic retry, or the user pressing "Zapisz" again after a
 * failure — can record the same animal twice.
 */
export type HarvestGuard = {
  /** Ids of the hunt's harvests before the first send. */
  before: Set<string> | null;
  /** A send went out whose outcome is unknown (the reply never arrived). */
  unsure: boolean;
};

export const newHarvestGuard = (): HarvestGuard => ({ before: null, unsure: false });

/** How long one "Zapisz" keeps trying through a bad connection. */
const HARVEST_TRY_MS = 3 * 60_000;
const HARVEST_RETRY_DELAY_MS = 3_000;

async function harvestIds(
  unitId: string,
  districtId: string | number,
  huntingId: string,
): Promise<Set<string>> {
  const d = await apiRequest<unknown>(
    `/units/${unitId}/hunting-districts/${districtId}/huntings/${huntingId}/animals`,
  );
  const arr = Array.isArray(d) ? d : ((d as { result?: unknown[] })?.result ?? []);
  return new Set(
    (arr as HuntAnimal[]).filter((a) => !a.isWounded).map((a) => String(a.id)),
  );
}

/** A refusal the server gave on purpose: nothing was recorded, retrying won't help. */
function isDefinitiveRefusal(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    e.status >= 400 &&
    e.status < 500 &&
    e.status !== 408 &&
    e.status !== 429
  );
}

/**
 * Record a harvest exactly once, through a bad connection.
 *
 * The POST is not idempotent, and a lost reply leaves no way to know from the
 * POST alone whether it landed. So the hunt's harvest list is read before the
 * first send, and after any send with an unknown outcome the list is read
 * again: a harvest that was not there before means the earlier send landed,
 * and it is not sent again. Only one person records harvests on a hunt (its
 * hunter), so a new row can only be this one.
 */
async function addHarvestOnce(unitId: string, input: AddHarvestInput): Promise<void> {
  const { guard } = input;
  const giveUpAt = Date.now() + HARVEST_TRY_MS;
  for (;;) {
    try {
      if (!guard.before) {
        guard.before = await harvestIds(unitId, input.districtId, input.huntingId);
      }
      if (guard.unsure) {
        const now = await harvestIds(unitId, input.districtId, input.huntingId);
        if ([...now].some((id) => !guard.before!.has(id))) {
          guard.unsure = false;
          return; // the earlier send landed
        }
      }
      guard.unsure = true;
      await apiRequest(
        `/units/${unitId}/hunting-districts/${input.districtId}/huntings/${input.huntingId}/animals`,
        {
          method: 'POST',
          body: {
            authorizationId: input.authorizationId,
            groundId: input.groundId,
            authorizationAnimalId: input.authorizationAnimalId,
            number: input.number,
            harvestDate: input.harvestDate,
          },
        },
      );
      guard.unsure = false;
      return;
    } catch (e) {
      if (isDefinitiveRefusal(e)) {
        // This send was refused outright, so it recorded nothing; an earlier
        // unsure one was already checked above before it went out.
        guard.unsure = false;
        throw e;
      }
      if (Date.now() > giveUpAt) {
        throw new Error(
          'Brak połączenia — nie udało się potwierdzić zapisu. Naciśnij Zapisz ' +
            'ponownie: aplikacja najpierw sprawdzi, czy pozyskanie już się zapisało.',
        );
      }
      await new Promise((r) => setTimeout(r, HARVEST_RETRY_DELAY_MS));
    }
  }
}

/**
 * Record a harvested animal:
 *   POST /units/{u}/hunting-districts/{d}/huntings/{id}/animals
 *   body { authorizationId, groundId, authorizationAnimalId, number, harvestDate }
 * Verified against a captured working webapp request. NOTE: NO `animalId` — the
 * server rejects that as an unknown property ("Invalid request content" 400).
 * `number` is the COUNT harvested. Sex/weight/age are set afterwards via
 * PUT .../animals/{hunted-animal-id} (not done here).
 */
export function useAddHarvest(unitId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddHarvestInput) => addHarvestOnce(unitId, input),
    // addHarvestOnce does its own, duplicate-safe retrying; the global
    // "resend on network failure" policy would bypass that check.
    retry: false,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['book', unitId] });
      qc.invalidateQueries({ queryKey: ['huntDetail', unitId] });
      qc.invalidateQueries({ queryKey: ['huntAnimals', unitId] });
      qc.invalidateQueries({ queryKey: ['permitAnimals', unitId] });
    },
  });
}

export type AddWoundedInput = {
  huntingId: string;
  districtId: string | number;
  authorizationId: number;
  groundId: number;
  animalId: number;
  authorizationAnimalId: number;
};

/**
 * Record a wounded animal ("postrzałek"):
 *   POST /units/{u}/hunting-districts/{d}/huntings/{id}/wounded-animals
 *   body { authorizationId, groundId, animalId, authorizationAnimalId, woundingDate }
 */
export function useAddWounded(unitId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddWoundedInput) =>
      apiRequest(
        `/units/${unitId}/hunting-districts/${input.districtId}/huntings/${input.huntingId}/wounded-animals`,
        {
          method: 'POST',
          body: {
            authorizationId: input.authorizationId,
            groundId: input.groundId,
            animalId: input.animalId,
            authorizationAnimalId: input.authorizationAnimalId,
            woundingDate: new Date().toISOString(),
          },
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['book', unitId] });
      qc.invalidateQueries({ queryKey: ['huntDetail', unitId] });
      qc.invalidateQueries({ queryKey: ['permitAnimals', unitId] });
    },
  });
}

export type HuntUpdateInput = {
  huntingId: string;
  districtId: string | number;
  /** "Liczba strzałów" — hunt-level total. Editable during the hunt. */
  shotsFired?: number | null;
  /** "Uwagi od myśliwego". */
  notes?: string | null;
  /**
   * "Polowanie z postrzałkiem" — MUST be an explicit boolean. Sending it null
   * is what previously wrote the end date WITHOUT closing the hunt.
   */
  withWoundedAnimals: boolean;
  /**
   * The hunt's CURRENT end date. On a non-close save we resend it UNCHANGED so
   * the server keeps it (the vendor's date-edit payload always includes endDate).
   * We never move it to "now" on a plain save — that broke editing shots once the
   * hunt was past its end ("start/end must not change after the end elapsed").
   */
  endDate?: string | null;
  /**
   * Set to close the hunt. On close (and ONLY on close) the end date is stamped
   * to `now`. Omit to just save (e.g. updating the shot count mid-hunt).
   */
  close?: boolean;
};

/**
 * Save / close a hunt. Closing is TWO calls (verified against a real web-app
 * capture), which is why a lone PUT only moved the end date:
 *   1. PUT /units/{u}/hunting-districts/{d}/huntings/{id}
 *      body { endDate?, shotsFired, notes, withWoundedAnimals }   → "Zapis polowania"
 *   2. POST /units/{u}/hunting-districts/{d}/huntings/{id}:approve-without-zipod
 *      (EMPTY body) → the actual finalise ("Zakończenie polowania"): sets isEnded
 *      + the checkout person. This second call is what our close was missing.
 * Omit `close` to just save (e.g. updating shots mid-hunt). Always resend the
 * hunt's current notes/withWoundedAnimals when only changing shots, else they
 * get blanked.
 */
/**
 * End datetime to stamp when closing: min(planned end, now). Recomputed at send
 * time (so retries stay correct). If there's no planned end, falls back to now.
 */
function closeEndDate(plannedEnd?: string | null): string {
  const now = Date.now();
  const planned = plannedEnd ? Date.parse(plannedEnd) : NaN;
  const ms = Number.isNaN(planned) ? now : Math.min(now, planned);
  return new Date(ms).toISOString();
}

export function useUpdateHunt(unitId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: HuntUpdateInput) => {
      const base = `/units/${unitId}/hunting-districts/${input.districtId}/huntings/${input.huntingId}`;
      await apiRequest(base, {
        method: 'PUT',
        body: {
          // Close stamps min(planned end, now): closing early ends it now, but
          // closing AFTER the planned end records the planned end (never a time
          // beyond it). A plain save resends the existing end date untouched.
          endDate: input.close
            ? closeEndDate(input.endDate)
            : (input.endDate ?? undefined),
          // OMIT shotsFired unless the user actually set it — the original app
          // leaves it out of the JSON when blank (undefined → dropped by
          // JSON.stringify). Sending 0 registered a bogus "LiczbaStrzałów:0"
          // change in the hunt's history. (notes:"" and withWoundedAnimals:false
          // ARE sent — that matches the real app's payload.)
          shotsFired: input.shotsFired ?? undefined,
          notes: input.notes ?? '',
          withWoundedAnimals: input.withWoundedAnimals,
        },
      });
      if (input.close) {
        // Finalise — empty POST body (Content-Length: 0).
        await apiRequest(`${base}:approve-without-zipod`, { method: 'POST' });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['book', unitId] });
      qc.invalidateQueries({ queryKey: ['huntDetail', unitId] });
    },
  });
}

export type DeleteHuntInput = {
  huntingId: string;
  districtId: string | number;
};

/**
 * Wykreślenie — cross yourself out of a hunt you signed up for. Reversed from the
 * vendor app (`deleteHunting`): `DELETE /units/{u}/hunting-districts/{d}/huntings/{id}`
 * with no body. The server only permits it before the hunt starts and gates it
 * behind the `canDeleteHunting` flag; it soft-deletes (the entry stays in the
 * book marked "wykreślone"), so we refetch rather than drop it locally.
 */
export function useDeleteHunt(unitId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteHuntInput) =>
      apiRequest(
        `/units/${unitId}/hunting-districts/${input.districtId}/huntings/${input.huntingId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['book', unitId] });
      qc.invalidateQueries({ queryKey: ['huntDetail', unitId] });
    },
  });
}
