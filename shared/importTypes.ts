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

export const InstructionPart = z.object({
  stock_code: z.string().describe('Part number exactly as printed, e.g. F-01412C, AN470AD4-5, WH-00059.'),
  qty: z.number().nullable().describe('Quantity if the page states one for this part (e.g. "2X"), else null.'),
  kind: z.enum(['part', 'hardware', 'electrical', 'other']).describe(
    'part = aircraft part (F-, HS-, VA-, etc.); hardware = rivets, bolts, nuts, washers, bushings (AN, MS, NAS, SB, CS, LP); electrical = harnesses, wires, connectors; other = anything else.',
  ),
  context: z.string().describe('Where it appears, e.g. "Step 4, Figure 3".'),
  uncertain: z.boolean().describe('True if the part number was hard to read.'),
  note: z.string().nullable().describe('Why it is uncertain, if it is.'),
});

export const ParsedInstructions = z.object({
  page_label: z.string().nullable().describe('Plans page number as printed, e.g. "10-27". Null if not visible.'),
  section: z.string().nullable().describe('Section number, e.g. "10" for page 10-27. Null if unknown.'),
  title: z.string().nullable().describe('Short title for the work on this page, from figure titles or the steps, e.g. "Aft deck".'),
  parts: z.array(InstructionPart),
});

export type InstructionPart = z.infer<typeof InstructionPart>;
export type ParsedInstructions = z.infer<typeof ParsedInstructions>;
export type ImportKind = 'packing_list' | 'instructions';

export type ImportJobStatus = 'uploading' | 'processing' | 'done' | 'committed';
export type ImportPageStatus = 'waiting' | 'uploaded' | 'reading' | 'done' | 'failed';

export interface ImportPageInfo {
  page: number;
  status: ImportPageStatus;
  image_key: string | null;
  error: string | null;
  /** ParsedPage for packing lists, ParsedInstructions for instruction pages. */
  result: ParsedPage | ParsedInstructions | null;
  updated_at: string;
}

export interface ImportJob {
  id: string;
  kind: ImportKind;
  title: string | null;
  status: ImportJobStatus;
  page_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  pages: ImportPageInfo[];
}

export interface ImportJobSummary {
  id: string;
  kind: ImportKind;
  title: string | null;
  status: ImportJobStatus;
  page_count: number;
  pages_done: number;
  pages_failed: number;
  kit_name: string | null;
  page_label: string | null;
  created_at: string;
}

export function packingResult(p: ImportPageInfo): ParsedPage | null {
  return p.result && 'rows' in p.result ? p.result : null;
}

export function instructionsResult(p: ImportPageInfo): ParsedInstructions | null {
  return p.result && 'parts' in p.result ? p.result : null;
}
