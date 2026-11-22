# Yami website

The USC-only homepage for Yami, live at https://yami-usc.pages.dev (Cloudflare Pages, free plan, no badge). The old https://yami-usc.netlify.app forwards there.

- `index.html` is the whole page: styles, copy, the waitlist form and the scripts.
- `yami-trojan.svg` is the Trojan Yami mascot. `parkside.jpg` is the meal photo in the phone mockup.
- `app/` is the Yami app itself (Saf's built prototype, `app/index.html`), live at https://yami-usc.pages.dev/app/. Phones can add it to the home screen.
- `functions/api/vision.ts` reads meal photos with Claude Sonnet 5.5 for the app at `/api/vision`. It needs `ANTHROPIC_API_KEY` set as a secret in Cloudflare (Workers & Pages > yami-usc > Settings > Variables and Secrets). The key never goes in this repo. `functions/api/instacart-list.js` is the Instacart list (needs `INSTACART_API_KEY`).
- Cloudflare settings are in `wrangler.toml`. Test locally with `npx wrangler pages dev .` (http://localhost:8788).
- No build step for the pages. Open `index.html` in a browser, or run `python3 -m http.server 5180` here and visit http://localhost:5180.
- `app/account.js` adds accounts (email and password, Google, Apple) and saves each person's profile, grocery list and meals to Firebase. It wraps Saf's bundle instead of changing it: the bundle sits in `<script type="text/yami-app" id="yami-app">` and starts after sign-in. Settings are in `app/firebase-config.js`; while `apiKey` is empty the app runs without accounts and keeps everything on the phone. Test the flow locally with a stand-in backend at http://localhost:5180/app/?fakeauth (add `&fakeoffline` to test a dropped connection).
- `app/users.html` is the team's sign-up list (count, emails, email-updates opt-in, CSV).
- `app/analytics.js` tracks which features people use, with PostHog: which tab they open (home, groceries, order smart, dashboard), how long they stay, snaps, plates saved, grocery receipts and Order Smart results, plus session replays with typing masked. It also counts homepage visits, so PostHog can show the funnel from site to app. It wraps the app bundle like `account.js` does. It stays off until a PostHog project key is pasted into `KEY` at the top of the file. Add `?notrack` to a URL to keep your own testing out of the numbers. When a new export replaces `app/index.html`, keep the `<script type="module" src="/app/analytics.js">` tag right after the `account.js` one.
- `firestore.rules` lets each person read and write only their own data. Paste it into Firebase console > Firestore > Rules.
- Homepage sign-ups go to the `waitlist` collection in Yami's Firebase (one doc per email) and show on `app/users.html`. `firestore.rules` lets anyone add their own email once and only the team read the list.

### Turning on accounts (one time, in the Firebase console)

1. Create a project named Yami at https://console.firebase.google.com (Analytics can stay off).
2. Build > Authentication > Get started. Turn on Email/Password and Google.
3. Authentication > Settings > Authorized domains: add `yami-usc.pages.dev`.
4. Build > Firestore Database > Create database (production mode, us-west2). Then Rules: paste `firestore.rules` and Publish.
5. Project settings > Your apps > Web (</>): register "Yami web". Copy apiKey, authDomain, projectId and appId into `app/firebase-config.js`.
6. Team sign-up list: in Firestore, start a collection named `admins` and add one doc per teammate whose ID is their Google email. Then visit https://yami-usc.pages.dev/app/users.html and sign in with Google to see the count, emails and who wants updates, with a CSV download. It only reads `directory/`, never profiles or meals.
7. Apple (later): needs a Services ID and key from the Apple Developer account, entered under Authentication > Sign-in method > Apple. Then set `apple: true`.

When Saf sends a new export of the app, copy it over `app/index.html` and re-apply the small edits marked in `app/account.js`'s header (the script tags, meals and board loading from localStorage, the two save effects and the `yami-account` slot on Profile).

Style notes: Unbounded for headlines (lowercase), Instrument Sans for body, cardinal #990000 with bubblegum pink #FF9EC4 as the accent and gold used sparingly. No em dashes in copy.

Not affiliated with or endorsed by USC.
