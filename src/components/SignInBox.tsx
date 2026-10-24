import { useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { auth, googleSignInEnabled, isLocalMode } from '../platform/client';
import { errorMessage } from '../util';

// Sign-in without pop-ups: Google opens in the same tab, or a sign-in link is emailed.
export default function SignInBox({ outsideError }: { outsideError: string }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<'' | 'google' | 'email'>('');
  const [sentTo, setSentTo] = useState('');
  const [err, setErr] = useState('');

  async function google() {
    setErr('');
    setBusy('google');
    try {
      await auth.signInWithGoogle();
    } catch (e) {
      setErr(errorMessage(e));
      setBusy('');
    }
  }

  async function byEmail(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setErr('Please enter a valid email address.');
      return;
    }
    setBusy('email');
    try {
      const r = await auth.signInWithEmail(value);
      if (r === 'sent') {
        setSentTo(value);
      }
    } catch (e2) {
      const msg = errorMessage(e2);
      setErr(/rate|seconds/i.test(msg) ? 'Too many sign-in emails were requested. Please wait a minute and try again.' : msg);
    } finally {
      setBusy('');
    }
  }

  if (sentTo) {
    return (
      <div className="mt-8 rounded-xl bg-white p-5 text-slate-800 shadow">
        <p className="flex items-center gap-2 font-semibold">
          <Mail className="h-5 w-5 text-emerald-600" />
          Check your email
        </p>
        <p className="mt-2 text-sm text-slate-600">
          We sent a sign-in link to <span className="font-medium">{sentTo}</span>. Open it on this device to sign in. It can take a minute to arrive; check your spam folder too.
        </p>
        <button onClick={() => setSentTo('')} className="mt-3 text-sm font-medium text-emerald-700 hover:underline">
          Use a different email
        </button>
      </div>
    );
  }

  const shownError = err || outsideError;

  return (
    <div className="mt-8 max-w-md rounded-xl bg-white p-5 text-slate-800 shadow">
      {googleSignInEnabled && (
        <>
          <button
            onClick={google}
            disabled={!!busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-medium hover:bg-slate-50 disabled:opacity-70"
          >
            {busy === 'google' ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="font-bold text-blue-600">G</span>}
            Continue with Google
          </button>
          <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            or
            <span className="h-px flex-1 bg-slate-200" />
          </div>
        </>
      )}
      <form onSubmit={byEmail} noValidate>
        <label htmlFor="signin-email" className="text-sm font-medium">
          Email address
        </label>
        <input
          id="signin-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
        />
        <button
          type="submit"
          disabled={!!busy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-70"
        >
          {busy === 'email' && <Loader2 className="h-4 w-4 animate-spin" />}
          {isLocalMode ? 'Sign in (test mode)' : 'Email me a sign-in link'}
        </button>
      </form>
      {isLocalMode && <p className="mt-2 text-xs text-slate-500">Test mode: any email signs in straight away. The site owner is linusomwoyo96@gmail.com.</p>}
      {shownError && (
        <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {shownError}
        </p>
      )}
    </div>
  );
}
