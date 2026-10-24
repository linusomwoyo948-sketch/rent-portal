// Runs the app's server (backend/index.ts) on your own computer at http://localhost:8787.
// The website (npm run dev) forwards every /api request here.

import { createServer } from 'node:http';
import { handler, dailyBills } from '../backend/index';

const PORT = 8787;

createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
        const url = new URL(req.url || '/', 'http://localhost');
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: unknown = raw;
        if (raw) {
            try {
                body = JSON.parse(raw);
            } catch {
                // keep as text
            }
        } else {
            body = {};
        }
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(req.headers)) {
            headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
        }
        const result = await handler({
            method: (req.method || 'GET').toUpperCase(),
            rawPath: url.pathname,
            headers,
            query: Object.fromEntries(url.searchParams.entries()),
            body,
        });
        res.writeHead(result.statusCode, result.headers);
        res.end(result.body);
        const tag = result.statusCode >= 400 ? '  <-- ' + result.statusCode : '';
        console.log(req.method + ' ' + url.pathname + tag);
    });
}).listen(PORT, () => {
    console.log('Rent Portal local server running at http://localhost:' + PORT);
    console.log('Data is saved in local-data.json. Delete that file to start again from empty.');
});

// The live site creates monthly bills at 00:10 every night. Locally this runs at start-up and every hour.
const runBills = () => {
    dailyBills().catch((e: unknown) => console.error('Billing run failed', e));
};
setTimeout(runBills, 2000);
setInterval(runBills, 60 * 60 * 1000);
