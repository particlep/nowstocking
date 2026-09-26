import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { readPage } from './import';

export interface ImportParams {
  jobId: string;
  pages: number[];
}

/**
 * Reads packing-list pages in the background, all pages at once. Each page is its own step,
 * retried on failure, so the phone can be locked or closed while this runs.
 */
export class ImportWorkflow extends WorkflowEntrypoint<Env, ImportParams> {
  async run(event: WorkflowEvent<ImportParams>, step: WorkflowStep) {
    const { jobId, pages } = event.payload;
    const db = this.env.DB;

    await Promise.all(
      pages.map(async (page) => {
        try {
          const rows = await step.do(
            `read page ${page}`,
            { retries: { limit: 2, delay: '20 seconds', backoff: 'exponential' }, timeout: '15 minutes' },
            async () => {
              const row = await db.prepare('SELECT image_key FROM import_pages WHERE job_id = ? AND page = ?')
                .bind(jobId, page).first<{ image_key: string | null }>();
              if (!row?.image_key) throw new Error('page has no photo');
              const parsed = await readPage(this.env, row.image_key, page);
              await db.prepare(`UPDATE import_pages SET status = 'done', result = ?, error = NULL, updated_at = ? WHERE job_id = ? AND page = ?`)
                .bind(JSON.stringify(parsed), new Date().toISOString(), jobId, page).run();
              return parsed.rows.length;
            },
          );
          return rows;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await step.do(`page ${page} failed`, async () => {
            await db.prepare(`UPDATE import_pages SET status = 'failed', error = ?, updated_at = ? WHERE job_id = ? AND page = ?`)
              .bind(message.slice(0, 500), new Date().toISOString(), jobId, page).run();
          });
          return 0;
        }
      }),
    );

    await step.do('finish', async () => {
      await db.prepare(
        `UPDATE import_jobs SET status = 'done', updated_at = ?
         WHERE id = ? AND status = 'processing'
           AND NOT EXISTS (SELECT 1 FROM import_pages WHERE job_id = ? AND status = 'reading')`,
      ).bind(new Date().toISOString(), jobId, jobId).run();
    });
  }
}
