import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { version as installedVersion } from '../../package.json';
import { newerVersion } from '../lib/versionCheck.js';

const RELEASE_API = 'https://api.github.com/repos/DakotaPlayz/Discordesque/releases/latest';
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

export default function AndroidUpdateNotice() {
  const [update, setUpdate] = useState(null);
  const [error, setError] = useState('');
  const dismissed = useRef(null);
  const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

  useEffect(() => {
    if (!isAndroid) return;
    let alive = true;
    const check = async () => {
      try {
        const response = await fetch(RELEASE_API, {
          cache: 'no-store', headers: { Accept: 'application/vnd.github+json' }
        });
        if (!response.ok) throw new Error('Release check HTTP ' + response.status);
        const release = await response.json();
        const apk = (release.assets || []).find(asset =>
          /^Mirlume-Android-[\d.]+\.apk$/i.test(asset.name || '') &&
          /^https:\/\/github\.com\/DakotaPlayz\/Discordesque\/releases\/download\//.test(asset.browser_download_url || ''));
        if (alive) {
          if (release.draft !== true && newerVersion(release.tag_name, installedVersion)
              && apk && release.html_url?.startsWith('https://github.com/DakotaPlayz/Discordesque/releases/')) {
            setUpdate(dismissed.current === release.tag_name ? null : {
              version: release.tag_name, url: release.html_url
            });
          } else setUpdate(null);
        }
      } catch (err) {
        // No update should be asserted unless the release manifest is reachable.
        console.warn('Android update check unavailable:', err);
      }
    };
    void check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    const onResume = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onResume);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, [isAndroid]);

  if (!isAndroid || !update) return null;
  return <section className="android-update-banner" role="alert" aria-label="Mirlume Android update available">
    <div className="android-update-header">
      <strong>Mirlume {update.version} is available</strong>
      <button type="button" aria-label="Remind me later" onClick={() => {
        dismissed.current = update.version;
        setUpdate(null);
      }}>×</button>
    </div>
    <p>You're running v{installedVersion}. To update, open the release page, download the Android APK, and approve the installation when Android asks. Mirlume cannot silently install APK updates.</p>
    <p className="android-update-warning">These test APKs use a debug signing key that may change between builds. If Android says the app can't be installed, you may need to uninstall the old debug app first, which can erase local app data. Don't uninstall without saving anything you need.</p>
    {error && <p role="alert">{error}</p>}
    <div className="android-update-actions">
      <button type="button" className="secondary-button" onClick={() => {
        dismissed.current = update.version; setUpdate(null);
      }}>Later</button>
      <button type="button" className="primary-button" onClick={async () => {
        try { setError(''); await Browser.open({ url: update.url }); }
        catch (err) { setError('Could not open the download page: ' + (err?.message || String(err))); }
      }}>Get Android update</button>
    </div>
  </section>;
}
