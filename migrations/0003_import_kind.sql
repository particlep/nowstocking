-- Photo jobs now read either packing lists or plans (instruction) pages.
ALTER TABLE import_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'packing_list'
  CHECK (kind IN ('packing_list', 'instructions'));
