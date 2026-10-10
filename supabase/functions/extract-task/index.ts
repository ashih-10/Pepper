import { extractTasks, ExtractRequest } from '../_shared/extract.ts';
import { serveAi } from '../_shared/serve.ts';

serveAi(ExtractRequest, async ({ anthropic, body }) => await extractTasks(anthropic, body));
