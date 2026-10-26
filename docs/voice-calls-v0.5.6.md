# Mirlume 0.5.6 — test private voice calls

This is an initial **one-to-one audio calling beta**, not a Discord-equivalent group voice service.

## Required Supabase setup (once)

1. Open your Supabase project SQL Editor.
2. Run [voice-calls-v0.5.6.sql](../supabase/voice-calls-v0.5.6.sql).
3. This creates an RLS-protected `mirlume_call_signals` table for exchanging WebRTC connection setup information. **Call audio is not stored by Supabase.**

## How to test on Windows and iPhone

1. Install **Mirlume Setup 0.5.5.exe** from a successful Actions build if you want to test the updater from 0.5.5. **Do not use the portable EXE** for this test; electron-updater supports the installed NSIS version.
2. Sign in as two different users on two devices. Both should have a DM conversation.
3. In the DM, press the **phone** button in the upper right. Grant microphone access.
4. The other user receives an incoming-call panel even while viewing a server. Press **Answer**, and grant microphone access.
5. Check two-way sound, microphone mute/unmute, and **End**. A declined call should also close the caller's panel.
6. Keep v0.5.5 installed, then publish v0.5.6 as a GitHub Release containing its NSIS installer and `latest.yml`. The 0.5.5 app checks for updates at startup (after about 15 seconds) and hourly. After downloading, it installs on exit.

## Limitations and safety

- **TURN not yet configured.** Public Google STUN is used for peer discovery. Calls can fail behind symmetric NATs, restricted business networks, carrier-grade NAT or blocked UDP. Reliable worldwide calls will need a TURN relay with private short-lived credentials.
- iOS microphone permission / Capacitor native microphone entitlements still need on-device verification. Windows is the initial supported test target.
- Calls need both participants online and the app open; there is no native background incoming-call notification on iOS.
- WebRTC encrypts media in transit by default. Call setup (SDP/ICE) is stored in Supabase under RLS and can contain device/network addresses. Clean old rows periodically (example cleanup query is in the SQL file).
- Only build and install executables you trust. Windows binaries are not code-signed yet and may trigger SmartScreen warnings.
- GitHub Actions artifacts are not auto-update releases. The release must be **published** (not draft) and include `latest.yml`.
- When testing auto-update, use the **installed NSIS** Mirlume v0.5.5 app rather than a portable EXE.
