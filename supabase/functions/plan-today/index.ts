import { UserFacingError } from '../_shared/http.ts';
import { planToday, PlanRequest } from '../_shared/plan.ts';
import { serveAi } from '../_shared/serve.ts';

serveAi(async ({ anthropic, supabase, userId, body }) => {
  const parsed = PlanRequest.safeParse(body);
  if (!parsed.success) throw new UserFacingError('Bad request.');

  // Read the onboarding answers from the database (not from the request) so
  // the plan uses what the student actually said.
  const { data: profile } = await supabase
    .from('profiles')
    .select('education_level, grade, goals, struggles')
    .eq('id', userId)
    .single();

  return await planToday(anthropic, parsed.data, {
    education_level: profile?.education_level ?? null,
    grade: profile?.grade ?? null,
    goals: profile?.goals ?? null,
    struggles: profile?.struggles ?? null,
  });
});
