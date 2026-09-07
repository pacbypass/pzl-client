import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { endpoints } from '@/api/endpoints';

/**
 * Annual hunting plan execution. Real shape (verified against the live API):
 *   GET /units/{u}/annual-hunting-plans/execution-plan?year=&hunting-district-id=
 *   → { huntingLargeAnimal: Row[], huntingSmallAnimal: Row[], animals, igoAnimals }
 * where each Row = { animal: {name, fullName, ...}, plannedHarvest, harvested,
 *   remainingToHarvest, executionRate, ... }.
 */
const AnimalSchema = z
  .object({ name: z.string().optional(), fullName: z.string().optional() })
  .passthrough();

const PlanRowSchema = z
  .object({
    animal: AnimalSchema.optional(),
    plannedHarvest: z.number().optional(),
    harvested: z.number().optional(),
    remainingToHarvest: z.number().optional(),
    executionRate: z.number().optional(),
    losses: z.number().optional(),
  })
  .passthrough();

const ExecutionSchema = z
  .object({
    huntingLargeAnimal: z.array(PlanRowSchema).optional(),
    huntingSmallAnimal: z.array(PlanRowSchema).optional(),
  })
  .passthrough();

export type PlanRowView = {
  label: string;
  planned: number;
  harvested: number;
  remaining: number;
  pct: number;
  group: 'large' | 'small';
};

function toRows(rows: z.infer<typeof PlanRowSchema>[], group: 'large' | 'small'): PlanRowView[] {
  return rows.map((r) => {
    const planned = r.plannedHarvest ?? 0;
    const harvested = r.harvested ?? 0;
    const remaining = r.remainingToHarvest ?? Math.max(0, planned - harvested);
    const raw = r.executionRate;
    const pct =
      raw != null ? (raw > 1 ? raw / 100 : raw) : planned > 0 ? harvested / planned : 0;
    return {
      label: r.animal?.fullName ?? r.animal?.name ?? 'Gatunek',
      planned,
      harvested,
      remaining,
      pct,
      group,
    };
  });
}

export function usePlanExecution(
  unitId: string,
  year: number | undefined,
  huntingDistrictId: string | undefined,
) {
  return useQuery({
    queryKey: ['plan', 'execution', unitId, year, huntingDistrictId],
    enabled: !!unitId && !!year && !!huntingDistrictId,
    queryFn: async () => {
      const data = await apiRequest(
        endpoints.annualHuntingPlans(unitId).executionPlan,
        { query: { year, 'hunting-district-id': huntingDistrictId } },
      );
      const parsed = ExecutionSchema.safeParse(data);
      if (!parsed.success) return [] as PlanRowView[];
      return [
        ...toRows(parsed.data.huntingLargeAnimal ?? [], 'large'),
        ...toRows(parsed.data.huntingSmallAnimal ?? [], 'small'),
      ];
    },
  });
}

export function planTotals(rows: PlanRowView[]) {
  const planned = rows.reduce((s, r) => s + r.planned, 0);
  const harvested = rows.reduce((s, r) => s + r.harvested, 0);
  return {
    planned,
    harvested,
    remaining: Math.max(0, planned - harvested),
    pct: planned > 0 ? harvested / planned : 0,
  };
}
