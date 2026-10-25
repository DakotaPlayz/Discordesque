# Mirlume DM Cloud Storage — optional Cloudflare R2 backend

**No computer needs to remain on.** Cloudflare runs the HTTPS API and stores DM file bytes in R2. It uses your *existing* Supabase accounts and the same private conversation checks as Mirlume.

This is a **paid-after-free** service, not a promise of 500 GB for $0. R2 Standard currently offers **10 GB-month/month free**; beyond that storage starts around **$0.015/GB-month**, so 500 GB stored continuously costs approximately **$7.35/month** after the 10 GB free allowance, plus any operations charges after free thresholds. Because DM files expire after 24 hours, the actual storage bill depends on how many GB are present over time. Check [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) before connecting billing.

## Setup

1. Create a Cloudflare account; activate R2 and review its billing terms.
2. Install Node.js 22 and run `npx wrangler login` on your own computer **for setup only**.
3. From this directory, run `npx wrangler r2 bucket create mirlume-dm-files`.
4. Edit `wrangler.toml`: replace `SUPABASE_URL` with your existing project's URL. Keep `MIRLUME_ALLOWED_ORIGINS` restricted to Mirlume's origins.
5. Run `npx wrangler secret put SUPABASE_ANON_KEY`, and paste your **public/publishable** Supabase key (never the service_role secret).
6. Run `npx wrangler deploy`. Cloudflare will give you an HTTPS `*.workers.dev` endpoint.
7. Add GitHub Actions variable `VITE_ATTACHMENT_SERVER_URL` with that exact HTTPS URL under [Actions Variables](https://github.com/DakotaPlayz/Discordesque/settings/variables/actions).
8. Re-run the GitHub Pages, Windows and Android workflows so all builds use the hosted attachment server. GitHub Pages will auto-deploy after pushes to main but **changing a variable alone requires re-running a workflow**.

In Mirlume, your file upload is immediately associated with the current DM; once uploaded, the recipient sees a **Download** attachment button even when the original sender is offline. No recipient picker or acceptance dialog.

### Limits and expiry

- Maximum file size: **20 GiB**. Multipart uploads send 8 MiB chunks.
- Configured storage soft quota: 500,000,000,000 bytes (500 GB). This is not prepaid or reserved capacity. Concurrent reservations may briefly exceed that cap.
- **24-hour expiry:** downloads stop at the stored expiration timestamp; the scheduled Worker deletes expired objects every 15 minutes, and R2 also supports an optional 1-day lifecycle. Physical deletion may lag the 24-hour cutoff.
- Private-beta limitation: this sample Worker handles up to **40 retained file records** at once to fit Workers Free subrequest limits. A Durable Object/metadata index is needed for a production paid storage service, or for many small attachments.
- All stored files are encrypted by the provider at rest, but **not end-to-end encrypted**; anyone with permitted infrastructure access could access data. No malware scanning, checksum validation or antivirus is implemented.
- User authentication happens via the existing Supabase JWT. DM membership is rechecked through Supabase RLS before reading or uploading files.
- Each 20 GiB transfer still needs enough storage, upload bandwidth and time on the sender device. On mobile, leave the app in the foreground to avoid OS suspension.

### Safety before sharing with paying users

The current implementation is intended for a few trusted people, not a public commercial storage service. Add per-user quotas, rate limits, anti-malware policies, terms of service, a durable atomic quota coordinator and backups before charging users. Also check Cloudflare policies and prices.

If you prefer not to set up paid R2, the separate [self-hosted Node server](../README.md) remains available with a real 500 GB local drive. Both backends implement Mirlume's existing hosted attachment API.

### No extra Supabase SQL needed for hosted attachments

Hosted attachment metadata is stored inside the private R2 bucket and Supabase is consulted for membership. For menu settings, use [supabase/context-menus-v0.5.2.sql](../../supabase/context-menus-v0.5.2.sql) instead.
