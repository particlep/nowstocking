// Packing-list photo import: jobs, page uploads to R2, and reading a page with Claude.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { ParsedInstructions, ParsedPage, type ImportKind } from '../shared/importTypes';
import type { TokenUsage } from './aiBudget';

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

const INSTRUCTIONS_SYSTEM = `You read one page of an aircraft kit's build instructions (plans) from a photo and list every part it calls for.

The page has numbered steps in text and figures with callouts. Part numbers look like F-01414, F-01412C, HS-1402, VA-146, WH-00059, and hardware like AN470AD4-5, AN3-5A, MS20470AD4-4, NAS1149F0363P, SB625-7, CS4-4, LP4-3, C409P.

Rules:
- List each distinct part number that appears on the page, in step text or in figure callouts, once. Order them by first appearance.
- Copy part numbers exactly as printed, character for character. Do not "correct" them or add or drop suffix letters.
- Do not list drill sizes (#30, #40), page or figure references ("Page 10-06", "Figure 3"), step numbers, dimensions, or wire color codes on their own.
- Electrical items such as harnesses (WH-00059) and wire labels (P725, TP724) are kind "electrical".
- qty: only when the page states a count for that part (e.g. "2X", "(4)"). Otherwise null.
- context: the step(s) and figure(s) where the part appears.
- page_label is the plans page number, usually in the title block at the bottom corner (e.g. 10-27). section is the part before the dash.
- title: a short plain name for the work on this page, from the figure titles (e.g. "Aft deck").
- The photo may be rotated, curved, or at an angle, and part of a facing page may show. Read only the main page. If a part number is hard to read, give your best reading and set uncertain true with a short note.`;

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const JOB_ID = /^[a-f0-9-]{36}$/;

function toBase64(bytes: Uint8Array): string {
  const native = (bytes as unknown as { toBase64?: () => string }).toBase64;
  if (native) return native.call(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Read one page photo from R2 and transcribe it. Throws on API errors so the Workflow step retries. */
export async function readPage(
  env: Env, imageKey: string, page: number, kind: ImportKind = 'packing_list',
  onUsage?: (model: string, usage: TokenUsage) => Promise<unknown>,
): Promise<ParsedPage | ParsedInstructions> {
  const apiKey = (env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set on the Worker');
  const obj = await env.IMPORTS.get(imageKey);
  if (!obj) throw new Error(`photo ${imageKey} is missing`);
  const mediaType = (obj.httpMetadata?.contentType ?? 'image/jpeg') as ImageType;
  const data = toBase64(new Uint8Array(await obj.arrayBuffer()));

  const client = new Anthropic({ apiKey });
  const request = {
    model: env.IMPORT_MODEL || 'claude-opus-5',
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    thinking: { type: 'adaptive' as const },
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data } },
          {
            type: 'text' as const,
            text: kind === 'instructions'
              ? `This is photo ${page} of the instruction pages. List the parts it calls for.`
              : `This is page ${page} of the packing list photos. Transcribe it.`,
          },
        ],
      },
    ],
  };
  const message = kind === 'instructions'
    ? await client.beta.messages.stream({ ...request, system: INSTRUCTIONS_SYSTEM, output_config: { effort: 'high', format: betaZodOutputFormat(ParsedInstructions) } }).finalMessage()
    : await client.beta.messages.stream({ ...request, system: SYSTEM, output_config: { effort: 'high', format: betaZodOutputFormat(ParsedPage) } }).finalMessage();

  // Billed whether or not the answer is usable, so record it first.
  await onUsage?.(message.model, message.usage);

  if (message.stop_reason === 'refusal') throw new Error('The model declined to read this page.');
  if (message.stop_reason === 'max_tokens') throw new Error('The page was too long to transcribe in one pass.');
  if (!message.parsed_output) throw new Error('Could not parse the model output.');
  return message.parsed_output;
}

/** Serve an uploaded page photo, only from this warehouse's folder. */
export async function getImportImage(env: Env, warehouseId: string, key: string): Promise<Response> {
  const pattern = new RegExp(`^w/${warehouseId}/imports/[a-f0-9-]{36}/page-\\d{2}\\.(jpeg|png|webp)$`);
  if (!pattern.test(key)) return new Response('not found', { status: 404 });
  const obj = await env.IMPORTS.get(key);
  if (!obj) return new Response('not found', { status: 404 });
  return new Response(obj.body, {
    headers: { 'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=86400' },
  });
}
