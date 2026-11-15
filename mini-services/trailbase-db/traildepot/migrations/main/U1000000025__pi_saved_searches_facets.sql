-- TENGASELL-PI-01E / DISC-03 — structured saved searches & facets.
--
-- Preserves existing saved-search functionality and compatibility with legacy
-- queries, categories and price bounds while binding structured category/schema
-- linkage and persisting per-facet criteria for alert matching.

ALTER TABLE saved_searches ADD COLUMN product_category_id INTEGER REFERENCES categories(id);
ALTER TABLE saved_searches ADD COLUMN product_schema_version_id INTEGER REFERENCES pi_category_schema_versions(id);
ALTER TABLE saved_searches ADD COLUMN category_key TEXT;

CREATE TABLE saved_search_facets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  saved_search_id INTEGER NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  attribute_key TEXT NOT NULL,
  operator TEXT NOT NULL CHECK(operator IN ('EQ','IN','MIN','MAX','BETWEEN','EXISTS')),
  value_text TEXT,
  value_number REAL,
  value_boolean INTEGER,
  value_min REAL,
  value_max REAL,
  value_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT '',
  CHECK(json_valid(value_json))
) STRICT;

CREATE INDEX idx_saved_search_facets_search ON saved_search_facets(saved_search_id);
CREATE INDEX idx_saved_search_facets_attr ON saved_search_facets(attribute_key);
