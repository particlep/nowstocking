-- Background photo imports. Photos live in R2; a Workflow reads each page and stores the rows here.
CREATE TABLE import_jobs (
  id            TEXT PRIMARY KEY,
  status        TEXT NOT NULL CHECK (status IN ('uploading','processing','done','committed')),
  page_count    INTEGER NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE import_pages (
  job_id        TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  page          INTEGER NOT NULL,
  image_key     TEXT,
  status        TEXT NOT NULL CHECK (status IN ('waiting','uploaded','reading','done','failed')),
  error         TEXT,
  result        TEXT,              -- JSON ParsedPage
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (job_id, page)
);
