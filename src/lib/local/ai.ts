// STUB — replaced by the local-backend agent (signatures are the contract).
import type { ExtractResult, GamePlan, PlanTaskInput } from '../ai';

/** Demo stand-in for photo reading: sample tasks, clearly marked as samples. */
export async function sampleExtract(_classNames: string[], _now: Date): Promise<ExtractResult> {
  return { tasks: [], message: null };
}

/** Demo stand-in for the AI game plan, built from the formula's order. */
export async function samplePlan(_tasks: PlanTaskInput[], _nowLabel: string): Promise<GamePlan> {
  return { headline: '', steps: [], closing: '' };
}
