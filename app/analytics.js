// Yami usage tracking with PostHog (https://posthog.com).
// Like account.js, this wraps Saf's app bundle instead of changing it, so a new export of app/index.html keeps working.
//
// What it records:
// - feature_viewed  { feature, from }   each time someone opens a tab: home, groceries, order_smart, dashboard
// - snap_opened     { from }             someone tapped "+" to snap or log a meal
// - feature_time    { feature, seconds } how long they stayed on that tab before leaving it or closing the app
// - plate_snapped   { meals_total }      a new meal was saved to their diary
// - grocery_receipt_logged               the grocery receipt log changed
// - order_smart_results { query }        Order Smart showed a results sheet
// - every tap and page view (PostHog autocapture), tagged with the tab it happened on (current_feature)
// - session replays, with everything typed masked
// Signed-in people are identified by their Firebase uid (never their email), so one friend's phone and laptop count as one person.
//
// To turn it on: paste the project key from PostHog (Settings > Project > Project API key, starts with "phc_") below.
// While KEY is empty this file does nothing.

const KEY = "phc_kqzyNWL3DvtVudHb85bCVUgrCScRmPT8Q7uqV8Kw7uPa";
const HOST = "https://us.i.posthog.com"; // use https://eu.i.posthog.com if the PostHog project is in the EU

const FEATURES = { Home: "home", Groceries: "groceries", "Order Smart": "order_smart", Dashboard: "dashboard", "Log a meal": "snap" };

if (KEY && !/[?&]notrack\b/.test(location.search)) start();

function start() {
  const queue = [];
  let ph = null;
  const send = (event, props, opts) => (ph ? ph.capture(event, props, opts) : queue.push(["capture", event, props, opts]));
  const call = (name, ...args) => (ph ? ph[name](...args) : queue.push([name, ...args]));

  const s = document.createElement("script");
  s.src = HOST.replace(".i.posthog.com", "-assets.i.posthog.com") + "/static/array.js";
  s.async = true;
  s.crossOrigin = "anonymous";
  s.onload = () => {
    window.posthog.init(KEY, {
      api_host: HOST,
      defaults: "2026-01-30",
      person_profiles: "always",
      session_recording: { maskAllInputs: true },
    });
    ph = window.posthog;
    for (const [name, ...args] of queue.splice(0)) name === "capture" ? ph.capture(...args) : ph[name](...args);
  };
  document.head.appendChild(s);

  // ---------- who: the signed-in account (account.js keeps the uid in localStorage) ----------
  let who = null;
  const checkUser = () => {
    let uid = null;
    try { uid = localStorage.getItem("yami-uid"); } catch {}
    if (uid && uid !== who) { who = uid; call("identify", uid); }
  };
  checkUser();

  // Only the app page has tabs; the homepage just gets page views and taps.
  if (!location.pathname.startsWith("/app")) return;

  // ---------- which tab is open, and for how long ----------
  let current = null;
  let since = 0;
  const now = () => Date.now();

  const leave = (beacon) => {
    if (!current) return;
    const seconds = Math.round((now() - since) / 1000);
    if (seconds > 0) send("feature_time", { feature: current, seconds }, beacon ? { transport: "sendBeacon" } : undefined);
  };

  const readTab = () => {
    const on = document.querySelector('nav[aria-label="Main"] button[aria-current="page"], .plusfab[aria-current="page"]');
    return on ? FEATURES[on.getAttribute("aria-label")] || on.getAttribute("aria-label") : null;
  };

  const update = () => {
    const tab = readTab();
    if (!tab || tab === current) return;
    leave(false);
    send("feature_viewed", { feature: tab, from: current });
    call("register", { current_feature: tab });
    current = tab;
    since = now();
    checkUser();
  };

  let pending = 0;
  new MutationObserver(() => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      update();
      const sheet = document.querySelector('.os-sh[role="dialog"]:not([data-yt])');
      if (sheet) {
        sheet.setAttribute("data-yt", "1");
        const q = sheet.querySelector(".os-q")?.textContent?.replace(/^order smart\s*·\s*/i, "").slice(0, 80);
        send("order_smart_results", { query: q || null });
      }
    });
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-current"] });

  // Closing or hiding the app ends the visit to the current tab; coming back starts a new one.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") leave(true);
    else since = now();
  });
  addEventListener("pagehide", () => leave(true));

  // ---------- actions ----------
  // The "+" button opens the snap sheet over the current tab.
  addEventListener("yami-log-open", () => send("snap_opened", { from: current }));

  // New meals: account.js hands every diary change to window.__yamiSave("meals", list).
  let meals = -1;
  const countMeals = () => { try { return (JSON.parse(localStorage.getItem("yami-meals") || "[]") || []).length; } catch { return 0; } };
  const save = window.__yamiSave;
  if (typeof save === "function") {
    window.__yamiSave = (what, list) => {
      if (what === "meals" && Array.isArray(list)) {
        if (meals < 0) meals = countMeals();
        if (list.length > meals) send("plate_snapped", { meals_total: list.length });
        meals = list.length;
      }
      return save(what, list);
    };
  }

  // Grocery receipts: the app writes "yami-groc-log" itself.
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    let before;
    if (this === localStorage && k === "yami-groc-log") { try { before = localStorage.getItem(k); } catch {} }
    setItem.call(this, k, v);
    if (before !== undefined && before !== v) send("grocery_receipt_logged");
  };
}
