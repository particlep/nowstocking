-- Global version counter. Every write takes the next value; clients sync by version.
CREATE TABLE sync_counter (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  value         INTEGER NOT NULL
);

CREATE TABLE kits (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  received_at   TEXT,
  version       INTEGER NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE TABLE locations (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL CHECK (type IN ('bin','shelf','crate','rack','other')),
  description   TEXT,
  version       INTEGER NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE TABLE items (
  id              INTEGER PRIMARY KEY,
  kit_id          INTEGER NOT NULL REFERENCES kits(id),
  parent_id       INTEGER REFERENCES items(id),
  item_type       TEXT NOT NULL CHECK (item_type IN ('subkit','bag','part')),
  stock_code      TEXT NOT NULL,
  search_key      TEXT NOT NULL,
  description     TEXT,
  qty             REAL NOT NULL,
  unit            TEXT NOT NULL CHECK (unit IN ('ea','lb')),
  vans_bin        TEXT,
  status          TEXT NOT NULL DEFAULT 'expected'
                  CHECK (status IN ('expected','received','missing','damaged','backordered')),
  source          TEXT NOT NULL DEFAULT 'import' CHECK (source IN ('import','manual')),
  notes           TEXT,
  sort_order      INTEGER NOT NULL,
  version         INTEGER NOT NULL,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT NOT NULL,
  deleted_at      TEXT
);

CREATE INDEX idx_items_search ON items(search_key);
CREATE INDEX idx_items_parent ON items(parent_id);
CREATE INDEX idx_items_kit ON items(kit_id);

CREATE TABLE placements (
  id            INTEGER PRIMARY KEY,
  item_id       INTEGER NOT NULL REFERENCES items(id),
  location_id   INTEGER NOT NULL REFERENCES locations(id),
  qty           REAL,
  version       INTEGER NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE INDEX idx_placements_item ON placements(item_id);
CREATE INDEX idx_placements_location ON placements(location_id);

CREATE TABLE pick_lists (
  id            INTEGER PRIMARY KEY,
  section       TEXT NOT NULL,
  page          TEXT,
  title         TEXT,
  version       INTEGER NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE TABLE pick_list_lines (
  id            INTEGER PRIMARY KEY,
  pick_list_id  INTEGER NOT NULL REFERENCES pick_lists(id),
  stock_code    TEXT NOT NULL,
  search_key    TEXT NOT NULL,
  qty_needed    REAL,
  pulled        INTEGER NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE INDEX idx_pick_list_lines_list ON pick_list_lines(pick_list_id);

CREATE TABLE consumptions (
  id            INTEGER PRIMARY KEY,
  item_id       INTEGER NOT NULL REFERENCES items(id),
  qty           REAL NOT NULL,
  pick_list_id  INTEGER REFERENCES pick_lists(id),
  note          TEXT,
  version       INTEGER NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE INDEX idx_consumptions_item ON consumptions(item_id);

CREATE INDEX idx_kits_version ON kits(version);
CREATE INDEX idx_locations_version ON locations(version);
CREATE INDEX idx_items_version ON items(version);
CREATE INDEX idx_placements_version ON placements(version);
CREATE INDEX idx_pick_lists_version ON pick_lists(version);
CREATE INDEX idx_pick_list_lines_version ON pick_list_lines(version);
CREATE INDEX idx_consumptions_version ON consumptions(version);

CREATE TABLE applied_mutations (
  mutation_id   TEXT PRIMARY KEY,
  result        TEXT,              -- JSON: temp id -> real id map, returned on replay
  applied_at    TEXT NOT NULL
);

CREATE TABLE change_log (
  id            INTEGER PRIMARY KEY,
  table_name    TEXT NOT NULL,
  row_id        INTEGER NOT NULL,
  field         TEXT NOT NULL,
  old_value     TEXT,
  new_value     TEXT,
  mutation_id   TEXT NOT NULL,
  changed_by    TEXT NOT NULL,
  changed_at    TEXT NOT NULL
);

CREATE INDEX idx_change_log_row ON change_log(table_name, row_id);

INSERT INTO sync_counter (id, value) VALUES (1, 1);
INSERT INTO kits (code, name, version, updated_at, updated_by)
VALUES ('MISC', 'Miscellaneous (not on a packing list)', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'system');
