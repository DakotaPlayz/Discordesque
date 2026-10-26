import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
const target='android/app/src/main/java/io/mirlume/chat';
await mkdir(target,{recursive:true});
await copyFile('native/android/MainActivity.java',target+'/MainActivity.java');
await copyFile('native/android/MirlumeFileWriter.java',target+'/MirlumeFileWriter.java');
console.log('Android native streaming receiver installed.');

const manifestFile = 'android/app/src/main/AndroidManifest.xml';
let manifest = await readFile(manifestFile, 'utf8');
// Android WebRTC microphone capture needs an app-level runtime permission.
// The user must still explicitly grant the microphone in Android's OS prompt.
if (!manifest.includes('android.permission.RECORD_AUDIO')) {
  if (!manifest.includes('<application')) throw new Error('Unexpected generated Android manifest');
  manifest = manifest.replace('<application', '<uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <application');
  await writeFile(manifestFile, manifest);
}
console.log('Android microphone permission configured for voice calling.');
