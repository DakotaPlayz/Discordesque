import {execFileSync} from 'node:child_process';
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
const folder='ios/App/App';
await mkdir(folder,{recursive:true});
await copyFile('native/ios/MirlumeFileWriterPlugin.swift',folder+'/MirlumeFileWriterPlugin.swift');
await copyFile('native/ios/MirlumeViewController.swift',folder+'/MirlumeViewController.swift');
const storyboard=folder+'/Base.lproj/Main.storyboard';
try {
  let xml=await readFile(storyboard,'utf8');
  xml=xml.replace('customClass="CAPBridgeViewController" customModule="Capacitor"',
    'customClass="MirlumeViewController" customModule="App"');
  await writeFile(storyboard,xml);
} catch(err){console.warn('Could not set custom controller in storyboard:',err.message);}
try {
  execFileSync('ruby', ['scripts/link-ios-target.rb'], {stdio:'inherit'});
} catch(err) {
  console.warn('Install the Ruby xcodeproj gem and re-run native:ios to link the Swift files:',err.message);
}
for (const key of ['UIFileSharingEnabled','LSSupportsOpeningDocumentsInPlace']) {
  try {execFileSync('/usr/libexec/PlistBuddy',['-c','Add :'+key+' bool YES','ios/App/App/Info.plist']);}
  catch {execFileSync('/usr/libexec/PlistBuddy',['-c','Set :'+key+' YES','ios/App/App/Info.plist']);}
}
console.log('Mirlume native iOS files configured for Files app access.');
