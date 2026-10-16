# StudentOS $0 production deployment preparation

This is a deployment design and runbook, not a deployment. No cloud account, paid service, DNS zone, database, production migration, or public service is created by these instructions. Free-tier availability and quotas can change; review the linked provider pages before registration.

## Intended architecture

- One Oracle Cloud Always Free A1 VM runs Docker Compose, Caddy, the Next.js web app, the API, and a restricted egress gateway.
- Caddy accepts public HTTP/HTTPS on ports 80/443 and routes the two configured hostnames. Only Caddy publishes host ports.
- The API is multi-homed only onto internal app and proxy networks. The egress gateway is the only service attached to a non-internal network.
- The API uses an HTTP CONNECT proxy for provider/JWKS/S3 requests, a fixed TCP tunnel for Neon PostgreSQL, and the same proxy for SMTP. CONNECT preserves end-to-end TLS. The gateway enforces exact `host:port` approvals and resolves/pins public addresses.
- A host `DOCKER-USER` rule separately limits forwarded API traffic to gateway ports 3128 and 5432. Compose network isolation and the host policy are complementary; verify the active firewall after every Docker/network change.
- Neon is external. The API retains the Neon hostname in `DATABASE_URL` for certificate verification; Compose maps that hostname to the private gateway address, and the gateway opens the upstream database connection.

## Free-tier assumptions and limits

As checked 2026-10-15, Oracle documents the A1 Always Free allowance as 1,500 OCPU-hours/month and 9,000 GB-hours/month in aggregate (up to 2 OCPUs/12 GB for Always Free tenancies), plus 200 GB block volume and 10 TB monthly outbound transfer. Actual instance placement depends on home-region capacity; idle compute can be reclaimed under Oracle's policy. Confirm the current tenancy and regional limits before sizing. [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) · [Free Tier terms](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)

