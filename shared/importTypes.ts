import { z } from 'zod';

export const ParsedRow = z.object({
  kind: z.enum(['subkit', 'bag', 'part']),
  indented: z.boolean().describe('True when the line is visually indented under a BAG line above it.'),
  stock_code: z.string().describe('Exactly as printed, including dashes and spaces.'),
  description: z.string(),
  qty: z.number(),
  vans_bin: z.string().nullable().describe("Van's warehouse bin column, e.g. HW, E3B. Null if blank."),
  uncertain: z.boolean().describe('True if any field on this line was hard to read.'),
  note: z.string().nullable().describe('Why the line is uncertain, if it is.'),
});

export const ParsedPage = z.object({
  kit_name: z.string().nullable().describe('Kit title from the page header, e.g. "RV-14A EMP/CONE KIT". Null if not shown.'),
  page_label: z.string().nullable().describe('Page number as printed, e.g. "2 of 7". Null if not shown.'),
  rows: z.array(ParsedRow),
});

export type ParsedRow = z.infer<typeof ParsedRow>;
export type ParsedPage = z.infer<typeof ParsedPage>;

export type ImportJobStatus = 'uploading' | 'processing' | 'done' | 'committed';
export type ImportPageStatus = 'waiting' | 'uploaded' | 'reading' | 'done' | 'failed';

export interface ImportPageInfo {
  page: number;
  status: ImportPageStatus;
  image_key: string | null;
  error: string | null;
  result: ParsedPage | null;
  updated_at: string;
}

export interface ImportJob {
  id: string;
  status: ImportJobStatus;
  page_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  pages: ImportPageInfo[];
}

export interface ImportJobSummary {
  id: string;
  status: ImportJobStatus;
  page_count: number;
  pages_done: number;
  pages_failed: number;
  kit_name: string | null;
  created_at: string;
}
