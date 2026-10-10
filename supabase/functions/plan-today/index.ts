import { planToday, PlanRequest } from '../_shared/plan.ts';
import { serveAi } from '../_shared/serve.ts';

serveAi(PlanRequest, async ({ anthropic, supabase, body }) => {
  // Read the onboarding answers from the database (not from the request) so
  // the plan uses what the student actually said. Only the student's own
  // row is readable, through get_my_profile().
  const { data: profile } = await supabase
    .rpc('get_my_profile')
    .maybeSingle<{ education_level: string | null; grade: string | null; goals: string | null; struggles: string | null }>();

  return await planToday(anthropic, body, {
    education_level: profile?.education_level ?? null,
    grade: profile?.grade ?? null,
    goals: profile?.goals ?? null,
    struggles: profile?.struggles ?? null,
  });
});
