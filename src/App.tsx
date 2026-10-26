import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { api, auth } from './platform/client';
import { AlertCircle, Ban, Building2, Loader2, LogOut } from 'lucide-react';
import Landing from './components/Landing';
import type { Me } from './types';
import { errorMessage } from './util';

// After an update, an old open tab may ask for files that no longer exist. Reload once to fetch the new version.
function reloadOnce(): Promise<never> {
  try {
    if (!sessionStorage.getItem('rp-reloaded')) {
      sessionStorage.setItem('rp-reloaded', '1');
      window.location.reload();
    }
  } catch {
    window.location.reload();
  }
  return new Promise<never>(() => {});
}

const TenantView = lazy(() => import('./components/TenantView').catch(reloadOnce));
const AdminView = lazy(() => import('./components/AdminView').catch(reloadOnce));
const OwnerView = lazy(() => import('./components/OwnerView').catch(reloadOnce));

function Spinner() {
  return (
    <div className="flex justify-center py-24">
      <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
    </div>
  );
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Site owner',
  manager: 'Site manager',
  manager_paused: 'Access paused',
  landlord: 'Landlord',
  caretaker: 'Caretaker',
  suspended: 'Account paused',
  tenant: 'Tenant rent payments',
};

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadMe = useCallback(async () => {
    try {
      const res = await api.get('/api/me');
      setMe(res.data as Me);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.removeItem('rp-reloaded');
    } catch {
      // storage unavailable
    }
    let active = true;
    const refresh = async () => {
      if (auth.isSignedIn()) {
        await loadMe();
      } else {
        setMe(null);
      }
      if (active) {
        setLoading(false);
      }
    };
    auth
      .ready()
      .catch((e) => setError(errorMessage(e)))
      .then(refresh);
    const off = auth.onChange(() => {
      auth.ready().then(refresh, refresh);
    });
    return () => {
      active = false;
      off();
    };
  }, [loadMe]);

  async function handleSignOut() {
    await auth.signOut();
    setMe(null);
    setError('');
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold leading-tight">Rent Portal</p>
              <p className="text-xs text-slate-500">{ROLE_LABELS[me?.role ?? 'tenant']}</p>
            </div>
          </div>
          {me && (
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-slate-600 sm:inline">{me.email}</span>
              <button
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        {me && error && (
          <p role="alert" className="mb-4 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}
        {loading ? (
          <Spinner />
        ) : !me ? (
          <Landing error={error} />
        ) : me.role === 'manager_paused' ? (
          <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-600">
              <Ban className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-xl font-bold">Your site manager access is paused</h1>
            <p className="mt-2 text-sm text-slate-600">The site owner has temporarily paused your access. Please contact the site owner to restore it.</p>
          </div>
        ) : me.role === 'suspended' ? (
          <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-600">
              <Ban className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-xl font-bold">This landlord account is paused</h1>
            <p className="mt-2 text-sm text-slate-600">
              The site owner has temporarily paused access for this landlord account. Please contact the site owner to restore it.
            </p>
          </div>
        ) : (
          <Suspense fallback={<Spinner />}>
            {me.role === 'owner' || me.role === 'manager' ? (
              <OwnerView isMainOwner={me.role === 'owner'} />
            ) : me.isAdmin ? (
              <AdminView role={me.role === 'landlord' ? 'landlord' : 'caretaker'} />
            ) : (
              <TenantView me={me} onRefresh={loadMe} />
            )}
          </Suspense>
        )}
      </main>
    </div>
  );
}

export default App;
