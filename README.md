# Rent Portal

A rent collection website for many landlords. The site owner admits landlords, landlords create plots and approve tenants, and tenants paste their M-Pesa Paybill messages for the landlord to approve.

It runs on **Netlify** (the website and its server functions) with **Supabase** (sign-in and the database).

## What is in this folder

| Path | What it is |
| --- | --- |
| `src/` | The website (React). `src/platform/client.ts` handles sign-in, server calls and phone alerts |
| `backend/index.ts` | All the rules: who can see what, tenants, bills, payments, reports, backups |
| `server/platform.ts` | Connects the rules to Supabase (database and sign-in checks) and sends phone alerts |
| `netlify/functions/api.mts` | Runs `backend/index.ts` for every `/api/...` request |
| `netlify/functions/daily-bills.mts` | Creates monthly rent bills every night at 00:10 Nairobi time |
| `supabase/schema.sql` | The database setup to paste into Supabase once |
| `public/sw.js` | Shows phone alerts |
| `local/server.ts` | Test server for running everything on your own computer |
| `netlify.toml` | Netlify build settings and security headers |

## One-time setup

### 1. Supabase (database and sign-in)

1. Go to https://supabase.com, sign up with GitHub, click **New project**. Name it `rent-portal`, choose a strong database password (save it somewhere safe) and pick the region closest to Kenya that is offered (for example **Central EU (Frankfurt)** or **West EU**). Wait for it to finish.
2. Open **SQL Editor > New query**, paste the whole of `supabase/schema.sql`, click **Run**. It should say "Success".
3. Open **Project Settings > API Keys** and note:
   - the **Project URL** (looks like `https://abcd1234.supabase.co`, also shown under Project Settings > Data API),
   - the **Publishable key** (`sb_publishable_...`), safe to be public,
   - the **Secret key** (`sb_secret_...`), keep this private and only paste it into Netlify.
4. Open **Authentication > URL Configuration**:
   - **Site URL**: your Netlify address, for example `https://rentportal.netlify.app` (update it later if you add your own domain).
   - **Redirect URLs**: add the same address followed by `/**`, for example `https://rentportal.netlify.app/**`.

### 2. Google sign-in (recommended)

1. Go to https://console.cloud.google.com, create a project called Rent Portal.
2. **APIs & Services > OAuth consent screen**: choose External, app name "Rent Portal", your email as support and developer contact. Publish the app (status "In production") so anyone can sign in.
3. **APIs & Services > Credentials > Create credentials > OAuth client ID**: type "Web application". Under **Authorised redirect URIs** add `https://YOUR-PROJECT.supabase.co/auth/v1/callback` (your Supabase Project URL plus `/auth/v1/callback`). Create, then copy the Client ID and Client secret.
4. In Supabase, **Authentication > Sign In / Providers > Google**: turn it on, paste the Client ID and Client secret, save.

### 3. Email sign-in links

Supabase's built-in email sender only delivers to your own Supabase team members and is heavily limited, so tenants will not receive links until you connect a real email service:

1. Create a free account at an email service such as https://resend.com and verify a sending domain (for example `rentportal.co.ke`).
2. In Supabase, **Authentication > Emails > SMTP Settings**: turn on custom SMTP and paste the details from the email service.

Until then, people can sign in with Google. To hide the Google button and use only email, set `VITE_GOOGLE_SIGNIN` to `off` in Netlify.

### 4. Netlify (the website)

1. Go to https://app.netlify.com, sign up with GitHub.
2. **Add new site > Import an existing project > GitHub**, pick this repository. Netlify reads the build settings from `netlify.toml`, so leave them as they are.
3. Before deploying, open **Environment variables** (or after: **Site configuration > Environment variables**) and add:

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | your Supabase Project URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | your Supabase Publishable key |
   | `SUPABASE_URL` | your Supabase Project URL (again) |
   | `SUPABASE_SECRET_KEY` | your Supabase Secret key (mark it as secret) |

4. Deploy. When it finishes, rename the site under **Site configuration > Change site name** (for example `rentportal` gives `https://rentportal.netlify.app`) and make sure the Supabase Site URL and Redirect URLs from step 1.4 match it.

### 5. Move the data from the old site

1. On the old site (rent-portal-7o0pk2.v2.appdeploy.ai) sign in as the site owner and click **Download backup**.
2. On the new site sign in as the site owner (`linusomwoyo96@gmail.com`), click **Restore from backup**, choose that file and type `REPLACE`.

Landlords, plots, caretakers, tenants, bills and payments move across. Everyone signs in again with the same email address and finds their account as before. Phone alerts must be switched on again on each phone.

### 6. Your own domain (optional)

In Netlify open **Domain management > Add a domain**, enter `rentportal.co.ke` and follow the DNS instructions (Netlify adds free HTTPS). Then put `https://rentportal.co.ke` in the Supabase Site URL and add `https://rentportal.co.ke/**` to Redirect URLs.

## Making changes

Every change pushed to the `main` branch on GitHub is published by Netlify automatically within a couple of minutes.

To try changes on your own computer first (Node.js 20 or newer):

```
npm install
npm run local
```

Then open http://localhost:5173. Test mode lets you sign in with any email address and keeps data in `local-data.json`, never touching the live site.

## Good to know

- Free Supabase projects pause after a week with no visits; open the Supabase dashboard and click **Restore** if that happens. Regular use keeps it awake.
- The database table is locked so browsers can never read it directly; only the server functions (using the Secret key) can.
- Never put the Secret key in the code or share it in chat. If it leaks, create a new one in Supabase and update it in Netlify.
