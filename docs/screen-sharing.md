# Mirlume screen sharing (first release)

Mirlume's private 1:1 voice calls can negotiate a video transceiver and attach a live screen track. Supabase stores only **call setup signaling**. Screen pixels are never uploaded to Supabase or Cloudflare R2.

## Sending a screen
- On Windows: join a voice call, choose **Share screen**, then explicitly choose a display or app window from Mirlume's native picker.
- In a supported desktop browser: join a voice call, choose **Share screen**, then choose a screen, window, or tab in the browser's own picker.
- A recipient running the updated Mirlume version can view the screen and expand it full screen, including on Android.
- Choose **Stop sharing**, use the capture indicator's Stop button, or end the call to stop sending immediately.
- Sharing **does not** yet broadcast desktop/system audio. The microphone call continues as before.
- Both peers need this release; older voice-call versions do not negotiate a reusable video transceiver.

## Capture quality
The app requests capture at the **selected display's native resolution and up to 60 FPS**. This is a *best-effort target*, not an FPS/quality guarantee. The WebRTC sender adapts delivery based on encoding hardware, receiver decoding, network bandwidth, and loss. The sender uses a generous 25 Mbps **maximum**, not a reserved bitrate or a required network speed. Highly dynamic 4K 60 FPS gaming may need more bandwidth and faster GPUs than 1080p 60 FPS.

Some displays, browser implementations, or OS capture paths report lower frame rates or logical (scaled) sizes. The UI shows the track's reported capture width/height/frame rate when available, not guaranteed receiver statistics.

## Network cost
The video travels directly between the two browsers/apps when ICE finds a peer-to-peer route. Google public STUN is used for discovery. A TURN relay is not configured, so restrictive networks may prevent voice and screen sharing from connecting; adding TURN later will incur bandwidth costs if the call is relayed.

## Android limitations
The current APK can **view** a friend's screen, but broadcasting Android's own screen is deliberately disabled. Android needs a native MediaProjection foreground-service/permission flow and a native-to-WebRTC video track bridge, which is a separate project. Screen recording must never begin without explicit Android system consent.
