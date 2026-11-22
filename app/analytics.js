// Yami usage stats (Google Analytics 4, through the Yami Firebase project).
//
// What it records: which screen is open (a tab, or a feature sheet like "Log a meal" or
// "Ask Yami") and for how long. Nothing typed, no meals, no names or emails.
// Report: Firebase console > Analytics > Pages and screens (or analytics.google.com),
// where each screen shows as "Yami: <screen>" with its average engagement time.
//
// Turned on by measurementId in firebase-config.js. Off on localhost unless the URL has ?ga.
// account.js loads this file, so app/index.html needs no changes.
(function () {
  var F = window.YAMI_FIREBASE || {};
  var ID = F.measurementId;
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (!ID || (local && !/[?&]ga\b/.test(location.search))) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ID);
  document.head.appendChild(s);
  gtag('js', new Date());
  gtag('config', ID, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, debug_mode: local });

  // Tabs: the bottom bar marks the open tab with aria-current="page".
  var TABS = { Home: 'Home', Groceries: 'Groceries', 'Order Smart': 'Order Smart', Dashboard: 'Dashboard' };
  // Sheets whose label is fixed. Any other dialog (a food's own name, "Edit ...") is grouped.
  var SHEETS = {
    'Log a meal': 'Log a meal', 'Ask Yami': 'Ask Yami', 'Choose your stats': 'Choose your stats',
    'Meal of the week': 'Meal of the week', 'Pick your groceries with Yami': 'Grocery helper',
    'Add widgets': 'Add widgets', 'Your grocery cart': 'Grocery cart', 'Order this list online': 'Order groceries online',
    'Order smart': 'Order Smart picks', 'Scan a receipt': 'Scan a receipt', 'Welcome to Yami': 'Onboarding'
  };

  function visible(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.05;
  }

  function screen() {
    // Sign-in and onboarding come before the app itself.
    var gate = document.getElementById('yacct');
    if (gate && visible(gate)) return 'Sign in';
    var ob = document.querySelector('.ob-body');
    if (ob && visible(ob)) return 'Onboarding';
    var badges = document.querySelector('.ybp');
    if (badges && visible(badges)) return 'Badges';
    var ds = document.querySelectorAll('[role="dialog"]');
    for (var i = ds.length - 1; i >= 0; i--) {
      var d = ds[i];
      if (!visible(d)) continue;
      var lab = (d.getAttribute('aria-label') || '').trim();
      if (SHEETS[lab]) return SHEETS[lab];
      if (/^Edit /.test(lab)) return 'Edit a meal';
      if (/ breakdown$/.test(lab) || (d.parentElement && d.parentElement.classList.contains('sheet'))) return 'Stat breakdown';
      if (/^Your list on /.test(lab)) return 'Order groceries online';
      return lab ? 'Food detail' : 'Pop-up';
    }
    var cur = document.querySelector('nav button[aria-current="page"], button[aria-current="page"][aria-label]');
    if (cur) {
      var t = cur.getAttribute('aria-label');
      if (TABS[t]) return TABS[t];
      if (t === 'Log a meal') return 'Log a meal';
    }
    return null;
  }

  var last = null, since = Date.now();
  function slug(n) { return n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function report(name) {
    var secs = Math.round((Date.now() - since) / 1000);
    if (last && secs >= 1) gtag('event', 'screen_time', { screen: last, seconds: Math.min(secs, 1800) });
    last = name; since = Date.now();
    if (name) gtag('event', 'page_view', {
      page_title: 'Yami: ' + name,
      page_location: location.origin + '/app/#' + slug(name),
      page_path: '/app/#' + slug(name)
    });
  }
  function check() {
    if (document.hidden) return;
    var n = screen();
    if (n && n !== last) report(n);
  }
  setInterval(check, 1000);
  document.addEventListener('click', function () { setTimeout(check, 350); }, true);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && last) {
      var secs = Math.round((Date.now() - since) / 1000);
      if (secs >= 1) gtag('event', 'screen_time', { screen: last, seconds: Math.min(secs, 1800) });
      since = Date.now();
    } else if (!document.hidden) { since = Date.now(); }
  });
})();
