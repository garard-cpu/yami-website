# Yami website

The USC-only waitlist page for Yami, live at https://yami-usc.netlify.app

- `index.html` is the whole page: styles, copy, the waitlist form and the scripts.
- `yami-trojan.svg` is the Trojan Yami mascot. `parkside.jpg` is the meal photo in the phone mockup.
- `app/` is the Yami app itself (Saf's built prototype, `app/index.html`), live at https://yami-usc.netlify.app/app/. Phones can add it to the home screen.
- `netlify/functions/vision.mts` reads meal photos with Claude Sonnet 5.5 for the app at `/api/vision`. It needs `ANTHROPIC_API_KEY` set in Netlify's environment variables. The key never goes in this repo.
- No build step for the pages. Open `index.html` in a browser, or run `python3 -m http.server 5180` here and visit http://localhost:5180.
- `app/account.js` adds accounts (email and password, Google, Apple) and saves each person's profile, grocery list and meals to Firebase. It wraps Saf's bundle instead of changing it: the bundle sits in `<script type="text/yami-app" id="yami-app">` and starts after sign-in. Settings are in `app/firebase-config.js`; while `apiKey` is empty the app runs without accounts and keeps everything on the phone. Test the flow locally with a stand-in backend at http://localhost:5180/app/?fakeauth (add `&fakeoffline` to test a dropped connection).
- `firestore.rules` lets each person read and write only their own data. Paste it into Firebase console > Firestore > Rules.
- Sign-ups go to Netlify Forms (form name `waitlist`). Keep the form's `name`, `data-netlify` and field names as they are, or sign-ups stop saving.

### Turning on accounts (one time, in the Firebase console)

1. Create a project named Yami at https://console.firebase.google.com (Analytics can stay off).
2. Build > Authentication > Get started. Turn on Email/Password and Google.
3. Authentication > Settings > Authorized domains: add `yami-usc.netlify.app`.
4. Build > Firestore Database > Create database (production mode, us-west2). Then Rules: paste `firestore.rules` and Publish.
5. Project settings > Your apps > Web (</>): register "Yami web". Copy apiKey, authDomain, projectId and appId into `app/firebase-config.js`.
6. Apple (later): needs a Services ID and key from the Apple Developer account, entered under Authentication > Sign-in method > Apple. Then set `apple: true`.

When Saf sends a new export of the app, copy it over `app/index.html` and re-apply the small edits marked in `app/account.js`'s header (the script tags, meals and board loading from localStorage, the two save effects and the `yami-account` slot on Profile).

Style notes: Unbounded for headlines (lowercase), Instrument Sans for body, cardinal #990000 with bubblegum pink #FF9EC4 as the accent and gold used sparingly. No em dashes in copy.

Not affiliated with or endorsed by USC.
