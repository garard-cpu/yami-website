// Yami accounts: a sign-in screen, plus cloud sync of what the app keeps in localStorage.
// The app bundle waits in <script type="text/yami-app" id="yami-app"> until boot() starts it.
// Data lives at users/{uid} (profile, grocery list, onboarding flags), users/{uid}/meals/{at}
// (one doc per diary meal) and users/{uid}/extra/board.
//
// Edits to Saf's export (app/index.html), to redo when a new export replaces it:
// 1. Before the bundle: <script src="/app/firebase-config.js">, <script type="module" src="/app/account.js">
//    and the 8-second fallback starter; the bundle's own tag becomes <script type="text/yami-app" id="yami-app">.
// 2. In the provider: meals ([v,z]) and board ([I,k]) start from localStorage "yami-meals" / "yami-board"
//    (meals fall back to the app's own c.meals from "yami-proto").
// 3. After the "yami-proto" save effect (deps [d,N,v]): two effects that call window.__yamiSave("meals", v) and ("board", I).
// 4. On Profile, before "Yami offers general guidance": r.jsx("div",{id:"yami-account"}).

window.__yamiAcct = true;

// Saved per account as strings in users/{uid}.extras (the app writes these itself; badges, food-name fixes, usual foods).
const EXTRA = ["yami-badges", "yami-fixes", "yami-usuals"];
const KEYS = ["yami-proto", "yami-ob3", "yami-fuel", ...EXTRA];
// Per-phone flags (tours already seen): not synced, but cleared on sign-out so the next person starts fresh.
const DEVICE = ["yami-motw", "yami-ostour", "yami-tour-groc"];
const LOCAL = [...KEYS, ...DEVICE, "yami-meals", "yami-board", "yami-uid", "yami-dirty"];
const cfg = window.YAMI_FIREBASE || {};
const qs = new URLSearchParams(location.search);
const fake = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && qs.has("fakeauth");
const rawSet = Storage.prototype.setItem;
const rawDel = Storage.prototype.removeItem;

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { rawSet.call(localStorage, k, v); } catch {} };
const del = (k) => { try { rawDel.call(localStorage, k); } catch {} };
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

let api = null;   // cloud backend once Firebase (or the local fake) is ready
let user = null;  // { uid, email }
let started = false;

function boot() {
  if (started || window.__yamiStarted) return;
  started = window.__yamiStarted = true;
  document.getElementById("yacct")?.remove();
  const src = document.getElementById("yami-app");
  const s = document.createElement("script");
  s.type = "module";
  s.textContent = src.textContent;
  document.body.appendChild(s);
}

// ---------- photos: blob: URLs die on reload, so meals keep a small JPEG copy ----------

const thumbs = new Map();
async function shrink(src) {
  if (typeof src !== "string") return src;
  if (!src.startsWith("blob:") && !(src.startsWith("data:") && src.length > 200000)) return src;
  if (thumbs.has(src)) return thumbs.get(src);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    const k = Math.min(1, 480 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL("image/jpeg", 0.72);
    thumbs.set(src, out);
    return out;
  } catch {
    return null;
  }
}
const portable = (list) => Promise.all((list || []).map(async (m) => (m && m.img ? { ...m, img: await shrink(m.img) } : m)));

function putList(key, list) {
  try {
    rawSet.call(localStorage, key, JSON.stringify(list));
  } catch {
    // Phone storage is full: keep the meals, drop their photos (the cloud copy still has them).
    set(key, JSON.stringify(list.map((m) => (m && m.img ? { ...m, img: null } : m))));
  }
}

// ---------- saving: the app calls __yamiSave for meals and board; the rest goes through localStorage ----------

const pending = {};
let listTimer = 0, docTimer = 0, work = Promise.resolve();
const queue = (job) => (work = work.then(job, job));

window.__yamiSave = (what, list) => {
  pending[what] = list;
  clearTimeout(listTimer);
  listTimer = setTimeout(flushLists, 600);
};

Storage.prototype.setItem = function (k, v) {
  rawSet.call(this, k, v);
  if (this === localStorage && KEYS.includes(k)) queueDoc();
};
Storage.prototype.removeItem = function (k) {
  rawDel.call(this, k);
  if (this === localStorage && KEYS.includes(k)) queueDoc();
};

