import {mkdir,copyFile} from 'node:fs/promises';
const target='android/app/src/main/java/io/mirlume/chat';
await mkdir(target,{recursive:true});
await copyFile('native/android/MainActivity.java',target+'/MainActivity.java');
await copyFile('native/android/MirlumeFileWriter.java',target+'/MirlumeFileWriter.java');
console.log('Android native streaming receiver installed.');
