import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const publicUrl = String(process.env.APP_PUBLIC_URL || '').trim();
if (!publicUrl) {
    throw new Error('APP_PUBLIC_URL is required to generate the static TonConnect manifest.');
}

const parsed = new URL(publicUrl);
if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error('APP_PUBLIC_URL must use HTTPS outside localhost.');
}

const appUrl = `${parsed.toString().replace(/\/$/, '')}/`;
const manifest = {
    url: appUrl,
    name: 'VORIX Wallet Beta',
    iconUrl: new URL('tonconnect-icon.png', appUrl).toString(),
};
const target = fileURLToPath(new URL('../public/tonconnect-manifest.json', import.meta.url));

fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote TonConnect manifest for ${appUrl}`);