function queueDoc() {
  if (!user) return;
  set("yami-dirty", "1");
  clearTimeout(docTimer);
  docTimer = setTimeout(() => queue(pushDoc), 800);
}

function flushLists() {
  clearTimeout(listTimer);
  const jobs = Object.entries(pending);
  for (const k of Object.keys(pending)) delete pending[k];
  return queue(async () => {
    for (const [what, raw] of jobs) {
      let list = await portable(raw);
      if (what === "board") list = list.slice(0, 30);
      putList("yami-" + what, list);
      if (!user) continue;
      set("yami-dirty", "1");
      if (what === "meals") await pushMeals(list);
      else await safe(() => api.saveBoard(user.uid, JSON.stringify(list)));
    }
    if (user && !failed) del("yami-dirty");
  });
}

function flushAll() {
  if (docTimer) { clearTimeout(docTimer); docTimer = 0; if (user) queue(pushDoc); }
  return flushLists();
}

let failed = false;
async function safe(fn) {
  try { await fn(); return true; } catch (e) { failed = true; console.warn("Yami could not save to the cloud yet", e); return false; }
}

// The app also keeps recent meals inside "yami-proto"; they sync one doc each (pushMeals),
// so the profile doc leaves them out and stays well under Firestore's 1 MB limit.
function protoForCloud() {
  const raw = get("yami-proto");
  const p = parse(raw, null);
  if (!p || !p.meals) return raw || "";
  const { meals, ...rest } = p;
  return JSON.stringify(rest);
}
// Meals saved before signing in may live only inside "yami-proto".
function localMeals() {
  const m = parse(get("yami-meals"), null);
  if (Array.isArray(m)) return m;
  const p = parse(get("yami-proto"), null);
  return Array.isArray(p?.meals) ? p.meals : [];
}

async function pushDoc() {
  docTimer = 0;
  if (!user) return;
  failed = false;
  const ok = await safe(() => api.saveDoc(user.uid, {
    proto: protoForCloud(),
    ob3: get("yami-ob3") === "1",
    fuel: get("yami-fuel") || "",
    extras: Object.fromEntries(EXTRA.map((k) => [k, get(k) || ""])),
    email: user.email || "",
  }));
  if (ok && !Object.keys(pending).length) del("yami-dirty");
}

// The team's sign-up list (app/users.html) reads only directory/{uid}, never profiles or meals.
async function pushDirectory(isNew) {
  const upd = get("yami-updates");
  const ok = await safe(() => api.saveDirectory(user.uid, {
    email: user.email || "",
    lastActive: Date.now(),
    ...(upd !== null && { updates: upd === "1" }),
    ...(isNew && { joinedAt: Date.now() }),
  }));
  if (ok) del("yami-updates");
}

let sent = new Map(); // meal id -> JSON last saved to the cloud
async function pushMeals(list) {
  const next = new Map(list.filter((m) => m && m.at).map((m) => [String(m.at), JSON.stringify(m)]));
  failed = false;
  for (const [id, json] of next) {
    if (sent.get(id) === json) continue;
    if (await safe(() => api.saveMeal(user.uid, id, json))) sent.set(id, json);
  }
  for (const id of [...sent.keys()]) {
    if (next.has(id)) continue;
    if (await safe(() => api.deleteMeal(user.uid, id))) sent.delete(id);
  }
}

addEventListener("pagehide", flushAll);
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushAll());
addEventListener("online", () => user && (queue(pushDoc), queue(() => pushMeals(localMeals()))));

// ---------- loading a signed-in person's data before the app starts ----------

function hasLocalProfile() {
  const p = parse(get("yami-proto"), null);
  return !!(p && p.P && (p.P.onboarded || p.P.name));
}

