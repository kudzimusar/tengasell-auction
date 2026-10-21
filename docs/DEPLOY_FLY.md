# Deploying the real node to Fly.io

This deploys the **real stack** — Next.js, Trailbase (Rust), the six mini-services and the
gateway — not the static demo. One machine, one public URL, SQLite on a persistent volume.

---

## Why Fly

| Option | Verdict |
| --- | --- |
| **Fly.io** (this doc) | Runs a persistent Linux process + volume. SQLite survives deploys. ~US$2–4/month at 512 MB. |
| GitHub Pages | Static only — cannot run Trailbase or the gateway. Demo only. |
| Render free | Sleeps after 15 min and has no persistent disk on the free plan — SQLite resets. |
| Railway / Koyeb free | Trial credit or no volume — not durable for a database. |
| Small VPS (Hetzner/Contabo) | Cheapest long-term (~€4), but you manage the OS. Same Docker image works. |

Fly has no permanent free tier any more; a `shared-cpu-1x` 512 MB machine with a 1 GB volume is
a few dollars a month. That is the honest floor for "a real database that stays up".

---

## One-time setup

```bash
# 1. install flyctl
curl -L https://fly.io/install.sh | sh

# 2. authenticate (opens the browser; approve the device)
~/.fly/bin/flyctl auth login

# 3. from the repo root — creates the app, keeps fly.toml
~/.fly/bin/flyctl launch --copy-config --name tengasell-zw --region jnb

# 4. persistent volume for /data (Trailbase + Prisma databases)
~/.fly/bin/flyctl volumes create tengasell_data --size 1 --region jnb
```

`jnb` (Johannesburg) is the closest region to Zimbabwe.

---

## Deploy

```bash
~/.fly/bin/flyctl deploy
```

The image builds remotely for `linux/amd64` (Trailbase's own release binary is x86_64 Linux),
then the entrypoint:

1. seeds `/data/traildepot` from `depot-template` and installs the marketplace database
2. seeds `/data/db/custom.db` from the platform database
3. starts Trailbase on `:3001` and waits for the records API
4. starts the six mini-services with Bun (`:3002`, `:3004`–`:3008`)
5. starts Next.js on `:3000`
6. starts the gateway on `$PORT` (`8080`), which Fly exposes over HTTPS

---

## Verify

```bash
APP=https://tengasell-zw.fly.dev

curl -s -o /dev/null -w '%{http_code}\n' "$APP/"                       # 200
curl -s "$APP/api/records/v1/auctions?limit=1&count=true&XTransformPort=3001" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["total_count"])'   # 55
curl -s "$APP/api/records/v1/categories?limit=1&XTransformPort=3001" | head -c 120
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "$APP/api/auth/v1/login?XTransformPort=3001" \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"Tengasell#2025"}'                 # 200
```

The app picks **live mode** automatically once that records probe succeeds — the same probe
Pages always fails.

---

## Operations

| Task | Command |
| --- | --- |
| Logs | `flyctl logs` |
| Shell | `flyctl ssh console` |
| Status | `flyctl status` |
| Restart | `flyctl apps restart tengasell-zw` |
| Scale memory | `flyctl scale memory 1024` |
| Set secrets | `flyctl secrets set PAYNOW_INTEGRATION_ID=… PAYNOW_INTEGRATION_KEY=…` |

**Persistence:** everything under `/data` survives deploys and restarts. Without the volume
attached the databases reset — keep the `[[mounts]]` block.

**Scaling:** SQLite means exactly one machine. Moving to Postgres is the prerequisite for
running more than one instance.

---

## Secrets to set before real use

| Group | Variables |
| --- | --- |
| Paynow | `PAYNOW_INTEGRATION_ID`, `PAYNOW_INTEGRATION_KEY`, `PAYNOW_RESULT_URL`, `PAYNOW_RETURN_URL` |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` |
| WhatsApp / Messenger / Telegram | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET`, `MESSENGER_PAGE_TOKEN`, `TELEGRAM_BOT_TOKEN` |
| Auth | `NEXTAUTH_SECRET`, `PLATFORM_JWT_SECRET`, `TGS_INTERNAL_SECRET`, `TGS_INTERNAL_TOKEN` |
| Staff | `ADMIN_USERNAME`, `ADMIN_PASSWORD` (change from the demo default) |

All of these currently fall back to dev defaults, which is why payments run in mock mode.

---

## Cost shape

| Item | Spec | Approx. |
| --- | --- | --- |
| Machine | shared-cpu-1x, 512 MB | ~US$2–3 / month |
| Volume | 1 GB | ~US$0.15 / month |
| Egress | light traffic | negligible |

Set a billing alert in the Fly dashboard; the app is not traffic-heavy yet.
