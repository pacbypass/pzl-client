import type { QueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import {
  huntMutationKeys,
  type EndHuntInput,
  type HuntEntry,
  type SignUpInput,
} from '@/features/huntingBook/api';

/**
 * The network side of the offline mutations. Registered as *defaults* (keyed by
 * mutationKey) rather than inline mutationFns, because a paused mutation that is
 * persisted and resumed after an app restart has no closure — React Query looks
 * the function up by key. The bearer token is resolved fresh inside apiRequest
 * at resume time, so a queue flushed hours later still authenticates.
 */
/**
 * Sign-up start to send: max(now, requested start). Recomputed at SEND time
 * (inside the mutationFn, so it re-evaluates on every retry / offline resume): a
 * hunt queued while offline may only reach the server minutes later, by which
 * point its original start has passed and the server would reject it ("start
 * must be now-or-future"). A future start is kept as-is; a past one becomes now.
 */
function clampStartToNow(iso: string): string {
  const start = Date.parse(iso);
  const now = Date.now();
  const ms = Number.isNaN(start) ? now : Math.max(now, start);
  return new Date(ms).toISOString();
}

export function registerMutationDefaults(qc: QueryClient) {
  qc.setMutationDefaults(huntMutationKeys.signUp, {
    mutationFn: async (input: SignUpInput) => {
      // Create a hunting entry on the district's huntings collection — the SAME
      // endpoint the book is read from. (`electronic-hunting-book/forms/solo-sign-up`
      // is only a SCREEN route in the original app, not an API path — POSTing
      // there returns 404 "No static resource".) Self vs. booking another hunter
      // use the same endpoint; they differ only by `leadingPersonId` in the body.
      if (!input.huntingDistrictId) {
        throw new Error('Brak obwodu — nie można zapisać polowania.');
      }
      const path = `/units/${input.unitId}/hunting-districts/${input.huntingDistrictId}/huntings`;
      // Body reversed from the web app's create-hunt serializer (exact field set):
      // { anotherHunter, hunterId, foreignHunterId, startDate, endDate, notes,
      //   huntingPlaceId, huntingPlaceDescription, huntingGroundIds, permitIds,
      //   confirmOtherHuntersConsent }. Permits are `permitIds` (bare ids) and the
      // rewir goes in `huntingGroundIds` — the earlier `permitNumbers:[{id}]`
      // guess caused the 500 "HV000090: unable to access isValid".
      const body = {
        anotherHunter: input.anotherHunter,
        hunterId: input.hunterId,
        foreignHunterId: undefined,
        // Recomputed on every (re)send: if the start has slipped into the past
        // (time elapsed while the mutation waited offline), send "now" instead.
        startDate: clampStartToNow(input.startTimestamp),
        endDate: input.endTimestamp,
        notes: input.notes ?? null,
        huntingPlaceId: undefined,
        huntingPlaceDescription: undefined,
        huntingGroundIds: input.huntingGroundIds,
        permitIds: input.permitIds,
        // The user's own explicit tick — this confirms other hunters consented
        // to SHARING AN OCCUPIED REWIR. It is unrelated to `anotherHunter`.
        confirmOtherHuntersConsent: input.confirmOtherHuntersConsent,
      };
      return apiRequest<HuntEntry>(path, { method: 'POST', body });
    },
  });

  qc.setMutationDefaults(huntMutationKeys.endHunt, {
    mutationFn: async (input: EndHuntInput) => {
      const ep = endpoints.huntingBook(input.unitId);
      return apiRequest<HuntEntry>(ep.huntingById(input.id), {
        method: 'PATCH',
        body: { endTimestamp: input.endTimestamp, status: 'FINISHED' },
      });
    },
  });
}