Neon Free currently lists 100 projects and 1 GB storage per project. Free compute has monthly CU-hour and transfer limits and scales to zero when idle; a sleeping database can add first-request latency. Neon free plans do not include IP allowlisting, so use TLS, a restricted database role, the private tunnel, and strong credentials. Check exact current quotas and retention before relying on them. [Neon Free plan update](https://neon.com/blog/neon-free-plan-1-gb-per-project) · [Neon IP allowlisting availability](https://neon.com/blog/restrict-access-to-your-neon-database-with-ip-allow)

These quotas can support a small prototype, not a guaranteed production SLA. Free capacity, service terms, provider availability, and account eligibility can change. Do not add billing or upgrade unless you choose to.

## Build and local review

From the repository root:

```sh
cp deploy/compose/.env.example deploy/compose/.env
# Edit deploy/compose/.env locally; never commit or paste its contents.
docker compose -f deploy/compose/compose.yaml config --quiet
docker compose -f deploy/compose/compose.yaml build
```

`Dockerfile` builds the API and gateway; `frontend/Dockerfile` builds the standalone Next.js app. All `.env` files are excluded from Docker contexts. The runtime images use the pinned Node 22.23.3 base, non-root users, read-only filesystems, dropped capabilities where supported, and no dev/test source tree. The Compose file intentionally publishes no API, web, database, or proxy port directly.

## Values and endpoint policy

`deploy/compose/.env.example` is a placeholder template. Generate separate 32-byte base64url `JWT_SECRET` and `ENCRYPTION_KEY` values. Keep all secrets in a local untracked file or a secrets manager; never pass them as build arguments. Use a Neon TLS connection string, ideally the provider's pooled hostname for a small app. Keep its original hostname in `DATABASE_URL` and copy the exact hostname to `EGRESS_DATABASE_HOST`.

`EGRESS_ALLOWED_DESTINATIONS` is a comma-separated, exact set of `hostname:port` approvals. Start with the Neon host on 5432, OpenRouter on 443, and Google JWKS on 443 only if those integrations are enabled. Add the exact S3 and SMTP endpoints only when configured. A tenant's custom AI provider must be HTTPS and its host/port must be operator-approved; adding a host is an explicit deployment policy update, not automatic tenant-controlled egress. Never approve broad wildcards, metadata addresses, private IPs, arbitrary ports, or tenant-supplied URLs without review. Update the API and gateway policy together.

`AI_MODEL` may be blank to use the OpenRouter adapter's free-model router. “Free” is subject to OpenRouter's current model availability, quotas, and rate limits; the request requires a valid API key and a model that is actually offered as free at request time. A working deployment must be checked with an authenticated real response before describing AI as operational.

## Database setup and migrations

1. Create a Neon project manually in the desired region and save its connection string privately. Do not use a production owner credential for routine application traffic; create a least-privilege application role and a separate migration role.
2. Keep `sslmode=require` (or stronger supported verification) and do not remove the Neon hostname from the URL. Restrict access to application tables as appropriate.
3. Before any production migration, inspect `backend/prisma/migrations` and the target schema, take a logical backup, and confirm restore access. This preparation did not run migrations against any database.
4. Apply reviewed migrations from a controlled one-off environment using the migration credential: `pnpm --filter @studentos/api exec prisma migrate deploy`. Never use `db push` on production. This project does not provide automatic down migrations; repair with a reviewed forward migration and restore from backup when necessary.
5. Schedule regular `pg_dump` exports to storage outside Neon, encrypt them, test restores into a separate disposable database, and document retention. Free-plan restore history is not a backup strategy.

## Host, DNS, and TLS operations

- Register no domain automatically. Point `WEB_DOMAIN` and `API_DOMAIN` A/AAAA records to the VM only after you choose a domain and have verified the VM address.
- In OCI security lists/network security groups, allow inbound TCP 80/443 from the Internet. Allow SSH only from your administrator CIDR. Do not expose 3000, 3001, 3128, or 5432.
- Configure the Linux host firewall before opening the service publicly. First run `docker compose -f deploy/compose/compose.yaml create` to create the private network without starting Caddy, then install Docker's `DOCKER-USER` forwarding policy with `sudo bash deploy/firewall/limit-api-egress.sh`; inspect `iptables -S DOCKER-USER`. Start services only after reviewing the rules. Confirm API internet access fails while proxy and DB-tunnel access work. Install the supplied oneshot after Docker starts so the rule is restored after reboot: copy `deploy/firewall/limit-api-egress.sh` to `/usr/local/sbin/studentos-limit-api-egress`, copy `deploy/firewall/studentos-api-egress.service` to `/etc/systemd/system/`, then run `sudo systemctl daemon-reload && sudo systemctl enable --now studentos-api-egress.service`. The script deliberately does not edit SSH/input rules. Keep OCI rules and host firewall rules consistent.
- Caddy obtains and renews public certificates using ACME. Make sure DNS resolves to the host and inbound 80/443 remain reachable. Persist `/data` and `/config` volumes.
- Pin image updates through reviewed version changes and rebuild; do not use `latest` for application images. Apply OS security updates, monitor disk capacity, and keep Docker/Node security patches current.

## Start, health, operations, and recovery

After reviewing environment values and firewall rules, an operator may choose to start the Compose project with `docker compose -f deploy/compose/compose.yaml up -d --build`. This instruction was not executed here. Check Caddy certificates, `/health`, gateway `/healthz` on its private network, API logs for startup errors (never enable secret logging), a real authenticated AI response, AI message persistence, object uploads if S3/local volume is enabled, and an actual Neon query. Verify denied egress to an unapproved host and to private/link-local IPs.

Track free quota and VM disk, Compose health, TLS renewal, database connections, backup age, and AI provider error/rate limits. Rotate database and application credentials after suspected exposure; update the local secret store and restart affected services. For restore, stop writes, restore a tested dump to a separate database first, validate schema and representative records, then switch `DATABASE_URL` only after an explicit operational decision. Preserve the old database until recovery is confirmed.

## Verification boundary

A passing unit test or image build does not prove DNS, cloud firewall, Neon TLS, Caddy certificate issuance, live AI credentials, or real-phone behavior. This repository preparation must be followed by deployment-specific smoke tests. Real account creation, cloud provisioning, domain/DNS changes, public deployment, production migration, production traffic, and paid registration require a separate explicit request and are outside this work.



