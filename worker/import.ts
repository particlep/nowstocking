import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { ParsedPage, type ImportPageRequest, type ImportPageResponse } from '../shared/importTypes';

const SYSTEM = `You transcribe Van's Aircraft kit packing lists from photos into structured rows.

The list is a tree, printed top to bottom:
- A sub-kit line (for example "14 EMP HARDWARE") starts a group of bags and parts.
- A BAG line (stock code like "BAG 1118") starts a bag. The indented lines directly under it are the parts in that bag.
- A non-indented part line that is not a BAG belongs to the current sub-kit, not to a bag.

Rules:
- Transcribe every line on the page, in order. Never skip, merge, or reorder lines, and never invent lines.
- Copy stock codes exactly as printed, character for character (AN470AD4-5, LP4-3, BAG 1118). Do not "correct" them.
- Copy the description exactly, including a trailing "(LB)" when present.
- qty is the quantity column as a number (0.110, 225, 1).
- vans_bin is the Bin column (HW, E3B, HW/SPA). Null when blank.
- Set indented true only when the line is visibly indented under a BAG line. Lines at the very top of the page may be indented because the bag started on the previous page; still mark them indented.
- The photo may be rotated or at an angle. Read it in the correct orientation.
- Ignore page headers, footers, column titles, and handwritten check marks.
- If a value is hard to read, give your best reading and set uncertain true with a short note.`;

function decodeBase64(data: string): Uint8Array {
  const fromBase64 = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (fromBase64) return fromBase64(data);
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class ImportError extends Error {
  constructor(message: string, readonly status: 400 | 502 | 500 = 500) {
    super(message);
  }
}

export async function parsePage(env: Env, user: string, req: ImportPageRequest): Promise<ImportPageResponse> {
  if (!req || typeof req.data !== 'string' || !req.data) throw new ImportError('missing image data', 400);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(req.media_type)) throw new ImportError('unsupported image type', 400);
  if (!/^[\w-]{1,64}$/.test(req.batch_id ?? '')) throw new ImportError('invalid batch id', 400);
  const apiKey = (env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;
  if (!apiKey) throw new ImportError('ANTHROPIC_API_KEY is not set on the Worker', 500);

  const ext = req.media_type.split('/')[1];
  const image_key = `imports/${req.batch_id}/page-${String(req.page).padStart(2, '0')}.${ext}`;
  await env.IMPORTS.put(image_key, decodeBase64(req.data), {
    httpMetadata: { contentType: req.media_type },
    customMetadata: { uploaded_by: user },
  });

  const client = new Anthropic({ apiKey });
  const stream = client.beta.messages.stream({
    model: env.IMPORT_MODEL || 'claude-opus-5',
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: betaZodOutputFormat(ParsedPage) },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: req.media_type, data: req.data } },
          { type: 'text', text: `This is page ${req.page} of the packing list photos. Transcribe it.` },
        ],
      },
    ],
  });

  let message;
  try {
    message = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      console.error('Claude API error', e.status, e.message);
      throw new ImportError(`Claude API error ${e.status ?? ''}: ${e.message}`, 502);
    }
    throw e;
  }
  if (message.stop_reason === 'refusal') throw new ImportError('The model declined to read this page.', 502);
  if (message.stop_reason === 'max_tokens') throw new ImportError('The page was too long to transcribe in one pass.', 502);
  if (!message.parsed_output) throw new ImportError('Could not parse the model output.', 502);

  return { page: req.page, image_key, parsed: message.parsed_output };
}

/** Serve an uploaded page image back to the review screen. */
export async function getImportImage(env: Env, key: string): Promise<Response> {
  if (!/^imports\/[\w-]{1,64}\/page-\d{2}\.(jpeg|png|webp)$/.test(key)) return new Response('not found', { status: 404 });
  const obj = await env.IMPORTS.get(key);
  if (!obj) return new Response('not found', { status: 404 });
  return new Response(obj.body, {
    headers: { 'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=86400' },
  });
}
