import { extractTasks, ExtractRequest } from '../_shared/extract.ts';
import { UserFacingError } from '../_shared/http.ts';
import { serveAi } from '../_shared/serve.ts';

serveAi(async ({ anthropic, body }) => {
  const parsed = ExtractRequest.safeParse(body);
  if (!parsed.success) throw new UserFacingError('Bad request. Try taking the photo again.');
  return await extractTasks(anthropic, parsed.data);
});
