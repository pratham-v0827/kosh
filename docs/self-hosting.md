# Self-hosting Kosh

Run Kosh on **your own** Firebase project and Vercel account. Everything here is free: Firebase's Spark plan, Vercel's Hobby plan, and free API keys. No paid key or service is needed anywhere, and nothing depends on the original author's accounts.

> Limits and plan rules below were checked on 2026-11-09 (mostly third-party sources); confirm on the providers' own pages before relying on them.

## 0. Try it locally first (no accounts at all)

Needs Node.js 24+, pnpm 12 (`npm install -g pnpm@12`), Git, and Java JDK 21+ (for the Firebase emulators only).

```bash
git clone <your fork> kosh
```

```bash
cd kosh
```

```bash
pnpm install
```

```bash
pnpm dev:all
```

Open http://localhost:3000. The app runs on the offline emulator project `demo-kosh`. Sign in with "Email me a sign-in link": the emulator prints the link in the terminal (and in the emulator UI at http://127.0.0.1:4000). For demo data, run this in another terminal:

```bash
pnpm seed you@example.test
```

## 1. Create your Firebase project (Spark, free)

1. https://console.firebase.google.com → **Add project**. Google Analytics is not needed.
2. Stay on the **Spark** plan. Kosh uses only Authentication and Cloud Firestore. It does **not** use Cloud Functions, Cloud Storage or phone sign-in, which need the paid Blaze plan (Storage has required Blaze since Feb 2026).
3. **Build → Authentication → Get started → Sign-in method**:
   - enable **Google**;
   - enable **Email/Password** and turn on **Email link (passwordless sign-in)**.
4. **Authentication → Settings → Authorized domains**: add your Vercel domain (e.g. `kosh-yourname.vercel.app`) and any custom domain.
5. **Build → Firestore Database → Create database**: production mode, region `asia-south1` (Mumbai) or the one closest to your users. The region cannot be changed later.
6. **Project settings → General → Your apps → Web (`</>`)**: register an app (no Hosting). Copy `apiKey`, `authDomain` and `projectId`.

### Deploy the security rules and indexes

```bash
copy .firebaserc.example .firebaserc
```

Edit `.firebaserc` and put your project id in it, then:

```bash
pnpm exec firebase login
```

```bash
pnpm firebase:deploy-rules
```

The rules deny everything by default, give users read-only access to their own data, and give admins no access to user data.

### Restrict the browser API key

Google Cloud console → **APIs & Services → Credentials**:

- Open the key named "Browser key (auto created by Firebase)".
- Under **Application restrictions → Websites**, add `https://<your-domain>/*` (and `http://localhost:3000/*` if you test a production build locally).

The key is public by design, but this stops other sites from using your project.

### Service account (server credentials)

