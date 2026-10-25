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
console.log('iOS writer files copied. Add both Swift files to App target in Xcode.');
console.log('Set UIFileSharingEnabled and LSSupportsOpeningDocumentsInPlace to YES in Info.plist.');
