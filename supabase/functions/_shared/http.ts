// Open CORS is safe here because the only gate is the per-user bearer token
// (verified before any work): a browser can't attach a victim's token from
// another site. Native apps and the varying deploy origin make an allow-list
// impractical. Never add Access-Control-Allow-Credentials alongside '*'.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Errors whose message is safe to show the student. */
export class UserFacingError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/**
 * Read the JSON body, enforcing a hard byte cap on the actual stream. The
 * content-length header is only a hint (chunked requests omit it and it can
 * lie), so we also count bytes as they arrive and abort past the limit.
 */
export async function readJsonLimited(req: Request, maxBytes: number): Promise<unknown> {
  const tooBig = () => new UserFacingError('That image is too large. Try a smaller photo.', 413);
  if (Number(req.headers.get('content-length') ?? 0) > maxBytes) throw tooBig();
  const body = req.body;
  if (!body) throw new UserFacingError('Bad request.');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooBig();
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new UserFacingError('Bad request.');
  }
}
