// Packing-list photo import: jobs, page uploads to R2, and reading a page with Claude.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  ParsedInstructions, ParsedPage, type ImportJob, type ImportJobSummary, type ImportKind, type ImportPageInfo,
} from '../shared/importTypes';

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

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const JOB_ID = /^[a-f0-9-]{36}$/;

export class ImportError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 502 | 500 = 500) {
    super(message);
  }
}

function toBase64(bytes: Uint8Array): string {
  const native = (bytes as unknown as { toBase64?: () => string }).toBase64;
  if (native) return native.call(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Read one page photo from R2 and transcribe it. Throws on API errors so the Workflow step retries. */
export async function readPage(env: Env, imageKey: string, page: number, kind: ImportKind = 'packing_list'): Promise<ParsedPage | ParsedInstructions> {
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

  if (message.stop_reason === 'refusal') throw new Error('The model declined to read this page.');
  if (message.stop_reason === 'max_tokens') throw new Error('The page was too long to transcribe in one pass.');
  if (!message.parsed_output) throw new Error('Could not parse the model output.');
  return message.parsed_output;
}

// ---- Jobs ----

export async function createJob(db: D1Database, user: string, pageCount: number, kind: ImportKind = 'packing_list'): Promise<string> {
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 40) throw new ImportError('page_count must be 1-40', 400);
  if (kind !== 'packing_list' && kind !== 'instructions') throw new ImportError('unknown kind', 400);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare('INSERT INTO import_jobs (id, kind, status, page_count, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, kind, 'uploading', pageCount, user, now, now),
    db.prepare(
      `INSERT INTO import_pages (job_id, page, status, updated_at)
       SELECT ?, value, 'waiting', ? FROM json_each(?)`,
    ).bind(id, now, JSON.stringify(Array.from({ length: pageCount }, (_, i) => i + 1))),
  ]);
  return id;
}

export async function uploadPage(env: Env, jobId: string, page: number, contentType: string, body: ArrayBuffer) {
  const type = contentType.split(';')[0].trim() as ImageType;
  if (!IMAGE_TYPES.includes(type)) throw new ImportError('unsupported image type', 400);
  if (!body.byteLength || body.byteLength > MAX_IMAGE_BYTES) throw new ImportError('image is empty or too large', 400);
  const row = await env.DB.prepare('SELECT p.status FROM import_pages p WHERE p.job_id = ? AND p.page = ?').bind(jobId, page)
    .first<{ status: string }>();
  if (!row) throw new ImportError('no such page', 404);
  if (row.status === 'reading' || row.status === 'done') throw new ImportError('page already read', 409);
  const key = `imports/${jobId}/page-${String(page).padStart(2, '0')}.${type.split('/')[1]}`;
  await env.IMPORTS.put(key, body, { httpMetadata: { contentType: type } });
  await env.DB.prepare(`UPDATE import_pages SET image_key = ?, status = 'uploaded', error = NULL, updated_at = ? WHERE job_id = ? AND page = ?`)
    .bind(key, new Date().toISOString(), jobId, page).run();
}

/** Start (or restart) background reading of the given pages. */
export async function startReading(env: Env, jobId: string, pages?: number[]) {
  const { results } = await env.DB.prepare('SELECT page, status FROM import_pages WHERE job_id = ?').bind(jobId)
    .all<{ page: number; status: string }>();
  if (!results.length) throw new ImportError('no such import', 404);
  const want = pages ?? results.filter((r) => r.status === 'uploaded').map((r) => r.page);
  const missing = results.filter((r) => want.includes(r.page) && r.status === 'waiting');
  if (missing.length) throw new ImportError(`page ${missing[0].page} has no photo yet`, 409);
  if (!want.length) throw new ImportError('nothing to read', 409);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE import_jobs SET status = 'processing', updated_at = ? WHERE id = ?`).bind(now, jobId),
    env.DB.prepare(
      `UPDATE import_pages SET status = 'reading', error = NULL, updated_at = ?
       WHERE job_id = ? AND page IN (SELECT value FROM json_each(?))`,
    ).bind(now, jobId, JSON.stringify(want)),
  ]);
  try {
    await env.IMPORT_WORKFLOW.create({ id: `${jobId}-${Date.now()}`, params: { jobId, pages: want } });
  } catch (e) {
    // Don't leave pages stuck in 'reading' when nothing is reading them.
    await env.DB.prepare(
      `UPDATE import_pages SET status = 'uploaded', updated_at = ? WHERE job_id = ? AND page IN (SELECT value FROM json_each(?))`,
    ).bind(new Date().toISOString(), jobId, JSON.stringify(want)).run();
    throw e;
  }
}

export async function getJob(db: D1Database, jobId: string): Promise<ImportJob> {
  const job = await db.prepare('SELECT * FROM import_jobs WHERE id = ?').bind(jobId).first<Omit<ImportJob, 'pages'>>();
  if (!job) throw new ImportError('no such import', 404);
  const { results } = await db.prepare('SELECT page, status, image_key, error, result, updated_at FROM import_pages WHERE job_id = ? ORDER BY page')
    .bind(jobId).all<Omit<ImportPageInfo, 'result'> & { result: string | null }>();
  return { ...job, pages: results.map((p) => ({ ...p, result: p.result ? (JSON.parse(p.result) as ParsedPage) : null })) };
}

export async function listJobs(db: D1Database, kind: ImportKind): Promise<ImportJobSummary[]> {
  const { results } = await db.prepare(
    `SELECT j.id, j.kind, j.status, j.page_count, j.created_at,
            SUM(p.status = 'done') AS pages_done, SUM(p.status = 'failed') AS pages_failed,
            (SELECT json_extract(p2.result, '$.kit_name') FROM import_pages p2
              WHERE p2.job_id = j.id AND json_extract(p2.result, '$.kit_name') IS NOT NULL ORDER BY p2.page LIMIT 1) AS kit_name,
            (SELECT json_extract(p3.result, '$.page_label') FROM import_pages p3
              WHERE p3.job_id = j.id AND json_extract(p3.result, '$.page_label') IS NOT NULL ORDER BY p3.page LIMIT 1) AS page_label
     FROM import_jobs j JOIN import_pages p ON p.job_id = j.id
     WHERE j.kind = ?
     GROUP BY j.id ORDER BY j.created_at DESC LIMIT 50`,
  ).bind(kind).all<ImportJobSummary>();
  return results;
}

export async function markCommitted(db: D1Database, jobId: string) {
  await db.prepare(`UPDATE import_jobs SET status = 'committed', updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), jobId).run();
}

export async function deleteJob(env: Env, jobId: string) {
  const listed = await env.IMPORTS.list({ prefix: `imports/${jobId}/` });
  if (listed.objects.length) await env.IMPORTS.delete(listed.objects.map((o) => o.key));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM import_pages WHERE job_id = ?').bind(jobId),
    env.DB.prepare('DELETE FROM import_jobs WHERE id = ?').bind(jobId),
  ]);
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
