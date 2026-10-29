# Yami website

The USC-only waitlist page for Yami, live at https://yami-usc.netlify.app

- `index.html` is the whole page: styles, copy, the waitlist form and the scripts.
- `yami-trojan.svg` is the Trojan Yami mascot. `parkside.jpg` is the meal photo in the phone mockup.
- `app/` is the Yami app itself (Saf's built prototype, `app/index.html`), live at https://yami-usc.netlify.app/app/. Phones can add it to the home screen.
- `netlify/functions/vision.mts` reads meal photos with Claude Sonnet 5.5 for the app at `/api/vision`. It needs `ANTHROPIC_API_KEY` set in Netlify's environment variables. The key never goes in this repo.
- No build step for the pages. Open `index.html` in a browser, or run `python3 -m http.server 5180` here and visit http://localhost:5180.
- Sign-ups go to Netlify Forms (form name `waitlist`). Keep the form's `name`, `data-netlify` and field names as they are, or sign-ups stop saving.

Style notes: Unbounded for headlines (lowercase), Instrument Sans for body, cardinal #990000 with bubblegum pink #FF9EC4 as the accent and gold used sparingly. No em dashes in copy.

Not affiliated with or endorsed by USC.