async function hydrate(u) {
  user = u;
  const sameUser = get("yami-uid") === u.uid;
  let cloud;
  try {
    cloud = await api.load(u.uid);
  } catch (e) {
    console.warn("Yami could not load the account", e);
    if (sameUser) return boot(); // offline: use this phone's copy, sync later
    return showError("We couldn't load your profile. Check your connection and try again.", () => hydrate(u));
  }

  const localWins = (sameUser && get("yami-dirty") === "1") || (!cloud && hasLocalProfile() && !get("yami-uid"));
  if (cloud && !localWins) {
    // This phone may hold someone else's data, or an older copy: replace it with the account's.
    cloud.proto ? set("yami-proto", cloud.proto) : del("yami-proto");
    cloud.ob3 ? set("yami-ob3", "1") : del("yami-ob3");
    cloud.fuel ? set("yami-fuel", cloud.fuel) : del("yami-fuel");
    for (const k of EXTRA) cloud.extras?.[k] ? set(k, cloud.extras[k]) : del(k);
    for (const k of DEVICE) del(k);
    const meals = (cloud.meals || []).map((j) => parse(j, null)).filter(Boolean).sort((a, b) => (a.at || 0) - (b.at || 0));
    putList("yami-meals", meals);
    cloud.board ? set("yami-board", cloud.board) : del("yami-board");
    sent = new Map(meals.map((m) => [String(m.at), JSON.stringify(m)]));
  } else {
    if (!cloud && !localWins) for (const k of LOCAL) del(k); // brand-new account on a phone with no Yami data of its own
    sent = new Map((cloud?.meals || []).map((j) => { const m = parse(j, null); return m && [String(m.at), j]; }).filter(Boolean));
    // Upload what this phone has (first sign-in after using Yami without an account, or unsaved changes).
    await queue(pushDoc);
    await queue(() => pushMeals(localMeals()));
    const board = get("yami-board");
    if (board) await queue(() => safe(() => api.saveBoard(u.uid, board)));
  }
  await pushDirectory(!cloud);
  set("yami-uid", u.uid);
  del("yami-dirty");
  boot();
}

async function signOut() {
  if (!confirm("Sign out of Yami on this phone? Your profile and meals stay saved in your account.")) return;
  await flushAll();
  await work;
  await api.signOut();
  for (const k of LOCAL) del(k);
  location.reload();
}

// ---------- backends ----------

async function firebaseApi() {
  const base = "https://www.gstatic.com/firebasejs/11.0.2/";
  const [{ initializeApp }, A, F] = await Promise.all([
    import(base + "firebase-app.js"),
    import(base + "firebase-auth.js"),
    import(base + "firebase-firestore.js"),
  ]);
  const app = initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId, appId: cfg.appId });
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  const meal = (uid, id) => F.doc(db, "users", uid, "meals", id);
  const board = (uid) => F.doc(db, "users", uid, "extra", "board");
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  async function provider(p) {
    if (standalone) return A.signInWithRedirect(auth, p); // home-screen apps can't open popups reliably
    try {
      await A.signInWithPopup(auth, p);
    } catch (e) {
      if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") return A.signInWithRedirect(auth, p);
      throw e;
    }
  }
  return {
    onUser: (cb) => A.onAuthStateChanged(auth, (u) => cb(u && { uid: u.uid, email: u.email })),
    signUp: (e, p) => A.createUserWithEmailAndPassword(auth, e, p),
    signIn: (e, p) => A.signInWithEmailAndPassword(auth, e, p),
    google: () => provider(new A.GoogleAuthProvider()),
    apple: () => { const p = new A.OAuthProvider("apple.com"); p.addScope("email"); p.addScope("name"); return provider(p); },
    resetPassword: (e) => A.sendPasswordResetEmail(auth, e),
    signOut: () => A.signOut(auth),
    async load(uid) {
      const [d, ms, b] = await Promise.all([
        F.getDoc(F.doc(db, "users", uid)),
        F.getDocs(F.collection(db, "users", uid, "meals")),
        F.getDoc(board(uid)),
      ]);
      if (!d.exists() && ms.empty) return null;
      return { ...(d.data() || {}), meals: ms.docs.map((x) => x.data().json), board: b.exists() ? b.data().json : "" };
    },
    saveDoc: (uid, data) => F.setDoc(F.doc(db, "users", uid), { ...data, updatedAt: F.serverTimestamp() }, { merge: true }),
    saveMeal: (uid, id, json) => F.setDoc(meal(uid, id), { json, at: Number(id) || 0 }),
    deleteMeal: (uid, id) => F.deleteDoc(meal(uid, id)),
    saveBoard: (uid, json) => F.setDoc(board(uid), { json }),
    saveDirectory: (uid, data) => F.setDoc(F.doc(db, "directory", uid), data, { merge: true }),
  };
}

