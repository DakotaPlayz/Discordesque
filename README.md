# Mirlume (formerly Discordesque)

An independently branded, private cross-platform chat application for **Windows, Android and iOS**. One responsive React/Vite frontend; **Electron** wraps the Windows desktop application and **Capacitor** wraps the Android/iOS applications. **Supabase Auth + Postgres + Realtime** supply a shared backend.

## What works in v0.1 source

- Email/password sign up and sign in
- Create private groups ("servers") and join with an invite code
- Server member authorization with PostgreSQL row-level security
- Create and switch text channels; live messaging and recent history
- Profile display names
- Responsive Windows/tablet/phone interface
- Windows portable EXE / installer and Android debug APK build workflows

Not in v0.2: voice calls, screen share, push notifications, offline/cloud attachments, resumable transfers, moderation, end-to-end chat encryption. Messages are encrypted in transit but **not end-to-end encrypted**; your Supabase database administrators can access stored messages.

## Configure once

1. Make a free project at https://supabase.com/dashboard.
2. In **SQL Editor**, run the entire file `supabase/schema.sql` once. It creates tables, secure functions and policies and enables Realtime publication for messages.
3. From **Project Settings → API Keys**, find the **Project URL** and the **publishable key** (legacy `anon` key is also supported). Do **not** use the secret/service_role key.
4. To run locally, copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. To bake the same configuration into GitHub Actions builds for your friends, add **repository variables** (Settings → Secrets and variables → Actions → Variables) named `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. These keys are designed to be public; RLS is the actual authorization barrier.

For simplest registration testing, in Supabase **Authentication → Providers → Email**, you can adjust email confirmation requirements. For real use, keep confirmation enabled. Friends just register with their email/password, then join using the invite code you share privately; they do not need developer accounts.

## First build after adding GitHub variables

Both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must exist as **repository variables before a build runs**. If you just saved the variables, start a new build rather than downloading an older artifact. Open [GitHub Actions](https://github.com/DakotaPlayz/Discordesque/actions) and choose **Build Windows** or **Build Android** → **Run workflow** → **Run workflow**. Builds also start automatically when a change is pushed to `main`.

In each completed run, open **Artifacts** to download the Windows EXE package or Android debug APK. Check the logs if a workflow is red; an artifact should not be assumed until GitHub reports that it built successfully.

## Mirlume v0.4 — two intentionally different kinds of attachments

**Server channels: persistent files up to 50 MB (50,000,000 bytes)**

- Click the paperclip-style upload icon beside a server channel's message field.
- Files are stored in the existing Supabase project's private Storage bucket and appear as downloadable entries in that channel, including after the sender goes offline.
- Uploads use TUS in 6 MiB chunks, with progress and retry handling. Access is enforced through Storage RLS and channel membership; files never receive permanent public URLs. Each download uses a 2-minute URL for signed-in authorized members.
- The Supabase Free plan supports a maximum **50 MB per file**, but only **1 GB total file storage**, plus bandwidth limits. It is not unlimited hosting. Members should not upload copyrighted or unsafe files they lack permission to distribute.

**Direct messages: peer-to-peer files up to 20 GiB (21,474,836,480 bytes)**

- Open a DM and use the file-transfer paperclip. Choose a file and keep the app running. The recipient accepts and selects a save location; transfer bytes flow over a WebRTC data channel, not Supabase Storage.
- Large incoming files are streamed to disk on **Windows**. Supported browsers with the File System Access save picker can also receive large files. Android/iOS receivers currently fall back to a **32 MiB** memory-backed limit until native disk writers are built. 20 GiB does **not** mean all device pairs are tested.
- Transfers require both users online, and some NAT/firewall combinations require a TURN relay, which is **not configured by default**. Transfers are not resumable after disconnecting. The WebRTC connection encrypts transport, but file metadata (names and sizes) is stored in Supabase.
- DM attachments are not stored in Supabase, so they cannot be downloaded later while the sender is offline.

### Required one-time Supabase migration

**Run `supabase/attachments-v0.4.sql` in the SQL Editor for your current project.** This requires the original `schema.sql`, `direct-messages.sql`, and `file-sharing.sql` migrations to be applied first. The v0.4 script creates the private channel-file bucket and policies, channel attachment metadata, and adds DM support to existing file-transfer signaling without deleting chat data. Run the new script once and verify it reports success. Do not re-run the earlier original migrations.

If the migration is missing, uploads and DM file offers will fail with database/RLS errors. The Windows, Android and GitHub Pages site all use the same Supabase account and schema. No new app API keys are needed.

### Product identity

**Mirlume** has its own icon, teal/charcoal visual language, component layout and typography; no Discord logos, icons or product trade dress are included intentionally. However, appearance and working-name differences alone are *not* legal clearance. Before commercial or broad public distribution, check the United States Patent and Trademark Office trademark search and relevant international marks, store listings, and domains, or seek professional IP advice. The GitHub repository URL is unchanged to avoid breaking Supabase email-confirmation links and existing shared links.

## v0.3: new identity, DMs, and interface

**User-facing name:** Mirlume. This name is a working brand candidate, *not* a registered or trademark-cleared mark. Before distributing publicly or commercially, check the USPTO trademark search and relevant app-store/domain listings, or ask a trademark attorney to check it. The GitHub repository remains `DakotaPlayz/Discordesque` for now to preserve existing Supabase email-confirmation URLs and old source links. The app's Windows product title, icon, window text, browser title, Android/iOS display name, and package identifiers have changed.

**A new Android application ID (`io.mirlume.chat`) means v0.3 installs separately from v0.2.** You can uninstall the old Android app after verifying the new one. This does **not** erase your shared Supabase account, servers or messages, but any unsent drafts or device-only data in the old app will not transfer. On Windows v0.3 has a new program name as well.

### Enable private messages (one-time database update)

1. Open your **existing** Supabase project's SQL Editor.
2. Run the complete file **[supabase/direct-messages.sql](supabase/direct-messages.sql)** once.
3. Install the v0.3 Android APK or Windows EXE, or launch the latest website build.
4. Click the Mirlume logo at the top of the server rail to open **Direct Messages**. Click **New message**, choose someone from a server you both belong to, and start chatting.

Direct messages are stored in Supabase and synchronized across devices. Only conversation participants may read or write the messages (Postgres RLS). New DMs require a shared server membership; existing conversations remain accessible after a user leaves a server. This is transport-encrypted but **not end-to-end encrypted**: the Supabase database administrators can access message content. Currently DMs are text-only; large file transfers remain available in server channels.

### Visual and usability changes

- New original mark and dark slate/mint identity, redesigned desktop and mobile styles, refined server rail and channel/sidebar hierarchy
- Dedicated messages list, new-conversation picker, friend search, and realtime one-to-one text chat
- **Profile editing bug fixed:** typing a display name no longer causes the dialog to steal keyboard focus after each keystroke
- Retains private servers, channels, live chat, invites and experimental peer-to-peer attachments

## Free verification website (GitHub Pages)

**Website:** https://dakotaplayz.github.io/Discordesque/

This is the same responsive Discordesque app, accessible in a web browser, with an additional email confirmation success/error page. No hosting subscription, domain purchase or new server is required for a public GitHub repository.

### One-time GitHub Pages setting

1. Open https://github.com/DakotaPlayz/Discordesque/settings/pages.
2. Under **Build and deployment → Source**, choose **GitHub Actions** (not "Deploy from a branch").
3. The included `Publish Discordesque Website` workflow automatically deploys on every push to `main`. If the first run failed because Pages was not enabled, manually re-run that workflow in https://github.com/DakotaPlayz/Discordesque/actions.
4. Verify that https://dakotaplayz.github.io/Discordesque/ loads.

### One-time Supabase email redirect setting (important)

In the existing Supabase project, open **Authentication → URL Configuration** and set:

- **Site URL:** `https://dakotaplayz.github.io/Discordesque/`
- **Redirect URLs:** add `https://dakotaplayz.github.io/Discordesque/?confirmed=1`

