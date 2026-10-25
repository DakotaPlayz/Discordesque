# Discordesque

A private, Discord-inspired chat application for **Windows, Android and iOS**. One responsive React/Vite frontend; **Electron** wraps the Windows desktop application and **Capacitor** wraps the Android/iOS applications. **Supabase Auth + Postgres + Realtime** supply a shared backend.

## What works in v0.1 source

- Email/password sign up and sign in
- Create private groups ("servers") and join with an invite code
- Server member authorization with PostgreSQL row-level security
- Create and switch text channels; live messaging and recent history
- Profile display names
- Responsive Windows/tablet/phone interface
- Windows portable EXE / installer and Android debug APK build workflows

Not in v0.1: voice calls, screen share, push notifications, attachments, moderation, end-to-end encryption. Messages are encrypted in transit but **not end-to-end encrypted**; your Supabase database administrators can access stored messages.

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

