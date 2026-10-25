-- TENGASELL-AUCTION-CERT-01-STG01-R1
-- Certification-only legal gate convergence.
--
-- The accepted IMP-09 documentation already identified an unresolved
-- interaction between Consumer Protection Act section 39(3) (auction
-- completion / pre-completion bid retraction) and section 53 (electronic
-- transaction cooling-off). U14 did not persist that unresolved question as a
-- required-for-production policy row, so the production gate could become
-- green without legal closure. This migration adds the missing fail-closed
-- policy authority only. It does NOT change auction or retraction behavior.

INSERT OR IGNORE INTO auction_policy_registry(
  policy_key,value_json,classification,configured,required_for_production,
  source_title,source_url,source_checked_at,notes,
  updated_by,updated_by_username,updated_at
) VALUES(
  'legal.electronic_transaction.auction_cooling_off_interaction',
  NULL,
  'PENDING_LEGAL_REVIEW',
  0,
  1,
  'Zimbabwe Consumer Protection Act, 2019 — sections 39(3) and 53',
  'https://zimlii.org/akn/zw/act/2019/5/eng@2019-12-10',
  '2026-10-25T00:00:00Z',
  'Legal review required before Production: determine whether and how section 53 electronic-transaction cooling-off applies after completion of an electronic vehicle auction under section 39(3). No post-completion consumer right is invented or waived by this registry row.',
  NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
);

UPDATE auction_service_health
   SET detail='Schema tip U16 installed; legal cooling-off interaction remains a required Production policy gate',
       checked_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
 WHERE service_key='MIGRATIONS';
