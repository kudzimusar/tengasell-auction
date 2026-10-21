# Tengasell Operations Runbooks (MSCS 12-e — OPS-015, DOC-008)

Internal-only. Concise, real procedures. Review: quarterly or after any incident.

## On-call & escalation (OPS-010, INC-001..004)

- Severity model: **S1** total outage / money movement broken / data breach — respond now, 15-min updates.
  **S2** major feature down (bidding, payments, sign-in) — respond <1h.
  **S3** degraded (one console, one channel provider) — same day.
  **S4** cosmetic/docs — next sprint.
- Escalation: on-call engineer → platform lead → CEO (S1/S2). Security/privacy incidents additionally engage the compliance owner (PRV-016 path).
- Commander role: the first responder owns the incident record (Governance console → Incidents): timeline entries from detection to close, RCA and corrective actions before closing.

## Service recovery (BCP-006, INF)

All services are watchdog-ensured by the Next.js dev/prod server (`src/lib/server/services-spawn.ts`, 60s cadence). Manual restart recipes (orphaned spawn — survives the sandbox reaper):

```bash
bun -e 'const p=Bun.spawn(["bash","-c","exec bunx next dev -p 3000 >> dev.log 2>&1"],{detached:true,stdio:["ignore","ignore","ignore"]}); p.unref();'
bun -e 'const p=Bun.spawn(["bash","-c","cd mini-services/<service> && exec bun run dev >> dev.log 2>&1"],{detached:true,stdio:["ignore","ignore","ignore"]}); p.unref();'
```

Services: Next :3000 · TrailBase :3001 · trade-engine :3002 · GIS :3004 · comms :3005 · finance :3006 · trust :3007 · govern :3008 · gateway :81.

Health probe: `bun ops/smoke.ts` (also wired into Admin → System health → "Run smoke checks").

## Backup & restore (BCP-002..005, DAT-012/013)

- **RPO 24h / RTO 1h.**
- Backup: `bun ops/backup.ts` → `backups/<ts>/` (SQLite backup-API snapshots of TrailBase main.db + every service db + manifest.json with SHA-256). Schedule daily 02:00 CAT via cron or the platform scheduler.
- Restore procedure: copy the snapshots from the chosen backup dir to the live db paths (stop the owning service first), restart the service, run `bun ops/smoke.ts`, spot-check counts.
- **Restore tests are mandatory and evidence-backed**: `bun ops/restore-test.ts` writes `backups/restore-test-<ts>.json`. Last run: 2026-10-20 — 48/48 checks ok. Re-run after every schema change and at least monthly.

## Credential compromise (BCP-008, SEC-008)

1. Rotate the compromised credential at its provider (TrailBase admin password, provider tokens: Paynow / Telegram / WhatsApp / Resend / z-ai).
2. Revoke sessions: TrailBase admin re-login invalidates old tokens; user-level: suspend the account via Users console (reason: `credential_compromise`), then restore after the reset.
3. Record the incident (Governance console → Incidents, type security) with timeline; if personal data was exposed → PRV-016 breach workflow + POTRAZ notification assessment.
4. Rotate `db/flags.json` unaffected; secrets live in env/TrailBase secrets — update both host env and any `.env`.

## Break-glass emergency access (BCP-011, IAM-010)

- The sealed admin credentials are held by the CEO + platform lead (password manager, 2 holders).
- Use only when the normal admin path is unavailable; every break-glass use MUST create an incident record + rotate the password afterwards.
- Break-glass does NOT bypass the audit log (all admin actions write audit_events rows).

## Maintenance & flags (CTL-014/015/022)

Feature flags live in `db/flags.json`, edited via Admin → Configuration (who/when/why audited): `maintenance_mode` (platform API gate), `assistant_enabled` (assistant API gate), `sell_enabled`, `payouts_enabled`, `alerts_enabled`.

## DR & continuity (BCP-001, INC-005..008)

- Single-host deployment with backup copies; region failure = restore-elsewhere procedure (above) + DNS repoint.
- Customer notification: Comms console → campaign to affected segment (or all-users emergency broadcast); regulator notification assessed via the incident record's `regulatory_reportable` flag.
- Continuity exercise: the incident recorded 2026-10-20 (dev-server reaping → watchdog restore) + the monthly restore tests serve as the exercise log.

## Data subject requests (PRV-005..010 — support hand-off)

Privacy Centre requests appear in Admin → Governance → Privacy. SLA 30 days (CDPA). Export = process → download bundle; deletion = check legal holds first (blocks automatically); restriction/objection = flag + confirm in the result note.
