import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
const target='android/app/src/main/java/io/mirlume/chat';
await mkdir(target,{recursive:true});
await copyFile('native/android/MainActivity.java',target+'/MainActivity.java');
await copyFile('native/android/MirlumeFileWriter.java',target+'/MirlumeFileWriter.java');
console.log('Android native streaming receiver installed.');

const manifestFile = 'android/app/src/main/AndroidManifest.xml';
let manifest = await readFile(manifestFile, 'utf8');
const previousManifest = manifest;
// Android WebRTC needs both permissions, including when the user has already
// granted microphone access in Android Settings.
for (const permission of ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS']) {
  if (manifest.includes(permission)) continue;
  if (!manifest.includes('<application')) throw new Error('Unexpected generated Android manifest');
  manifest = manifest.replace('<application', '<uses-permission android:name="' + permission + '" />\n    <application');
}
if (manifest !== previousManifest) await writeFile(manifestFile, manifest);
console.log('Android microphone permissions configured.');
