// tests/setup.ts — environment for the Paynow security/reliability suite.
//
// The server modules under test read their configuration from process.env
// at import time (TRAILBASE_URL) and call time (Paynow credentials,
// NODE_ENV). Everything is pointed at the in-test emulators before any
// module graph loads; individual tests flip PAYNOW_* / NODE_ENV per case.

process.env.TRAILBASE_URL = "http://tb.test";
process.env.FINANCE_URL = "http://finance.test";
// Live gateway credentials for the trust-boundary / sweep tests; tests that
// exercise mock mode explicitly delete these.
process.env.PAYNOW_INTEGRATION_ID = "9999";
process.env.PAYNOW_INTEGRATION_KEY = "test-integration-key";

// Deterministic nowIso()-adjacent clock behaviour is not needed; the
// sweep's staleness filter uses real wall time, tests write
// old-enough timestamps directly.

// Silence the fire-and-forget finance/console noise from settlement paths.
process.env.TGS_TEST = "1";