Save changes. The client sends new confirmation emails to that exact URL via `emailRedirectTo`. Without the allowlisted Redirect URL, Supabase may not send users to the intended confirmation page. <https://supabase.com/docs/guides/auth/redirect-urls>

With **Confirm email** enabled, new users register on Windows, Android, iOS or the web, click the verification email, see a success message in their browser, and then sign in normally in their original app. No native deep-link setup is needed. Existing emails already sent may use the old redirect URL and are not retroactively changed.

**Note:** Hosting GitHub Pages is free for this public repository. Supabase's own email sending limits still apply and may require custom SMTP as usage grows.

## Historical v0.2 file transfer notes (superseded for server channels)

**Do this before testing:** in Supabase's SQL Editor, run the *new* file [supabase/file-sharing.sql](supabase/file-sharing.sql) **once**. Do not re-run the original schema. The SQL adds two private tables, member-only offer policies and WebRTC signal listeners. It stores transfer *metadata* only, never file contents.

In the app, open a text channel and press the **paperclip** next to the message input. Choose a friend and select the file; your friend must stay in that channel, open the paperclip panel and press **Accept**. The receiver selects a save location, then the sender streams directly to them while both remain connected. You can monitor progress and cancel the transfer.

| Capability | Initial v0.2 support |
| --- | --- |
| Windows EXE → Windows EXE | **Up to 20 GiB**, streamed directly to disk via the Electron bridge |
| Browser with a compatible streaming file-save picker | **Up to 20 GiB**; feature-detected |
| Android / iOS native receiver | **Up to 32 MiB fallback only**, until native file streaming is implemented |
| Android / iOS sender | Can select a file up to 20 GiB when device picker supports it and sender remains foregrounded; large mobile transfers are **not yet certified** |
| Stored offline attachments | Not supported; sender must remain online |
| Automatic resume after disconnect | Not supported (start again) |
| Connectivity | Uses a free STUN server; some NAT/firewalls require paid/self-hosted TURN, so **not all connections work** |

