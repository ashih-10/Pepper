/**
 * Shared request handling for the AI edge functions:
 *   1. CORS + method check
 *   2. Verify the student's login token (the key never leaves the server)
 *   3. Validate the request body (bad requests never cost quota)
 *   4. Enforce the daily AI quota
 *   5. Run the handler and map errors to safe messages
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';

import { corsHeaders, json, UserFacingError } from './http.ts';

export interface Ctx<T> {
  userId: string;
  supabase: SupabaseClient;
  anthropic: Anthropic;
  body: T;
}

const MAX_BODY_BYTES = 8_000_000;

export function serveAi<S extends z.ZodType>(schema: S, handler: (ctx: Ctx<z.infer<S>>) => Promise<unknown>) {
  // PORT is only set when running a function directly with `deno run`
  // (e.g. local testing); the Supabase runtime picks its own port.
  const port = Deno.env.get('PORT');
  const serve = (h: (req: Request) => Promise<Response>) => (port ? Deno.serve({ port: Number(port) }, h) : Deno.serve(h));
  serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

    try {
      const auth = req.headers.get('Authorization');
      if (!auth?.startsWith('Bearer ')) throw new UserFacingError('Please sign in again.', 401);

      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: auth } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await supabase.auth.getUser(auth.slice('Bearer '.length));
      if (error || !data.user) throw new UserFacingError('Please sign in again.', 401);

      const length = Number(req.headers.get('content-length') ?? 0);
      if (length > MAX_BODY_BYTES) throw new UserFacingError('That image is too large. Try a smaller photo.', 413);
      const raw = await req.json().catch(() => {
        throw new UserFacingError('Bad request.');
      });
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new UserFacingError('Bad request. Try again.');

      const quota = await supabase.rpc('use_ai_quota');
      if (quota.error) throw quota.error;
      if (quota.data !== true) {
        throw new UserFacingError("You've hit today's AI limit. It resets tomorrow.", 429);
      }

      const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY secret is not set');
      const anthropic = new Anthropic({
        apiKey,
        // Only set when testing against a mock server.
        baseURL: Deno.env.get('ANTHROPIC_BASE_URL') || undefined,
        maxRetries: 2,
        timeout: 60_000,
      });

      return json(await handler({ userId: data.user.id, supabase, anthropic, body: parsed.data }));
    } catch (err) {
      if (err instanceof UserFacingError) return json({ error: err.message }, err.status);
      if (err instanceof Anthropic.RateLimitError) {
        return json({ error: 'The AI is busy right now. Try again in a minute.' }, 503);
      }
      if (err instanceof Anthropic.APIError) {
        console.error('Claude API error', err.status, err.message);
        return json({ error: 'The AI had a problem. Try again.' }, 502);
      }
      console.error(err);
      return json({ error: 'Something went wrong. Try again.' }, 500);
    }
  });
}
