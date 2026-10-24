import { ShieldCheck, UserPlus, Wallet } from 'lucide-react';
import SignInBox from './SignInBox';

type Props = { error: string };

const STEPS = [
  {
    icon: UserPlus,
    title: 'Request access',
    text: 'Sign in and enter your plot name, your name, phone number and house or unit number.',
  },
  {
    icon: ShieldCheck,
    title: 'Get approved',
    text: 'The landlord reviews your request, sets your rent and unlocks your private account.',
  },
  {
    icon: Wallet,
    title: 'Pay and track rent',
    text: 'Submit each rent payment and see when the landlord confirms it.',
  },
];

export default function Landing({ error }: Props) {
  return (
    <div className="mx-auto max-w-3xl">
      <section className="rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 px-6 py-12 text-white shadow-lg sm:px-10">
        <h1 className="text-3xl font-bold sm:text-4xl">
          Pay your rent from your own private account
        </h1>
        <p className="mt-3 max-w-xl text-emerald-50">
          Each tenant has a secure account that only they can see. Accounts are
          activated once the landlord approves the request.
        </p>
        <SignInBox outsideError={error} />
        <p className="mt-4 text-sm text-emerald-50">
          Landlord? Sign in and choose <span className="font-semibold">I'm a landlord</span> to apply for an account.
        </p>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <div
            key={step.title}
            className="rounded-xl border border-slate-200 bg-white p-5"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <step.icon className="h-5 w-5" />
            </div>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Step {i + 1}
            </p>
            <h2 className="mt-1 font-semibold">{step.title}</h2>
            <p className="mt-1 text-sm text-slate-600">{step.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
