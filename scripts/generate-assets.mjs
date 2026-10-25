import fs from 'node:fs/promises';
import sharp from 'sharp';

// Mirlume native launcher art generated from our vector mark.
await fs.mkdir('assets', { recursive: true });
const svg = await fs.readFile('build/icon.svg');
const foreground = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 128 128"><path d="M24 91V51c0-11 8-19 19-19 9 0 15 4 19 11 4-7 11-11 20-11 11 0 19 8 19 19v40H87V53c0-4-3-7-7-7-6 0-10 4-10 11v34H56V53c0-4-3-7-7-7-6 0-10 4-10 11v34H24z" fill="#68d2b6"/><circle cx="106" cy="94" r="8" fill="#a9efdc"/></svg>';
await sharp(svg).resize(1024,1024).png().toFile('assets/icon-only.png');
await sharp(Buffer.from(foreground)).resize(1024,1024).png().toFile('assets/icon-foreground.png');
await sharp({create:{width:1024,height:1024,channels:4,background:'#10262e'}}).png().toFile('assets/icon-background.png');
const splashLogo=await sharp(svg).resize(780,780).png().toBuffer();
const splashBg={create:{width:2732,height:2732,channels:4,background:'#10262e'}};
await sharp(splashBg).composite([{input:splashLogo,left:976,top:976}]).png().toFile('assets/splash.png');
await sharp(splashBg).composite([{input:splashLogo,left:976,top:976}]).png().toFile('assets/splash-dark.png');
console.log('Mirlume icon and splash images generated.');