**Project settings → Service accounts → Generate new private key**. This downloads a JSON file. **Never commit it.** Turn it into one line of base64, then delete the file:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json"))
```

## 2. Free price keys (optional)

| Key                                                         | For        | Free tier (unverified, 2026-11)                                | Without it     |
| ----------------------------------------------------------- | ---------- | -------------------------------------------------------------- | -------------- |
| `ALPHAVANTAGE_API_KEY` (alphavantage.co → Get free API key) | BSE stocks | ~25 requests/day, ~5/min; shared by all users of your instance | BSE uses Yahoo |
| `FINNHUB_API_KEY` / `TWELVEDATA_API_KEY`                    | US stocks  | ~60/min / ~800/day                                             | US uses Yahoo  |

Mutual funds (AMFI), crypto (CoinDCX) and USD/INR (ECB via Frankfurter) need no key.

**Yahoo Finance is unofficial.** Kosh uses Yahoo's website endpoint for NSE stocks, as a BSE fallback and for US stocks. It is on by default, needs no key, and is labelled "unofficial" in the app. It is not a public API: it can change or stop without notice, and Yahoo's terms may not permit this use. Set `ENABLE_UNOFFICIAL_YAHOO=false` if you'd rather not use it; NSE stocks then need manual prices.

## 3. Deploy on Vercel (Hobby, free)

Vercel's Hobby plan is for **personal, non-commercial use**. Running a public service for others may need Pro; check Vercel's fair-use terms.

1. Push your fork to GitHub, then **vercel.com → Add New → Project → Import** it.
2. **Root Directory: `apps/web`**. Vercel detects Next.js and the pnpm workspace.
3. **Environment Variables**: set every `[REQUIRED]` variable from [.env.example](../.env.example):

   | Variable                                                                                              | Value                                                                                      |
   | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
   | `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | from step 1.6                                                                              |
   | `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`                                                                | from "Service account"                                                                     |
   | `APP_BASE_URL`                                                                                        | `https://<your-domain>`                                                                    |
   | `CRON_SECRET`                                                                                         | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`                 |
   | optional                                                                                              | `ALPHAVANTAGE_API_KEY`, `FINNHUB_API_KEY`, `TWELVEDATA_API_KEY`, `ENABLE_UNOFFICIAL_YAHOO` |

   **Do not** set `NEXT_PUBLIC_USE_EMULATORS`, `FIRESTORE_EMULATOR_HOST` or `FIREBASE_AUTH_EMULATOR_HOST`. Kosh refuses to start in emulator mode on production, because it would accept unsigned tokens.

4. Deploy. `apps/web/vercel.json` schedules the daily job (`/api/cron/daily`, ~07:00–08:00 IST; Hobby allows one run per day).

Before deploying, you can check a local copy of your settings (values are never printed):

```bash
pnpm check-env --file apps/web/.env.local
```

## 4. Make yourself admin

Sign in once on your deployment. Then, on your machine, with the service-account base64 in your shell:

```powershell
$env:FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 = "<base64>"
```

```bash
pnpm admin:grant --email you@example.com
```

Sign out and in again to pick up the admin role. `--revoke` removes it. There is no hard-coded admin anywhere. (The admin console arrives in M6.)

## 5. Spark plan fit

| Firebase product                    | Kosh uses | Spark (free)                                                | Notes                                                          |
| ----------------------------------- | --------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| Authentication (Google, email link) | yes       | free; ~50K MAU (third-party figure)                         | Phone sign-in needs Blaze: not used                            |
| Cloud Firestore                     | yes       | 1 GiB stored, ~50K reads / 20K writes / 20K deletes per day | Dashboard = 2–3 reads; refresh ≈ 3 writes + a few price writes |
| Cloud Functions / Scheduler         | **no**    | Blaze only                                                  | Scheduling is done by Vercel cron                              |
| Cloud Storage                       | **no**    | Blaze only since Feb 2026                                   | Uploads (M3) are parsed in memory and discarded                |

Exceeding a Spark quota pauses that product until the quota resets; nothing is billed.

## 6. Recommended hardening

- **App Check** (reCAPTCHA) on Firestore and Auth, once your domain is live, to stop scripted use of your project from outside the app.
- Keep the browser API key restricted (above).
- Rotate `CRON_SECRET` and the service-account key if they are ever exposed (Firebase console → Service accounts → manage keys → delete the old key).
- Watch Firebase **Usage and billing** for quota warnings.

## Troubleshooting

| Symptom                                      | Fix                                                                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| "Firebase web config missing" in the browser | One of the three `NEXT_PUBLIC_FIREBASE_*` variables is unset; redeploy after setting it                                |
| Every API call returns 401                   | The service account is from a different project than `NEXT_PUBLIC_FIREBASE_PROJECT_ID` (`pnpm check-env` detects this) |
| Email link opens but sign-in fails           | Your domain is missing from Authentication → Authorized domains                                                        |
| BSE prices from Yahoo, not Alpha Vantage     | The daily free quota is used up (shared by all users) or no key is set: expected                                       |
| Indian stock shows "No price"                | Use the exchange ticker (e.g. `RELIANCE`), not the ISIN                                                                |
