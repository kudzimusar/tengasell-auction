-- TENGASELL-AUCTION-CERT-01-PREP
-- Defense-in-depth convergence for vehicle commercial lifecycle.
-- Prevent legacy order/update paths from bypassing Finance, statutory transfer
-- evidence, physical release and handover authority.

CREATE TRIGGER IF NOT EXISTS trg_vehicle_reserve_disclosure_insert
BEFORE INSERT ON auctions
WHEN NEW.asset_kind='vehicle'
 AND (
   (NEW.reserve_price IS NULL AND NEW.reserve_disclosure<>'NO_RESERVE')
   OR
   (NEW.reserve_price IS NOT NULL AND NEW.reserve_disclosure NOT IN ('RESERVE_APPLIES','UPSET_APPLIES'))
 )
BEGIN
  SELECT RAISE(ABORT,'VEHICLE_RESERVE_DISCLOSURE_REQUIRED');
END;

CREATE TRIGGER IF NOT EXISTS trg_vehicle_reserve_disclosure_update
BEFORE UPDATE OF reserve_price,reserve_disclosure,asset_kind ON auctions
WHEN NEW.asset_kind='vehicle'
 AND (
   (NEW.reserve_price IS NULL AND NEW.reserve_disclosure<>'NO_RESERVE')
   OR
   (NEW.reserve_price IS NOT NULL AND NEW.reserve_disclosure NOT IN ('RESERVE_APPLIES','UPSET_APPLIES'))
 )
BEGIN
  SELECT RAISE(ABORT,'VEHICLE_RESERVE_DISCLOSURE_REQUIRED');
END;

-- A vehicle statutory-transfer completion is not a free-form state toggle.
-- At least one external-process document must be accepted and the settlement
-- must first record external evidence received.
CREATE TRIGGER IF NOT EXISTS trg_vehicle_transfer_complete_gate
BEFORE INSERT ON auction_transfer_commands
WHEN NEW.command_type='COMPLETE'
 AND EXISTS(
   SELECT 1 FROM auction_settlements s
    WHERE s.id=NEW.settlement_id AND s.vehicle_id IS NOT NULL
 )
BEGIN
  SELECT CASE
    WHEN NOT EXISTS(
      SELECT 1 FROM auction_settlements s
       WHERE s.id=NEW.settlement_id AND s.transfer_state='EVIDENCE_RECEIVED'
    )
    THEN RAISE(ABORT,'EXTERNAL_TRANSFER_EVIDENCE_REQUIRED')
  END;
  SELECT CASE
    WHEN NOT EXISTS(
      SELECT 1 FROM auction_transfer_documents d
       WHERE d.settlement_id=NEW.settlement_id
         AND d.external_process=1
         AND d.status='ACCEPTED'
    )
    THEN RAISE(ABORT,'TRANSFER_DOCUMENTS_INCOMPLETE')
  END;
END;

-- Vehicle orders are mirrors of settlement authority. Old marketplace ACLs
-- cannot manufacture paid/shipped/delivered/completed state directly.
CREATE TRIGGER IF NOT EXISTS trg_vehicle_order_state_authority
BEFORE UPDATE OF status,paid_at,shipped_at,delivered_at,completed_at ON orders
WHEN EXISTS(
  SELECT 1 FROM auctions a WHERE a.id=NEW.auction_id AND a.asset_kind='vehicle'
)
BEGIN
  SELECT CASE
    WHEN NEW.status='paid'
     AND NOT EXISTS(
       SELECT 1 FROM auction_settlements s
        WHERE s.order_id=NEW.id AND s.payment_state='PAID'
     )
    THEN RAISE(ABORT,'FINANCE_CONFIRMATION_REQUIRED')
  END;

  SELECT CASE
    WHEN NEW.status IN ('shipped','delivered')
      OR NEW.shipped_at IS NOT NULL
      OR NEW.delivered_at IS NOT NULL
    THEN RAISE(ABORT,'VEHICLE_GENERIC_DELIVERY_FORBIDDEN')
  END;

  SELECT CASE
    WHEN NEW.status='completed'
     AND NOT EXISTS(
       SELECT 1
         FROM auction_settlements s
         JOIN auction_handovers h ON h.settlement_id=s.id
        WHERE s.order_id=NEW.id
     )
    THEN RAISE(ABORT,'VEHICLE_HANDOVER_REQUIRED')
  END;

  SELECT CASE
    WHEN NEW.paid_at IS NOT NULL
     AND NOT EXISTS(
       SELECT 1 FROM auction_settlements s
        WHERE s.order_id=NEW.id AND s.payment_state='PAID'
     )
    THEN RAISE(ABORT,'FINANCE_CONFIRMATION_REQUIRED')
  END;
END;

-- Physical handover is the vehicle-order completion event. This keeps legacy
-- order read surfaces consistent without granting them authority.
CREATE TRIGGER IF NOT EXISTS trg_vehicle_handover_complete_order
AFTER INSERT ON auction_handovers
BEGIN
  UPDATE orders
     SET status='completed',
         completed_at=NEW.handed_over_at,
         updated_at=NEW.handed_over_at
   WHERE id=(SELECT order_id FROM auction_settlements WHERE id=NEW.settlement_id)
     AND EXISTS(
       SELECT 1 FROM auction_settlements s
        WHERE s.id=NEW.settlement_id AND s.vehicle_id IS NOT NULL
     )
     AND EXISTS(
       SELECT 1 FROM auction_release_authorizations r
        WHERE r.id=NEW.release_authorization_id AND r.settlement_id=NEW.settlement_id
     );
END;