// Local stand-in for testing the flow without Firebase: http://localhost:<port>/app/?fakeauth
function fakeApi() {
  const db = parse(get("yami-fake-db"), { users: {}, docs: {} });
  const save = () => set("yami-fake-db", JSON.stringify(db));
  const err = (code) => Object.assign(new Error(code), { code });
  let cb = () => {};
  const login = (u) => { set("yami-fake-user", JSON.stringify(u)); cb(u); };
  const doc = (uid) => (db.docs[uid] ||= { meals: {} });
  const slow = () => new Promise((r) => setTimeout(r, 150));
  return {
    onUser: (f) => { cb = f; setTimeout(() => f(parse(get("yami-fake-user"), null)), 50); },
    async signUp(e, p) {
      await slow();
      if (db.users[e]) throw err("auth/email-already-in-use");
      if (p.length < 6) throw err("auth/weak-password");
      db.users[e] = { p, uid: "u" + (Object.keys(db.users).length + 1) };
      save();
      login({ uid: db.users[e].uid, email: e });
    },
    async signIn(e, p) {
      await slow();
      const u = db.users[e];
      if (!u || u.p !== p) throw err("auth/invalid-credential");
      login({ uid: u.uid, email: e });
    },
    google: async () => login({ uid: "google1", email: "tommy@usc.edu" }),
    apple: async () => login({ uid: "apple1", email: null }),
    resetPassword: async () => slow(),
    signOut: async () => { del("yami-fake-user"); },
    async load(uid) {
      await slow();
      if (qs.has("fakeoffline")) throw err("unavailable");
      const d = db.docs[uid];
      return d ? { ...d, meals: Object.values(d.meals) } : null;
    },
    async saveDoc(uid, data) { Object.assign(doc(uid), data); save(); },
    async saveMeal(uid, id, json) { doc(uid).meals[id] = json; save(); },
    async deleteMeal(uid, id) { delete doc(uid).meals[id]; save(); },
    async saveBoard(uid, json) { doc(uid).board = json; save(); },
    async saveDirectory(uid, data) { (db.directory ||= {})[uid] = { ...db.directory[uid], ...data }; save(); },
  };
}

// ---------- sign-in screen ----------

const ERRORS = {
  "auth/invalid-credential": "That email and password don't match. Try again or reset your password.",
  "auth/wrong-password": "That email and password don't match. Try again or reset your password.",
  "auth/user-not-found": "No account with that email yet. Tap \"Create one\" below.",
  "auth/email-already-in-use": "That email already has an account. Sign in instead.",
  "auth/weak-password": "Use at least 6 characters for your password.",
  "auth/invalid-email": "That email doesn't look right.",
  "auth/missing-password": "Type a password.",
  "auth/too-many-requests": "Too many tries. Wait a minute, then try again.",
  "auth/network-request-failed": "No connection. Check your Wi-Fi and try again.",
  "auth/account-exists-with-different-credential": "That email already signed in another way. Use the button you used last time.",
};
const quiet = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);

