// Website side of the platform: sign-in (Supabase), calls to /api, and phone alerts.
// Without VITE_SUPABASE_URL (npm run local) it uses a test sign-in where you type any email.

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const isLocalMode = !SUPABASE_URL || !SUPABASE_KEY;
export const googleSignInEnabled = !isLocalMode && import.meta.env.VITE_GOOGLE_SIGNIN !== 'off';

const sb: SupabaseClient | null = isLocalMode
    ? null
    : createClient(SUPABASE_URL!, SUPABASE_KEY!, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
      });

const LOCAL_KEY = 'rent-portal-local-email';

function localEmail(): string {
    try {
        return localStorage.getItem(LOCAL_KEY) || '';
    } catch {
        return '';
    }
}

let session: Session | null = null;
let readyPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

if (sb) {
    sb.auth.onAuthStateChange((event, s) => {
        session = s;
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
            setTimeout(() => listeners.forEach((fn) => fn()), 0);
        }
    });
}

async function token(): Promise<string | null> {
    if (isLocalMode) {
        const e = localEmail();
        return e ? 'local:' + encodeURIComponent(e) : null;
    }
    const { data } = await sb!.auth.getSession();
    session = data.session;
    return session?.access_token ?? null;
}

type ApiError = Error & { response?: { status: number; data: unknown } };

async function call(method: string, url: string, data?: unknown): Promise<{ data: any }> {
    const headers: Record<string, string> = {};
    const t = await token();
    if (t) {
        headers.Authorization = 'Bearer ' + t;
    }
    let body: string | undefined;
    if (data !== undefined && method !== 'GET') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(data);
    }
    const res = await fetch(url, { method, headers, body });
    const text = await res.text();
    let parsed: unknown = text;
    try {
        parsed = text ? JSON.parse(text) : {};
    } catch {
        // not JSON
    }
    if (!res.ok) {
        const msg = (parsed as { error?: string })?.error || 'Request failed (' + res.status + ')';
        const err = new Error(msg) as ApiError;
        err.response = { status: res.status, data: parsed };
        throw err;
    }
    return { data: parsed };
}

export const api = {
    get: (url: string) => call('GET', url),
    post: (url: string, data?: unknown) => call('POST', url, data ?? {}),
    put: (url: string, data?: unknown) => call('PUT', url, data ?? {}),
    delete: (url: string, data?: unknown) => call('DELETE', url, data),
};

function homeUrl(): string {
    return window.location.origin + '/';
}

export const auth = {
    // Finishes a sign-in that is coming back from Google or an email link.
    ready(): Promise<void> {
        if (!readyPromise) {
            readyPromise = (async () => {
                if (sb) {
                    const { data } = await sb.auth.getSession();
                    session = data.session;
                    const u = new URL(window.location.href);
                    if (u.searchParams.has('code') || u.hash.includes('access_token') || u.searchParams.has('error_description')) {
                        const err = u.searchParams.get('error_description');
                        window.history.replaceState(null, '', u.pathname);
                        if (err && !session) {
                            throw new Error(err);
                        }
                    }
                }
            })();
        }
        return readyPromise;
    },
    isSignedIn(): boolean {
        return isLocalMode ? !!localEmail() : !!session;
    },
    onChange(fn: () => void): () => void {
        listeners.add(fn);
        return () => listeners.delete(fn);
    },
    // Goes to Google in the same tab (no pop-up), then comes back signed in.
    async signInWithGoogle(): Promise<void> {
        const { error } = await sb!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: homeUrl() } });
        if (error) {
            throw error;
        }
    },
    // Sends a sign-in link to the email address. Locally, signs in straight away.
    async signInWithEmail(email: string): Promise<'sent' | 'signed-in'> {
        const clean = email.trim().toLowerCase();
        if (isLocalMode) {
            try {
                localStorage.setItem(LOCAL_KEY, clean);
            } catch {
                // storage unavailable
            }
            listeners.forEach((fn) => fn());
            return 'signed-in';
        }
        const { error } = await sb!.auth.signInWithOtp({ email: clean, options: { emailRedirectTo: homeUrl(), shouldCreateUser: true } });
        if (error) {
            throw error;
        }
        return 'sent';
    },
    async signOut(): Promise<void> {
        if (isLocalMode) {
            try {
                localStorage.removeItem(LOCAL_KEY);
            } catch {
                // storage unavailable
            }
            return;
        }
        await sb!.auth.signOut();
        session = null;
    },
};

function base64ToBytes(b64: string): Uint8Array {
    const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
        out[i] = s.charCodeAt(i);
    }
    return out;
}

export const notifications = {
    // Asks permission and registers this device for phone alerts.
    async subscribe(): Promise<{ ok: true }> {
        if (isLocalMode) {
            console.info('Phone alerts are printed in the server terminal when running locally.');
            return { ok: true };
        }
        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
            throw new Error('This browser does not support alerts. On iPhone, add the site to your Home Screen first.');
        }
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            throw new Error('Alerts were not allowed. Allow notifications for this site in your browser settings.');
        }
        const reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        const { data } = await api.get('/api/push/key');
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(data.publicKey) as BufferSource });
        }
        await api.post('/api/push/subscribe', { subscription: sub.toJSON() });
        return { ok: true };
    },
};
