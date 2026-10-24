// Every /api/... request from the website is handled here.
import type { Config } from '@netlify/functions';
import { handler } from '../../backend/index';

export default async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
    });
    let body: unknown = {};
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        const raw = await req.text();
        if (raw) {
            try {
                body = JSON.parse(raw);
            } catch {
                body = raw;
            }
        }
    }
    const result = await handler({
        method: req.method.toUpperCase(),
        rawPath: url.pathname,
        headers,
        query: Object.fromEntries(url.searchParams.entries()),
        body,
    });
    return new Response(result.body, { status: result.statusCode, headers: result.headers });
};

export const config: Config = { path: '/api/*' };
