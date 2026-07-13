import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { endpoints } from '@/api/endpoints';

/**
 * Collective hunting (polowanie zbiorowe). Field shape inferred from the
 * reversed schema/query-key names; kept lenient (`.passthrough`, optionals)
 * so it tolerates the real payload without a published OpenAPI contract.
 */
export const CollectiveHuntingSchema = z
  .object({
    id: z.string(),
    number: z.string().optional(),
    name: z.string().optional(),
    date: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    huntingDistrictName: z.string().optional(),
    leaderName: z.string().optional(),
    status: z.string().optional(),
    participantsCount: z.number().optional(),
  })
  .passthrough();

export type CollectiveHunting = z.infer<typeof CollectiveHuntingSchema>;

export const CollectiveHuntingListSchema = z.union([
  z.array(CollectiveHuntingSchema),
  z.object({ content: z.array(CollectiveHuntingSchema) }).passthrough(),
]);

function normalizeList(data: unknown): CollectiveHunting[] {
  const parsed = CollectiveHuntingListSchema.safeParse(data);
  if (!parsed.success) return [];
  return Array.isArray(parsed.data) ? parsed.data : parsed.data.content;
}

export function collectiveHuntingKeys(unitId: string) {
  return {
    all: ['collective-huntings', unitId] as const,
    detail: (id: string) => ['collective-huntings', unitId, id] as const,
  };
}

export function useCollectiveHuntings(unitId: string) {
  return useQuery({
    queryKey: collectiveHuntingKeys(unitId).all,
    queryFn: async () => {
      const data = await apiRequest(endpoints.collectiveHuntings(unitId).list);
      return normalizeList(data);
    },
  });
}

export function useCollectiveHunting(unitId: string, id: string) {
  return useQuery({
    queryKey: collectiveHuntingKeys(unitId).detail(id),
    queryFn: async () => {
      const data = await apiRequest(
        endpoints.collectiveHuntings(unitId).byId(id),
      );
      return CollectiveHuntingSchema.parse(data);
    },
    enabled: !!id,
  });
}
