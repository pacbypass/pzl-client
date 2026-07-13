import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { endpoints } from '@/api/endpoints';

/** Hunting damage report (szkoda łowiecka). */
export const HuntingDamageSchema = z
  .object({
    id: z.string(),
    number: z.string().optional(),
    reportDate: z.string().optional(),
    cropType: z.string().optional(),
    animalType: z.string().optional(),
    location: z.string().optional(),
    damagedAreaHa: z.number().optional(),
    estimatedValue: z.number().optional(),
    status: z.string().optional(),
    ownerName: z.string().optional(),
  })
  .passthrough();

export type HuntingDamage = z.infer<typeof HuntingDamageSchema>;

const ListSchema = z.union([
  z.array(HuntingDamageSchema),
  z.object({ content: z.array(HuntingDamageSchema) }).passthrough(),
]);

function normalizeList(data: unknown): HuntingDamage[] {
  const parsed = ListSchema.safeParse(data);
  if (!parsed.success) return [];
  return Array.isArray(parsed.data) ? parsed.data : parsed.data.content;
}

export function huntingDamageKeys(unitId: string) {
  return {
    all: ['hunting-damages', unitId] as const,
    detail: (id: string) => ['hunting-damages', unitId, id] as const,
  };
}

export function useHuntingDamages(unitId: string) {
  return useQuery({
    queryKey: huntingDamageKeys(unitId).all,
    queryFn: async () => {
      const data = await apiRequest(endpoints.huntingDamages(unitId).list);
      return normalizeList(data);
    },
  });
}

export type CreateHuntingDamageInput = {
  cropType?: string;
  animalType?: string;
  location?: string;
  damagedAreaHa?: number;
  ownerName?: string;
  description?: string;
};

export function useCreateHuntingDamage(unitId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateHuntingDamageInput) =>
      apiRequest<HuntingDamage>(endpoints.huntingDamages(unitId).list, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: huntingDamageKeys(unitId).all });
    },
  });
}