const CSS = `
#yacct{position:fixed;inset:0;z-index:100;background:#fff7f2;color:#160909;font-family:"Instrument Sans","Helvetica Neue",system-ui,sans-serif;display:flex;justify-content:center;overflow-y:auto;padding:max(28px,env(safe-area-inset-top)) 20px max(28px,env(safe-area-inset-bottom))}
#yacct .ya{width:100%;max-width:380px;margin:auto 0;display:flex;flex-direction:column;gap:12px}
#yacct img{width:84px;height:84px;align-self:center;border-radius:22px;border:2.5px solid #160909;box-shadow:4px 4px 0 #160909;background:#ffe6ee}
#yacct h1{font-family:"Unbounded","Arial Black",system-ui,sans-serif;font-size:27px;line-height:1.1;margin:10px 0 0;text-align:center;letter-spacing:-.01em}
#yacct p{margin:0;text-align:center;color:#5e4744;line-height:1.45}
#yacct button,#yacct input{font:inherit;font-size:16px;border-radius:14px;min-height:50px}
#yacct .sso{display:flex;align-items:center;justify-content:center;gap:10px;font-weight:700;border:2.5px solid #160909;background:#fff;color:#160909;box-shadow:3px 3px 0 #160909;cursor:pointer}
#yacct .sso.apple{background:#160909;color:#fff}
#yacct .sso svg{width:20px;height:20px}
#yacct .opt{flex-direction:row;align-items:center;gap:10px;font-weight:600;font-size:15px;min-height:44px;cursor:pointer}
#yacct .opt input{width:22px;height:22px;min-height:0;margin:0;padding:0;accent-color:#990000}
#yacct .or{display:flex;align-items:center;gap:10px;color:#5e4744;font-size:14px}
#yacct .or:before,#yacct .or:after{content:"";flex:1;height:1.5px;background:#ead6d0}
#yacct form{display:flex;flex-direction:column;gap:10px}
#yacct label{display:flex;flex-direction:column;gap:4px;font-weight:700;font-size:14px}
#yacct input{border:2px solid #ead6d0;background:#fff;padding:0 14px;color:#160909}
#yacct input:focus{outline:none;border-color:#990000;box-shadow:0 0 0 3px #ff9ec455}
#yacct .go{border:2.5px solid #160909;background:#990000;color:#fff;font-weight:800;box-shadow:4px 4px 0 #160909;cursor:pointer}
#yacct button:disabled{opacity:.6;cursor:default}
#yacct .err{color:#990000;font-weight:700;min-height:1.2em;font-size:14px}
#yacct .err:empty{display:none}
#yacct .ok{color:#2c6e2f;font-weight:700;font-size:14px;text-align:center}
#yacct .ok:empty{display:none}
#yacct .links{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
#yacct .link{background:none;border:0;color:#990000;font-weight:700;text-decoration:underline;min-height:44px;padding:0;cursor:pointer}
#yacct .fine{font-size:13px}
#yacct .wait{display:flex;flex-direction:column;align-items:center;gap:14px;margin:auto}
#yami-account{margin:4px 0 14px}
#yami-account .yacard{border:2px solid var(--line,#ead6d0);background:var(--card,#fff);border-radius:18px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
#yami-account .yacard span{min-width:0;overflow:hidden;text-overflow:ellipsis}
#yami-account .yacard small{display:block;color:var(--muted,#5e4744)}
#yami-account button{font:inherit;font-weight:700;border:2px solid var(--ink,#160909);background:#fff;border-radius:999px;padding:8px 14px;min-height:44px;cursor:pointer;color:var(--ink,#160909)}
`;

const GOOGLE = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
const APPLE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.6-1-2.6-3.8zM14 5.4c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z"/></svg>';

