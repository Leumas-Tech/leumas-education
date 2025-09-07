import fs from 'fs';
import path from 'path';

const DATA_ROOT = process.env.DATA_ROOT || './data';
const ATLAS_ROOT = process.env.ATLAS_ROOT || './atlas_out';

await fs.promises.mkdir(path.join(DATA_ROOT, 'tasks'), { recursive: true });
await fs.promises.mkdir(path.join(DATA_ROOT, 'proofs'), { recursive: true });
await fs.promises.mkdir(path.join(DATA_ROOT, 'chats'), { recursive: true });
await fs.promises.mkdir(ATLAS_ROOT, { recursive: true });

console.log('Seeded folders.');