For security, RLS checks both participants against server membership; offers and signaling are visible only to the sender and receiver. WebRTC DataChannels provide transport encryption. File names and transfer sizes are stored in Supabase for signaling. Receivers must explicitly accept and choose a destination. The application cannot scan shared files for malware; only accept files from people you trust.

This is an **experimental** file-sharing release: validate with a small test file first, then gradually try larger ones, and ensure the recipient has enough free space. Do **not** rely on it yet for critical files without checking the results.

## Local development (Node.js 22+)

~~~sh
npm install
npm run dev
~~~

Visit the local URL shown by Vite. If Supabase isn't configured yet, a setup screen tells you what's missing.

## Windows desktop

~~~sh
npm install
npm run desktop
# produce an unsigned Windows portable EXE and an installer on a Windows PC:
npm run dist:win
~~~

On **GitHub → Actions → Build Windows**, use *Run workflow*. Download the build artifact. An unsigned EXE can trigger Windows SmartScreen; only run builds from your own repository. GitHub Actions builds are also triggered on pushes to main.

## Android

~~~sh
npm install
npm run build
npx cap add android
npx cap sync android
npx cap open android
~~~

Build/run with Android Studio, or download the installable **debug APK** from **Actions → Build Android** in your repository. Updates to app code require `npm run build && npx cap sync android`.

## iOS

You need a Mac running Xcode plus Apple code signing for device distribution. Run:

~~~sh
npm install
npm run build
npx cap add ios
npx cap sync ios
npx cap open ios
~~~

Use the Xcode project to run on Simulator or sign for a device. iOS IPA distribution/TestFlight requires an Apple developer setup; GitHub cannot provide a universally installable unsigned iOS app.

## Privacy and deployment notes

Supabase's free tier is useful for a small friends-only deployment, subject to its limits and project pausing policies. **Never** put a Supabase service-role/secret key in the client or in Vite variables. Client-side keys are intentionally visible. The security controls are server-side Postgres RLS + restricted RPC functions. Users outside a server cannot read its channels or messages. Invite codes grant membership to anyone who has one: share them only privately. Don't use this as production-critical secure messaging without review, abuse protections, backups and load testing.

## Build organization

- `src/App.jsx`: interactive React client
- `src/styles.css`: adaptive mobile/desktop styles
- `src/lib/supabase.js`: API client initialized from build environment
- `electron/main.cjs`: sandboxed Windows window
- `capacitor.config.json`: mobile wrapper app identity
- `supabase/schema.sql`: schema and RLS
- `.github/workflows/`: Windows and Android builds