function shell(html) {
  let el = document.getElementById("yacct");
  if (!el) {
    el = document.createElement("div");
    el.id = "yacct";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Sign in to Yami");
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="ya">${html}</div>`;
  return el;
}

function showWait() {
  shell('<div class="wait"><img src="/app/icon-192.png" alt=""><p>Loading your yami…</p></div>');
}

function showError(msg, retry) {
  const el = shell(`<img src="/app/icon-192.png" alt=""><h1>hmm.</h1><p>${msg}</p><button class="go" type="button">Try again</button>`);
  el.querySelector(".go").onclick = () => { showWait(); retry(); };
}

function showSignIn(mode = "up", note = "") {
  const up = mode === "up";
  const el = shell(`
    <img src="/app/icon-192.png" alt="">
    <h1>${up ? "save your yami." : "welcome back."}</h1>
    <p>${up ? "Make a free account so your profile and meals are saved, even on a new phone." : "Sign in to pick up where you left off."}</p>
    ${up ? '<label class="opt"><input type="checkbox" name="updates" checked> Send me Yami updates by email</label>' : ""}
    ${cfg.apple || fake ? `<button class="sso apple" type="button" data-p="apple">${APPLE}Continue with Apple</button>` : ""}
    ${cfg.google !== false || fake ? `<button class="sso" type="button" data-p="google">${GOOGLE}Continue with Google</button>` : ""}
    <div class="or">or use email</div>
    <form novalidate>
      <label>Email<input type="email" name="email" autocomplete="email" inputmode="email" autocapitalize="off" required></label>
      <label>Password<input type="password" name="pw" autocomplete="${up ? "new-password" : "current-password"}" minlength="6" required></label>
      <p class="err" role="alert"></p>
      <p class="ok" role="status">${note}</p>
      <button class="go" type="submit">${up ? "Create account" : "Sign in"}</button>
    </form>
    <div class="links">
      <button class="link" type="button" data-a="switch">${up ? "Have an account? Sign in" : "New here? Create one"}</button>
      ${up ? "" : '<button class="link" type="button" data-a="forgot">Forgot password?</button>'}
    </div>
    <p class="fine">Yami gives general guidance, not medical advice. Your meals are private to your account.</p>`);
  const form = el.querySelector("form");
  const errEl = el.querySelector(".err");
  const okEl = el.querySelector(".ok");
  const buttons = () => el.querySelectorAll("button");
  const busy = (on) => buttons().forEach((b) => (b.disabled = on));
  const fail = (e) => {
    busy(false);
    if (quiet.has(e.code)) return;
    errEl.textContent = ERRORS[e.code] || "Something went wrong. Try again.";
    console.warn(e);
  };

  const opt = el.querySelector('[name="updates"]');
  const remember = () => (opt ? set("yami-updates", opt.checked ? "1" : "0") : del("yami-updates"));

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const email = form.email.value.trim();
    const pw = form.pw.value;
    errEl.textContent = okEl.textContent = "";
    if (!email) return (errEl.textContent = "Type your email.");
    if (!pw) return (errEl.textContent = "Type a password.");
    busy(true);
    remember();
    try { await (up ? api.signUp(email, pw) : api.signIn(email, pw)); } catch (e) { fail(e); }
  };
  el.querySelectorAll(".sso").forEach((b) => (b.onclick = async () => {
    errEl.textContent = okEl.textContent = "";
    busy(true);
    remember();
    try { await api[b.dataset.p](); } catch (e) { fail(e); }
  }));
  el.querySelector('[data-a="switch"]').onclick = () => showSignIn(up ? "in" : "up");
  const forgot = el.querySelector('[data-a="forgot"]');
  if (forgot) forgot.onclick = async () => {
    const email = form.email.value.trim();
    errEl.textContent = okEl.textContent = "";
    if (!email) { errEl.textContent = "Type your email first, then tap Forgot password."; form.email.focus(); return; }
    busy(true);
    try { await api.resetPassword(email); busy(false); okEl.textContent = "Check your email for a link to reset your password."; } catch (e) { fail(e); }
  };
}

// ---------- the account card on the Profile screen ----------

function fillCard() {
  const slot = document.getElementById("yami-account");
  if (!slot || !user || slot.dataset.uid === user.uid) return;
  slot.dataset.uid = user.uid;
  slot.innerHTML = '<div class="yacard"><span><b>Your account</b><small></small></span><button type="button">Sign out</button></div>';
  slot.querySelector("small").textContent = user.email || "Signed in with Apple";
  slot.querySelector("button").onclick = signOut;
}

// ---------- start ----------

async function start() {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  if (qs.has("start")) { del("yami-meals"); del("yami-board"); }
  if (!cfg.apiKey && !fake) return boot(); // accounts not set up yet: phone-only, like before

  showWait();
  try {
    api = fake ? fakeApi() : await firebaseApi();
  } catch (e) {
    console.warn("Yami could not load sign-in", e);
    if (get("yami-uid")) return boot(); // offline with this phone's last copy
    return showError("We couldn't reach the sign-in service. Check your connection and try again.", () => location.reload());
  }
  new MutationObserver(fillCard).observe(document.body, { childList: true, subtree: true });
  api.onUser((u) => {
    if (started) { if (!u) location.reload(); return; }
    if (u) { showWait(); hydrate(u); } else showSignIn();
  });
}

if (window.__yamiStarted) {
  // The fallback timer already started the app without accounts; just keep meals on the phone.
} else {
  start();
}
