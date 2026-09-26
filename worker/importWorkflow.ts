import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { aiStatus, recordAiUsage } from './aiBudget';
import { readPage } from './import';

export interface ImportParams {
  accountId: string;
  warehouseId: string;
  jobId: string;
  pages: number[];
}

/**
 * Reads photos in the background, all pages at once. Each page is its own step, retried on failure,
 * so the phone can be locked or closed while this runs. Results go into the warehouse's Durable Object.
 */
export class ImportWorkflow extends WorkflowEntrypoint<Env, ImportParams> {
  async run(event: WorkflowEvent<ImportParams>, step: WorkflowStep) {
    const { accountId, warehouseId, jobId, pages } = event.payload;
    const warehouse = () => this.env.WAREHOUSE.get(this.env.WAREHOUSE.idFromName(warehouseId));

    await Promise.all(
      pages.map(async (page) => {
        try {
          return await step.do(
            `read page ${page}`,
            { retries: { limit: 2, delay: '20 seconds', backoff: 'exponential' }, timeout: '15 minutes' },
            async () => {
              const target = await warehouse().pageToRead(jobId, page);
              if (!target) throw new NonRetryableError('page has no photo');
              // Checked per page, so a job stops at the limit instead of running past it.
              const status = await aiStatus(this.env, accountId);
              if (!status.allowed) {
                throw new NonRetryableError(status.paused_for_everyone
                  ? 'Photo reading is paused for everyone until next month.'
                  : "This workshop's photo-reading allowance is used up.");
              }
              const parsed = await readPage(this.env, target.imageKey, page, target.kind, (model, usage) =>
                recordAiUsage(this.env, { accountId, warehouseId, jobId, page, kind: target.kind, model, usage }));
              await warehouse().pageDone(jobId, page, parsed);
              return 'rows' in parsed ? parsed.rows.length : parsed.parts.length;
            },
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await step.do(`page ${page} failed`, async () => {
            await warehouse().pageFailed(jobId, page, message);
          });
          return 0;
        }
      }),
    );

    await step.do('finish', async () => {
      await warehouse().finishJobIfDone(jobId);
    });
  }
}
