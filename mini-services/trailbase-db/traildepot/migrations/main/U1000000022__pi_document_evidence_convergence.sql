-- TENGASELL-PI-01D / VEH-04 + VEH-05 — document artefact and fact convergence.

ALTER TABLE vehicle_documents ADD COLUMN document_number TEXT;
ALTER TABLE vehicle_documents ADD COLUMN artifact_required INTEGER NOT NULL DEFAULT 0 CHECK(artifact_required IN (0,1));
ALTER TABLE vehicle_documents ADD COLUMN artifact_state TEXT NOT NULL DEFAULT 'NOT_REQUIRED'
  CHECK(artifact_state IN ('NOT_REQUIRED','MISSING','STORED','VERIFIED','REJECTED'));
ALTER TABLE vehicle_documents ADD COLUMN visibility_policy_key TEXT NOT NULL DEFAULT 'DOCUMENT_REFERENCE_CLASSIFIED';
ALTER TABLE vehicle_documents ADD COLUMN verified_artifact_hash TEXT;
ALTER TABLE vehicle_documents ADD COLUMN historic_review_required INTEGER NOT NULL DEFAULT 0 CHECK(historic_review_required IN (0,1));

-- Preserve historical verification state. Ambiguous historical rows are queued
-- for review instead of being silently invalidated.
UPDATE vehicle_documents
   SET historic_review_required=1
 WHERE status='VERIFIED' AND storage_ref IS NULL;

CREATE TABLE pi_document_fact_assertions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES vehicle_documents(id),
  fact_assertion_id INTEGER NOT NULL REFERENCES pi_fact_assertions(id),
  extraction_path TEXT NOT NULL,
  created_by BLOB,
  created_at TEXT NOT NULL,
  UNIQUE(document_id,fact_assertion_id)
) STRICT;
CREATE INDEX idx_pi_document_fact_document ON pi_document_fact_assertions(document_id);

CREATE TRIGGER trg_vehicle_document_artifact_insert
BEFORE INSERT ON vehicle_documents
WHEN NEW.status='VERIFIED' AND NEW.artifact_required=1 AND NEW.storage_ref IS NULL
BEGIN SELECT RAISE(ABORT,'VEHICLE_DOCUMENT_ARTIFACT_REQUIRED'); END;

CREATE TRIGGER trg_vehicle_document_artifact_verify
BEFORE UPDATE OF status ON vehicle_documents
WHEN NEW.status='VERIFIED' AND NEW.artifact_required=1 AND NEW.storage_ref IS NULL
BEGIN SELECT RAISE(ABORT,'VEHICLE_DOCUMENT_ARTIFACT_REQUIRED'); END;

CREATE TRIGGER trg_pi_document_fact_specific
BEFORE INSERT ON pi_document_fact_assertions
WHEN NOT EXISTS(
  SELECT 1
    FROM vehicle_documents d
    JOIN pi_fact_assertions f ON f.id=NEW.fact_assertion_id
   WHERE d.id=NEW.document_id
     AND f.product_type='VEHICLE'
     AND f.product_id=d.vehicle_id
     AND f.source_class='DOCUMENT_DERIVED'
     AND f.source_ref_type='vehicle_documents'
     AND f.source_ref_id=d.id
     AND f.verification_state='VERIFIED'
)
BEGIN SELECT RAISE(ABORT,'PI_DOCUMENT_FACT_MUST_BE_SPECIFIC_VERIFIED_ASSERTION'); END;
