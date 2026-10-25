# Mirlume Attachment Server

This is a free-to-run **self-hosted** service, not free hardware or hosted capacity.
You need an always-on Windows/Linux/Mac computer with at least 500 GB free disk,
and an internet-reachable HTTPS endpoint (domain/reverse proxy) for outside users.

Unlike peer-to-peer transfers, uploaded files stay available **while the sender
is offline**, as long as THIS server is online. Files are purged after 1 day
by default; abandoned partial uploads after 12 hours.

## Setup

1. Install Node.js 22+ and put this directory on a machine with a dedicated
   storage disk (a spare old PC, mini PC, or existing always-on home computer).
2. Copy `.env.example` to `.env` and set your *existing* Supabase project
   URL and **publishable/anon** key. Never add a service-role key.
3. Set `MIRLUME_STORAGE_DIR` to the disk folder holding the files, for example
   `D:/MirlumeFiles`. Allocate at least 500 GB of free physical disk.
4. Run `npm install` then `npm start` inside `attachment-server`.
5. Visit `http://127.0.0.1:8799/health` on the server itself.
6. For remote access, set a publicly reachable **HTTPS** domain and reverse
   proxy (Caddy example included). Configure port forwarding/firewall safely;
   don't expose the plain HTTP port to the internet.
7. Under GitHub → Settings → Secrets and variables → Actions → Variables,
   create `VITE_ATTACHMENT_SERVER_URL=https://files.your-domain.example`
   (use your real HTTPS URL). Build website/Windows/Android again; all clients
   then use hosted offline DM file sharing.
   For local builds, set the same variable in root `.env`.

## Storage and permissions

- 500,000,000,000 bytes hard reservation limit, configurable with
  `MIRLUME_QUOTA_BYTES`; max **20 GiB per file**.
- Each upload streams in 8 MiB PUT chunks, supports retry from an authenticated
  status endpoint, and is readable only after all bytes arrive.
- Every request authenticates with Supabase Auth, and database RLS verifies the
  requester belongs to that DM. Never store user JWTs in server metadata.
- `GET /v1/conversations/:id/files` lists chat attachment cards.
- `GET /v1/files/:id` streams bytes with HTTP Range support.
- Cleanup runs on startup and every 15 minutes, deleting expired records/data.
- Storage availability depends on actual free space, the storage machine
  staying powered on, bandwidth, HTTPS/network reachability, and security.
- Do not use this as a public open file host without additional rate limiting,
  malware scanning, monitoring, backups and network hardening.

## Server-only: no database migration required

Unlike `supabase/offline-dm-files.sql`, this server stores its own file metadata
and bytes, and uses the existing Supabase DM authorization rules. You still
need the original `direct-messages.sql` migration for DMs to exist.

## API

- `POST /v1/files` JSON `{conversation_id,filename,size_bytes}`
- `PUT /v1/files/:id/data?offset=N` raw 1–8 MiB byte chunk
- `GET /v1/files/:id/status` uploader's progress
- `GET /v1/conversations/:id/files` private file cards
- `GET /v1/files/:id` secure streaming download
- `DELETE /v1/files/:id` sender's delete control

All API calls except `GET /health` require
`Authorization: Bearer <Supabase access token>`.
