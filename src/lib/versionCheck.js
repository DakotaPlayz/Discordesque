// Only three-part numeric release versions are supported for Android APK notices.
export function newerVersion(remote, local) {
  const matchRemote = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(remote || ''));
  const matchLocal = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(local || ''));
  if (!matchRemote || !matchLocal) return false;
  for (let i = 1; i <= 3; i++) {
    const left = Number(matchRemote[i]), right = Number(matchLocal[i]);
    if (left > right) return true;
    if (left < right) return false;
  }
  return false;
}
