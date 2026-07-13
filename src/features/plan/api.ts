import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { endpoints } from '@/api/endpoints';

/**
 * Annual hunting plan execution row. From the reversed schema the realization
 * fields are `target` (planned) and `done` (harvested), plus
 * `remainingToHarvest` / `percentage`. Species labels come as animalType*.
 */
export const PlanRowSchema = z
  .object({
    animalTypeId: z.string().optional(),
    animalTypeName: z.string().optional(),
    category: z.string().optional(),
    sex: z.string().optional(),
    target: z.number().optional(),
    done: z.number().optional(),
    remainingToHarvest: z.number().optional(),
    percentage: z.number().optional(),
  })
  .passthrough();

export type PlanRow = z.infer<typeof PlanRowSchema>;

const ExecutionSchema = z
  .object({
    year: z.union([z.string(), z.number()]).optional(),
    planDetails: z.array(PlanRowSchema).optional(),
    details: z.array(PlanRowSchema).optional(),
    rows: z.array(PlanRowSchema).optional(),
  })
  .passthrough();

export type PlanRowView = PlanRow & {
  label: string;
  planned: number;
  harvested: number;
  remaining: number;
  pct: number;
};

function coerceRows(data: unknown): PlanRowView[] {
  const parsed = ExecutionSchema.safeParse(data);
  let rows: PlanRow[] = [];
  if (parsed.success) {
    rows = parsed.data.planDetails ?? parsed.data.details ?? parsed.data.rows ?? [];
  } else if (Array.isArray(data)) {
    rows = z.array(PlanRowSchema).parse(data);
  }
  return rows.map((r) => {
    const planned = r.target ?? 0;
    const harvested = r.done ?? 0;
    const remaining = r.remainingToHarvest ?? Math.max(0, planned - harvested);
    const pct =
      r.percentage != null
        ? r.percentage > 1
          ? r.percentage / 100
          : r.percentage
        : planned > 0
          ? harvested / planned
          : 0;
    const label = [r.animalTypeName ?? 'Gatunek', r.category, r.sex]
      .filter(Boolean)
      .join(' · ');
    return { ...r, label, planned, harvested, remaining, pct };
  });
}

export function usePlanExecution(unitId: string) {
  return useQuery({
    queryKey: ['plan', 'execution', unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const data = await apiRequest(
        endpoints.annualHuntingPlans(unitId).executionPlan,
      );
      return coerceRows(data);
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
