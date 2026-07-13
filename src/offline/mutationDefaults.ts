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
export function registerMutationDefaults(qc: QueryClient) {
  qc.setMutationDefaults(huntMutationKeys.signUp, {
    mutationFn: async (input: SignUpInput) => {
      const ep = endpoints.huntingBook(input.unitId);
      // Self sign-up uses the dedicated LOW-1 solo form; booking another hunter
      // creates a hunting entry directly.
      const path = input.hunterId ? ep.huntings : ep.soloSignUp;
      const body = {
        hunterId: input.hunterId,
        huntingDistrictId: input.huntingDistrictId,
        standId: input.standId,
        animalTypeId: input.animalTypeId,
        startTimestamp: input.startTimestamp,
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
