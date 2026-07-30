(function () {
  "use strict";

  var STORAGE_KEY = "tefillin-app-state-v1";

  var defaultState = {
    profile: { name: "ישראל ישראלי", weeklyFrequency: null, goal: null, birthday: null },
    onboardingComplete: false,
    nusach: null,
    reminderEnabled: true,
    reminderTime: "08:30",
    commitStart: "06:15",
    commitEnd: "20:07",
    useSunset: false,
    lat: null,
    lon: null,
    darkMode: false,
    log: {}, // { "YYYY-MM-DD": "HH:MM" }
    coins: 0,
    purchasedTierIndex: 0,
    coinLog: {}, // { "YYYY-MM-DD": true } - dedup guard so daily coins are only ever awarded once per date
    lastStreakSeen: 0,
    weeklyMilestonesAwarded: 0,
    textStyle: { font: "default", color: "navy" },
    notifications: [] // { id, message, createdAt, read }
  };

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(defaultState));
      var parsed = JSON.parse(raw);
      return Object.assign({}, defaultState, parsed, {
        log: parsed.log || {},
        coinLog: parsed.coinLog || {},
        notifications: parsed.notifications || []
      });
    } catch (e) {
      return JSON.parse(JSON.stringify(defaultState));
    }
  }

  function saveState() {
    state.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    pushStateToCloud();
  }

  var state = loadState();

  function todayKey(d) {
    d = d || new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  function nowHHMM() {
    var d = new Date();
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  // ---------- Sunset calculation (Almanac for Computers 1990 algorithm) ----------
  function dayOfYear(date) {
    var start = new Date(date.getFullYear(), 0, 0);
    return Math.floor((date - start) / 86400000);
  }

  function normalizeRange(value, max) {
    while (value < 0) value += max;
    while (value >= max) value -= max;
    return value;
  }

  function calculateSunset(date, lat, lon) {
    var toRad = Math.PI / 180;
    var toDeg = 180 / Math.PI;
    var zenith = 90.8333;

    var N = dayOfYear(date);
    var lngHour = lon / 15;
    var t = N + ((18 - lngHour) / 24);

    var M = (0.9856 * t) - 3.289;
    var Mrad = M * toRad;
    var L = M + (1.916 * Math.sin(Mrad)) + (0.020 * Math.sin(2 * Mrad)) + 282.634;
    L = normalizeRange(L, 360);
    var Lrad = L * toRad;

    var RA = toDeg * Math.atan(0.91764 * Math.tan(Lrad));
    RA = normalizeRange(RA, 360);
    var Lquadrant = Math.floor(L / 90) * 90;
    var RAquadrant = Math.floor(RA / 90) * 90;
    RA = (RA + (Lquadrant - RAquadrant)) / 15;

    var sinDec = 0.39782 * Math.sin(Lrad);
    var cosDec = Math.cos(Math.asin(sinDec));
    var cosH = (Math.cos(zenith * toRad) - (sinDec * Math.sin(lat * toRad))) /
      (cosDec * Math.cos(lat * toRad));

    if (cosH > 1 || cosH < -1) return null;

    var H = toDeg * Math.acos(cosH);
    H = H / 15;

    var T = H + RA - (0.06571 * t) - 6.622;
    var UT = normalizeRange(T - lngHour, 24);

    var localOffsetHours = -date.getTimezoneOffset() / 60;
    var localT = normalizeRange(UT + localOffsetHours, 24);

    var hours = Math.floor(localT);
    var minutes = Math.round((localT - hours) * 60);
    if (minutes === 60) { minutes = 0; hours = (hours + 1) % 24; }
    return pad(hours) + ":" + pad(minutes);
  }

  function getDeadlineTime() {
    if (state.useSunset && state.lat != null && state.lon != null) {
      var sunset = calculateSunset(new Date(), state.lat, state.lon);
      if (sunset) return sunset;
    }
    return state.commitEnd;
  }

  // ---------- Navigation ----------
  var screens = {
    onboarding: document.getElementById("screen-onboarding"),
    home: document.getElementById("screen-home"),
    reminders: document.getElementById("screen-reminders"),
    stats: document.getElementById("screen-stats"),
    settings: document.getElementById("screen-settings"),
    nusach: document.getElementById("screen-nusach"),
    shop: document.getElementById("screen-shop"),
    textstyle: document.getElementById("screen-textstyle"),
    prayer: document.getElementById("screen-prayer")
  };

  var navBtns = document.querySelectorAll(".bottom-nav .nav-btn");
  var bottomNav = document.querySelector(".bottom-nav");

  function showScreen(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].classList.toggle("hidden", key !== name);
    });
    navBtns.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.nav === name);
    });
    bottomNav.classList.toggle("hidden", name === "prayer" || name === "onboarding" || name === "nusach" || name === "shop" || name === "textstyle");
    document.getElementById("coin-badge").classList.toggle("hidden", name === "onboarding");
    document.getElementById("lay-fab").classList.toggle("hidden",
      name === "home" || name === "onboarding" || name === "nusach" || name === "prayer" || name === "textstyle");
    if (name === "stats") renderStats();
    if (name === "settings") renderSettings();
    if (name === "reminders") renderReminders();
    if (name === "shop") renderShop();
    if (name === "prayer") {
      renderBlessingCard();
      renderPrayerSections();
      var prayerContent = screens.prayer.querySelector(".content");
      if (prayerContent) prayerContent.scrollTop = 0;
    }
  }

  document.querySelectorAll("[data-nav]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      var target = el.dataset.nav;
      if (!target || target === "none") return;
      e.preventDefault();
      showScreen(target);
    });
  });

  // ---------- Prayer text rendering ----------
  // The full liturgical text lives in js/prayers.js, generated from the Sefaria
  // API (CC-BY, the Metsudah siddur) rather than written by hand - so each nusach
  // is complete and accurate. Regenerate with scripts/build-prayers.js.
  var SEFARIA_BASE = "https://www.sefaria.org/";

  // state.nusach values -> keys in window.PRAYERS.byNusach
  var PRAYER_SET_BY_NUSACH = {
    ashkenazi: "ashkenazi",
    sephardi: "sephardi",
    moroccan: "mizrachi",
    mizrachi: "mizrachi"
  };

  var SECTION_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v17"/><path d="M12 5c-1 3-4 4-6 3.5 0 5.5 1 9.5 6 13"/><path d="M12 5c1 3 4 4 6 3.5 0 5.5-1 9.5-6 13"/></svg>';

  var prayerSectionsEl = document.getElementById("prayer-sections");
  var prayerJumpMenuEl = document.getElementById("prayer-jump-menu");
  var siddurCreditEl = document.getElementById("siddur-credit");
  var siddurNoticeNusachEl = document.getElementById("siddur-notice-nusach");

  function prayerSections() {
    if (!window.PRAYERS || !window.PRAYERS.byNusach) return [];
    var key = PRAYER_SET_BY_NUSACH[state.nusach] || "ashkenazi";
    return window.PRAYERS.byNusach[key] || [];
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function refToUrl(ref) {
    return SEFARIA_BASE + encodeURI(String(ref || "").replace(/ /g, "_"));
  }

  function firstSpokenLine(section) {
    for (var i = 0; i < section.blocks.length; i++) {
      var lines = section.blocks[i].lines;
      for (var j = 0; j < lines.length; j++) {
        if (!lines[j].n) return lines[j].t;
      }
    }
    return "";
  }

  function buildSectionHtml(section) {
    var preview = firstSpokenLine(section);
    if (preview.length > 55) preview = preview.slice(0, 55).replace(/\S*$/, "").trim() + "...";

    var body = section.blocks.map(function (block) {
      var inner = block.lines.map(function (l) {
        return l.n
          ? '<p class="prayer-line-note">' + escapeHtml(l.t) + "</p>"
          : '<p class="prayer-line-body">' + escapeHtml(l.t) + "</p>";
      }).join("");
      var name = section.blocks.length > 1
        ? '<p class="block-name">' + escapeHtml(block.name) + "</p>"
        : "";
      return '<div class="prayer-block">' + name + inner + "</div>";
    }).join("");

    return '<div class="card prayer-card expandable" id="section-' + section.id + '">' +
      '<div class="prayer-card-head">' +
        '<span class="book-icon">' + SECTION_ICON + "</span>" +
        '<span class="prayer-card-title">' + escapeHtml(section.title) + "</span>" +
        '<span class="prayer-toggle">הצג הכל ⌄</span>' +
      "</div>" +
      '<p class="prayer-line-main">' + escapeHtml(preview) + "</p>" +
      '<div class="prayer-full hidden">' + body + "</div>" +
      '<a class="siddur-link" href="' + refToUrl(section.ref) + '" target="_blank" rel="noopener">פתיחה בסידור המלא ›</a>' +
      "</div>";
  }

  function renderJumpMenu(sections) {
    var html = '<button class="prayer-jump-item" data-target="section-start">להתחלה</button>';
    html += sections.map(function (s) {
      return '<button class="prayer-jump-item" data-target="section-' + s.id + '">' +
        escapeHtml(s.title) + "</button>";
    }).join("");
    prayerJumpMenuEl.innerHTML = html;
  }

  function renderSiddurCredit() {
    var src = (window.PRAYERS && window.PRAYERS.source) || null;
    if (siddurCreditEl) {
      siddurCreditEl.textContent = src
        ? "טקסט התפילה: " + src.name + " (" + src.license + ") דרך ספריא"
        : "";
    }
    if (siddurNoticeNusachEl) {
      siddurNoticeNusachEl.textContent = "נוסח " + (NUSACH_LABELS[state.nusach] || "אשכנזי");
    }
  }

  function renderPrayerSections() {
    if (!prayerSectionsEl) return;
    var sections = prayerSections();
    prayerSectionsEl.innerHTML = sections.map(buildSectionHtml).join("");
    renderJumpMenu(sections);
    renderSiddurCredit();
  }


  // ---------- Nusach-aware tefillin blessing ----------
  var BLESSING_ASHKENAZI_HTML =
    '<p class="blessing-step-label">בהנחת תפילין של יד</p>' +
    '<p class="prayer-line-body blessing-text">' +
      'בָּרוּךְ אַתָּה יְהֹוָה אֱלֹהֵינוּ מֶלֶךְ הָעוֹלָם, אֲשֶׁר קִדְּשָׁנוּ ' +
      'בְּמִצְוֹתָיו וְצִוָּנוּ לְהָנִיחַ תְּפִלִּין:' +
    '</p>' +
    '<p class="blessing-step-label">בהנחת תפילין של ראש</p>' +
    '<p class="prayer-line-body blessing-text">' +
      'בָּרוּךְ אַתָּה יְהֹוָה אֱלֹהֵינוּ מֶלֶךְ הָעוֹלָם, אֲשֶׁר קִדְּשָׁנוּ ' +
      'בְּמִצְוֹתָיו וְצִוָּנוּ עַל מִצְוַת תְּפִלִּין:' +
    '</p>' +
    '<p class="prayer-line-note">(בלחש: ברוך שם כבוד מלכותו לעולם ועד)</p>';

  // Sephardi / Moroccan / Edot HaMizrach: one combined blessing covering both
  // hand and head tefillin, no second blessing, no quiet "ברוך שם" pause.
  var BLESSING_COMBINED_HTML =
    '<p class="blessing-step-label">בהנחת תפילין (יד וראש)</p>' +
    '<p class="prayer-line-body blessing-text">' +
      'בָּרוּךְ אַתָּה יְהֹוָה אֱלֹהֵינוּ מֶלֶךְ הָעוֹלָם, אֲשֶׁר קִדְּשָׁנוּ ' +
      'בְּמִצְוֹתָיו וְצִוָּנוּ לְהָנִיחַ תְּפִלִּין:' +
    '</p>';

  var BLESSING_HTML_BY_NUSACH = {
    ashkenazi: BLESSING_ASHKENAZI_HTML,
    sephardi: BLESSING_COMBINED_HTML,
    moroccan: BLESSING_COMBINED_HTML,
    mizrachi: BLESSING_COMBINED_HTML
  };

  var blessingBodyEl = document.getElementById("blessing-body");

  function renderBlessingCard() {
    if (!blessingBodyEl) return;
    blessingBodyEl.innerHTML = BLESSING_HTML_BY_NUSACH[state.nusach] || BLESSING_ASHKENAZI_HTML;
  }

  // Delegated: the prayer cards are rebuilt on every visit to the prayer screen,
  // so per-element listeners would be lost on re-render.
  screens.prayer.addEventListener("click", function (e) {
    var head = e.target.closest(".expandable .prayer-card-head");
    if (!head) return;
    var card = head.closest(".prayer-card");
    var full = card.querySelector(".prayer-full");
    var toggle = head.querySelector(".prayer-toggle");
    if (!full || !toggle) return;
    var isHidden = full.classList.contains("hidden");
    full.classList.toggle("hidden", !isHidden);
    toggle.textContent = isHidden ? "הסתר ⌃" : "הצג הכל ⌄";
    if (isHidden) card.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ---------- Toast ----------
  var toastEl = document.getElementById("toast");
  var toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 2200);
  }

  // ---------- Notifications & celebrations ----------
  var CONFETTI_COLORS = ["#154a78", "#c9971f", "#7a1f2b", "#3a5a40", "#e8e2d0"];
  var confettiLayerEl = document.getElementById("confetti-layer");
  var notifSheetEl = document.getElementById("notif-sheet");
  var notifListEl = document.getElementById("notif-list");
  var appReady = false;

  function renderNotifBadges() {
    var unread = state.notifications.filter(function (n) { return !n.read; }).length;
    document.querySelectorAll(".badge-dot").forEach(function (dot) {
      dot.classList.toggle("hidden", unread === 0);
      dot.textContent = unread > 9 ? "9+" : (unread > 1 ? String(unread) : "");
    });
  }

  function showCelebration() {
    for (var i = 0; i < 28; i++) {
      var piece = document.createElement("div");
      piece.className = "confetti-piece";
      piece.style.left = Math.random() * 100 + "%";
      piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      piece.style.animationDelay = (Math.random() * 0.3) + "s";
      piece.style.borderRadius = (Math.random() > 0.5 ? "50%" : "2px");
      confettiLayerEl.appendChild(piece);
      (function (el) {
        setTimeout(function () { el.remove(); }, 2200);
      })(piece);
    }
  }

  function pushNotification(message) {
    var notif = { id: Date.now() + "-" + Math.random(), message: message, createdAt: new Date().toISOString(), read: false };
    state.notifications.push(notif);
    saveState();
    renderNotifBadges();
    if (appReady) showCelebration();
  }

  function renderNotifList() {
    if (!state.notifications.length) {
      notifListEl.innerHTML = '<div class="notif-empty">אין עדיין התראות</div>';
      return;
    }
    var items = state.notifications.slice().reverse();
    notifListEl.innerHTML = items.map(function (n) {
      var d = new Date(n.createdAt);
      var timeStr = pad(d.getHours()) + ":" + pad(d.getMinutes());
      return '<div class="notif-item"><div class="notif-item-message">' + n.message + '</div><div class="notif-item-time">' + timeStr + '</div></div>';
    }).join("");
  }

  function openNotifSheet() {
    renderNotifList();
    notifSheetEl.classList.remove("hidden");
    state.notifications.forEach(function (n) { n.read = true; });
    saveState();
    renderNotifBadges();
  }

  function closeNotifSheet() {
    notifSheetEl.classList.add("hidden");
  }

  document.querySelectorAll(".notif-bell-btn").forEach(function (btn) {
    btn.addEventListener("click", openNotifSheet);
  });
  document.getElementById("notif-close").addEventListener("click", closeNotifSheet);
  document.getElementById("notif-sheet-backdrop").addEventListener("click", closeNotifSheet);

  // ---------- Coin badge ----------
  var coinBadgeEl = document.getElementById("coin-badge");
  var coinBalanceEl = document.getElementById("coin-balance");
  var displayedCoins = state.coins;

  function tweenCoinDisplay(from, to) {
    var duration = 600;
    var startTime = null;
    var done = false;
    coinBalanceEl.classList.remove("pulse");
    void coinBalanceEl.offsetWidth;
    coinBalanceEl.classList.add("pulse");
    function finish() {
      if (done) return;
      done = true;
      coinBalanceEl.textContent = to;
    }
    function step(ts) {
      if (done) return;
      if (!startTime) startTime = ts;
      var progress = Math.min(1, (ts - startTime) / duration);
      coinBalanceEl.textContent = Math.round(from + (to - from) * progress);
      if (progress < 1) requestAnimationFrame(step);
      else finish();
    }
    requestAnimationFrame(step);
    // Safety net: rAF is throttled/paused on hidden/backgrounded tabs, so guarantee
    // the final correct value lands even if the smooth animation never completes.
    setTimeout(finish, duration + 300);
  }

  function renderCoinBadge(animate) {
    if (animate && displayedCoins !== state.coins) {
      tweenCoinDisplay(displayedCoins, state.coins);
    } else {
      coinBalanceEl.textContent = state.coins;
    }
    displayedCoins = state.coins;
  }

  // ---------- Home screen ----------
  var greetingEl = document.getElementById("greeting-text");
  var statusEl = document.getElementById("status-text");
  var layBtn = document.getElementById("lay-btn");
  var layBtnLabel = document.getElementById("lay-btn-label");
  var layBtnArrow = document.getElementById("lay-btn-arrow");
  var levelProgressCurrentEl = document.getElementById("level-progress-current");
  var stageTrackerEl = document.getElementById("stage-tracker");
  var stageSummaryEl = document.getElementById("stage-summary");
  var nextGoalTextEl = document.getElementById("next-goal-text");
  var levelProgressNextEl = document.getElementById("level-progress-next");

  // ---------- Devotion level tiers (purchased with coins) ----------
  var TIER_ICON_SHUL =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M4 21V10l8-6 8 6v11"/><path d="M9 21v-7M12 21v-7M15 21v-7"/></svg>';
  var TIER_ICON_SUN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v2.5M12 18.5V21M21 12h-2.5M5.5 12H3M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7M18.4 18.4l-1.7-1.7M7.3 7.3 5.6 5.6"/></svg>';
  var TIER_ICON_BOOK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6c-1.5-1.2-4-1.8-7-1.8v13.6c3 0 5.5.6 7 1.8"/><path d="M12 6c1.5-1.2 4-1.8 7-1.8v13.6c-3 0-5.5.6-7 1.8"/><path d="M12 6v13.6"/></svg>';
  var TIER_ICON_CAP =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2 9l10 5 10-5-10-5Z"/><path d="M6 11.5V17c0 1.5 2.5 3 6 3s6-1.5 6-3v-5.5"/></svg>';
  var TIER_ICON_SCALES =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v17M8 20h8"/><path d="M4 7h6M14 7h6"/><path d="M4 7 1.5 12a2.7 2.7 0 0 0 5 0L4 7Z"/><path d="M20 7 17.5 12a2.7 2.7 0 0 0 5 0L20 7Z"/></svg>';
  var TIER_ICON_SPARKLE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></svg>';
  var TIER_ICON_CROWN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18h16M4.5 18 3 8l5 4 4-6 4 6 5-4-1.5 10"/></svg>';

  var LEVEL_TIERS = [
    { name: "בית הכנסת", flavor: "הולך לבית כנסת עם כיפה בשבת", price: 0, icon: TIER_ICON_SHUL },
    { name: "שחרית", flavor: "הולך להתפלל שחרית כל בוקר", price: 500, icon: TIER_ICON_SUN },
    { name: "לומד תורה", flavor: "קביעת עיתים לתורה", price: 1000, icon: TIER_ICON_BOOK },
    { name: "חכם", flavor: "מרביץ תורה ומלמד אחרים", price: 2500, icon: TIER_ICON_CAP },
    { name: "מועמד לרשות הסנהדרין", flavor: "מנהיגות רוחנית עליונה", price: 5000, icon: TIER_ICON_SCALES },
    { name: "מטאור", flavor: "כוכב זורח, נדיר ומאיר דרך לאחרים", price: 10000, icon: TIER_ICON_SPARKLE },
    { name: "רבינו הגדול", flavor: "פסגת המסע הרוחני", price: 25000, icon: TIER_ICON_CROWN }
  ];

  function getCurrentTier() { return LEVEL_TIERS[state.purchasedTierIndex]; }
  function getNextTier() { return LEVEL_TIERS[state.purchasedTierIndex + 1] || null; }

  function renderStageTracker() {
    var html = '<div class="stage-rail"></div>';
    LEVEL_TIERS.forEach(function (tier, i) {
      var owned = i <= state.purchasedTierIndex;
      var isNext = i === state.purchasedTierIndex + 1;
      var stateClass = owned ? "owned" : (isNext ? "next" : "");
      var inner = owned ? tier.icon : (i + 1);
      html += '<div class="stage-circle-wrap"><div class="stage-circle ' + stateClass + '">' + inner + '</div></div>';
    });
    stageTrackerEl.innerHTML = html;
  }

  function renderLevelProgress() {
    var current = getCurrentTier();
    var next = getNextTier();
    levelProgressCurrentEl.textContent = current.name;
    renderStageTracker();

    var achieved = state.purchasedTierIndex + 1;
    var total = LEVEL_TIERS.length;
    var percent = Math.round((achieved / total) * 100);
    stageSummaryEl.textContent = achieved + "/" + total + " דרגות הושגו · " + percent + "%";

    if (next) {
      nextGoalTextEl.textContent = "היעד הבא: " + next.name;
      var missing = Math.max(0, next.price - state.coins);
      levelProgressNextEl.textContent = missing > 0
        ? "עוד " + missing + " מטבעות לדרגת " + next.name
        : "יש לך מספיק מטבעות לדרגת " + next.name + " - עברו לחנות";
    } else {
      nextGoalTextEl.textContent = "הגעת לדרגה הגבוהה ביותר!";
      levelProgressNextEl.textContent = "כל הכבוד, סיימת את כל המסע!";
    }
  }

  var DAILY_TIPS = [
    "הנחת תפילין מחברת אותנו למקור הכוח שלנו, וממשרת את הלב והמוח למטרה אחת קדושה.",
    "תפילין נקראות \"פאר\" - העיטור היומי של יהודי המניח אותן באהבה.",
    "מצוות תפילין נוהגת בכל יום חול, ומזכירה לנו את הקשר התמידי בינינו לבין בוראנו.",
    "תפילין של יד כנגד הלב, תפילין של ראש כנגד המוח - לשעבד את הרגש והשכל לעבודת ה'.",
    "כל זמן שהתפילין על ראשו ועל זרועו של אדם - הוא עניו וירא שמים, כדברי הרמב\"ם.",
    "גם הנחה של דקות ספורות בבוקר עמוס שווה יותר מוויתור מוחלט. אל תוותרו, גם ביום קשה.",
    "התמדה קטנה, יום אחרי יום, בונה הרגל של קדושה לכל החיים.",
    "תפילין נקראות \"אות\" - סימן וברית בינינו לבין הקב\"ה.",
    "לפני התפילה, קחו רגע לכוון את הלב - התפילין מזכירות לנו למה אנחנו כאן.",
    "כל יום שמניחים בו תפילין הוא הזדמנות חדשה להתחבר מחדש."
  ];

  function getDailyTip() {
    var d = new Date();
    var start = new Date(d.getFullYear(), 0, 0);
    var dayOfYear = Math.floor((d - start) / 86400000);
    return DAILY_TIPS[dayOfYear % DAILY_TIPS.length];
  }

  function renderDailyTip() {
    document.getElementById("daily-tip-text").textContent = "\"" + getDailyTip() + "\"";
  }

  function greetingForHour(h) {
    if (h < 5) return "לילה טוב";
    if (h < 12) return "בוקר טוב";
    if (h < 17) return "צהריים טובים";
    if (h < 21) return "ערב טוב";
    return "לילה טוב";
  }

  function renderHome() {
    var hour = new Date().getHours();
    greetingEl.textContent = greetingForHour(hour);
    renderDailyTip();

    var laidToday = !!state.log[todayKey()];
    layBtn.disabled = laidToday;
    document.getElementById("lay-fab").disabled = laidToday;
    document.getElementById("lay-fab").classList.toggle("done", laidToday);
    if (laidToday) {
      statusEl.innerHTML = "כל הכבוד! הנחתם תפילין היום בשעה " +
        "<span id=\"target-time\">" + state.log[todayKey()] + "</span>.";
      layBtn.classList.add("done");
      layBtnLabel.textContent = "הונחו היום";
      layBtnArrow.textContent = "✓";
    } else {
      statusEl.innerHTML = "זמן הנחת תפילין עד השעה " +
        "<span id=\"target-time\">" + getDeadlineTime() + "</span>. האם כבר הנחתם?";
      layBtn.classList.remove("done");
      layBtnLabel.textContent = "הנח תפילין";
      layBtnArrow.textContent = "◂";
    }

    renderLevelProgress();
  }

  function handleLayAction() {
    var key = todayKey();
    if (state.log[key]) return;
    if (!state.nusach) {
      openNusachPicker("home");
      return;
    }
    openTextStyleStep();
  }

  layBtn.addEventListener("click", handleLayAction);
  document.getElementById("lay-fab").addEventListener("click", handleLayAction);

  document.getElementById("prayer-close").addEventListener("click", function () {
    showScreen("home");
  });

  // ---------- Prayer jump menu ----------
  var prayerJumpBtn = document.getElementById("prayer-jump-btn");
  var prayerJumpMenu = document.getElementById("prayer-jump-menu");

  prayerJumpBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    prayerJumpMenu.classList.toggle("hidden");
  });

  // Delegated: jump items are rebuilt per nusach on each prayer-screen render.
  prayerJumpMenu.addEventListener("click", function (e) {
    var btn = e.target.closest(".prayer-jump-item");
    if (!btn) return;
    var target = document.getElementById(btn.dataset.target);
    prayerJumpMenu.classList.add("hidden");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.addEventListener("click", function (e) {
    if (!prayerJumpMenu.classList.contains("hidden") && !prayerJumpMenu.contains(e.target) && e.target !== prayerJumpBtn && !prayerJumpBtn.contains(e.target)) {
      prayerJumpMenu.classList.add("hidden");
    }
  });

  document.getElementById("confirm-lay-btn").addEventListener("click", function () {
    var key = todayKey();
    state.log[key] = nowHHMM();

    var toastMsg = "הנחת בהצלחה! 🙏 +50 מטבעות";
    if (!state.coinLog[key]) {
      state.coinLog[key] = true;
      state.coins += 50;

      var streak = computeStreak();
      if (streak < state.lastStreakSeen) state.weeklyMilestonesAwarded = 0;
      state.lastStreakSeen = streak;

      var milestone = Math.floor(streak / 7);
      if (milestone > 0 && milestone > state.weeklyMilestonesAwarded) {
        var bonus = 10 * milestone;
        state.coins += bonus;
        state.weeklyMilestonesAwarded = milestone;
        toastMsg = "הנחת בהצלחה! 🙏 +50 מטבעות ובונוס שבועי של +" + bonus + "!";
        pushNotification("השלמת " + milestone + " שבועות רצוף! קיבלת בונוס של +" + bonus + " מטבעות 🎉");
      }
    }

    saveState();
    renderHome();
    renderCoinBadge(true);
    showScreen("home");
    showToast(toastMsg);
  });

  // ---------- Nusach picker ----------
  var NUSACH_LABELS = {
    ashkenazi: "אשכנזי",
    sephardi: "ספרדי",
    moroccan: "מרוקאי",
    mizrachi: "עדות המזרח"
  };

  var nusachOpenedFrom = "home";

  function openNusachPicker(openedFrom) {
    nusachOpenedFrom = openedFrom || "home";
    showScreen("nusach");
  }

  document.getElementById("nusach-close").addEventListener("click", function () {
    showScreen(nusachOpenedFrom);
  });

  document.querySelectorAll(".nusach-option").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.nusach = btn.dataset.nusach;
      saveState();
      if (nusachOpenedFrom === "settings") {
        renderSettings();
        showScreen("settings");
      } else {
        openTextStyleStep();
      }
    });
  });

  document.getElementById("nusach-settings-row").addEventListener("click", function () {
    openNusachPicker("settings");
  });

  // ---------- Text style (before prayer) ----------
  var textStyleFontBtns = document.querySelectorAll("#font-picker .font-option");
  var textStyleColorBtns = document.querySelectorAll("#color-picker .color-swatch");
  var textStylePreview = document.getElementById("textstyle-preview");
  var textStylePendingFont = "default";
  var textStylePendingColor = "navy";

  function renderTextStylePreview() {
    textStylePreview.className = "card textstyle-preview style-font-" + textStylePendingFont + " style-color-" + textStylePendingColor;
  }

  function openTextStyleStep() {
    textStylePendingFont = state.textStyle.font;
    textStylePendingColor = state.textStyle.color;
    textStyleFontBtns.forEach(function (b) {
      b.classList.toggle("selected", b.getAttribute("data-font") === textStylePendingFont);
    });
    textStyleColorBtns.forEach(function (b) {
      b.classList.toggle("selected", b.getAttribute("data-color") === textStylePendingColor);
    });
    renderTextStylePreview();
    showScreen("textstyle");
  }

  function applyTextStyleToPrayerScreen() {
    screens.prayer.className = "screen hidden style-font-" + state.textStyle.font + " style-color-" + state.textStyle.color;
  }

  textStyleFontBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      textStylePendingFont = btn.getAttribute("data-font");
      textStyleFontBtns.forEach(function (b) { b.classList.remove("selected"); });
      btn.classList.add("selected");
      renderTextStylePreview();
    });
  });

  textStyleColorBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      textStylePendingColor = btn.getAttribute("data-color");
      textStyleColorBtns.forEach(function (b) { b.classList.remove("selected"); });
      btn.classList.add("selected");
      renderTextStylePreview();
    });
  });

  document.getElementById("textstyle-close").addEventListener("click", function () {
    showScreen("home");
  });

  document.getElementById("textstyle-continue-btn").addEventListener("click", function () {
    state.textStyle = { font: textStylePendingFont, color: textStylePendingColor };
    saveState();
    applyTextStyleToPrayerScreen();
    showScreen("prayer");
  });

  // ---------- Shop ----------
  var shopTierListEl = document.getElementById("shop-tier-list");

  var COIN_ICON_SVG = '<span class="coin-emoji coin-emoji-inline">🪙</span>';
  var CHECK_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>';
  var LOCK_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="9" rx="1.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>';

  function renderShop() {
    var html = "";
    LEVEL_TIERS.forEach(function (tier, i) {
      var owned = i <= state.purchasedTierIndex;
      var isNext = i === state.purchasedTierIndex + 1;
      var stateClass = owned ? "owned" : (isNext ? "next" : "locked");
      var priceHtml;
      if (owned) {
        priceHtml = '<span class="shop-tier-price shop-tier-owned">' + CHECK_ICON_SVG + '</span>';
      } else if (isNext) {
        var afford = state.coins >= tier.price;
        priceHtml = '<button class="shop-tier-price shop-buy-btn" data-tier-index="' + i + '"' + (afford ? "" : " disabled") + '>' + COIN_ICON_SVG + '<span>' + tier.price + '</span></button>';
      } else {
        priceHtml = '<span class="shop-tier-price shop-tier-locked">' + LOCK_ICON_SVG + '</span>';
      }
      var nameHtml = (owned || isNext) ? tier.name : "?";
      var flavorHtml = (owned || isNext) ? tier.flavor : "המשיכו להתקדם כדי לגלות את הדרגה הבאה";
      var iconHtml = (owned || isNext) ? tier.icon : LOCK_ICON_SVG;
      html += '<div class="card shop-tier-row ' + stateClass + '">' +
        '<div class="shop-tier-icon">' + iconHtml + '</div>' +
        '<div class="shop-tier-text"><div class="shop-tier-name">' + nameHtml + '</div>' +
        '<div class="shop-tier-flavor">' + flavorHtml + '</div></div>' +
        priceHtml + '</div>';
    });
    shopTierListEl.innerHTML = html;
    shopTierListEl.querySelectorAll(".shop-buy-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        purchaseTier(parseInt(btn.dataset.tierIndex, 10));
      });
    });
  }

  function purchaseTier(index) {
    var tier = LEVEL_TIERS[index];
    if (!tier || index !== state.purchasedTierIndex + 1) return;
    if (state.coins < tier.price) {
      showToast("אין מספיק מטבעות לרכישת \"" + tier.name + "\"");
      return;
    }
    state.coins -= tier.price;
    state.purchasedTierIndex = index;
    saveState();
    renderShop();
    renderCoinBadge(true);
    renderLevelProgress();
    renderSettings();
    showToast("רכשת את דרגת \"" + tier.name + "\"! 🎉");
    pushNotification("רכשת את דרגת \"" + tier.name + "\"! 🎉");
  }

  document.getElementById("shop-close").addEventListener("click", function () {
    showScreen("home");
  });

  // ---------- Onboarding ----------
  var onboardingNameInput = document.getElementById("onboarding-name-input");
  var onboardingBirthdayInput = document.getElementById("onboarding-birthday-input");
  var onboardingNextBtn = document.getElementById("onboarding-next-btn");
  var onboardingNextLabel = document.getElementById("onboarding-next-label");
  var onboardingBackBtn = document.getElementById("onboarding-back-btn");
  var onboardingStepEls = document.querySelectorAll(".onboarding-step");
  var onboardingDotEls = document.querySelectorAll("#onboarding-dots .onboarding-dot");
  var freqBtnEls = document.querySelectorAll("#freq-picker .freq-btn");
  var goalBtnEls = document.querySelectorAll("#goal-list .goal-option");

  var ONBOARDING_STEP_COUNT = onboardingStepEls.length;
  var onboardingStepIndex = 0;
  var onboardingSelectedFreq = null;
  var onboardingSelectedGoal = null;
  var onboardingReplay = false;

  function canAdvanceOnboarding() {
    if (onboardingStepIndex === 1) return !!onboardingSelectedFreq;
    if (onboardingStepIndex === 2) return !!onboardingSelectedGoal;
    return true;
  }

  function renderOnboardingStep() {
    onboardingStepEls.forEach(function (el, i) {
      el.classList.toggle("hidden", i !== onboardingStepIndex);
    });
    onboardingDotEls.forEach(function (dot, i) {
      dot.classList.toggle("active", i === onboardingStepIndex);
      dot.classList.toggle("done", i < onboardingStepIndex);
    });
    var showBack = onboardingReplay || onboardingStepIndex > 0;
    onboardingBackBtn.classList.toggle("hidden", !showBack);
    onboardingBackBtn.textContent = (onboardingReplay && onboardingStepIndex === 0) ? "ביטול" : "חזרה";
    onboardingNextLabel.textContent = onboardingStepIndex === ONBOARDING_STEP_COUNT - 1 ? "סיום" : "המשך";
    onboardingNextBtn.disabled = !canAdvanceOnboarding();
  }

  freqBtnEls.forEach(function (btn) {
    btn.addEventListener("click", function () {
      onboardingSelectedFreq = btn.getAttribute("data-value");
      freqBtnEls.forEach(function (b) { b.classList.remove("selected"); });
      btn.classList.add("selected");
      renderOnboardingStep();
    });
  });

  goalBtnEls.forEach(function (btn) {
    btn.addEventListener("click", function () {
      onboardingSelectedGoal = btn.getAttribute("data-value");
      goalBtnEls.forEach(function (b) { b.classList.remove("selected"); });
      btn.classList.add("selected");
      renderOnboardingStep();
    });
  });

  function startOnboardingReplay() {
    onboardingReplay = true;
    onboardingStepIndex = 0;
    onboardingSelectedFreq = state.profile.weeklyFrequency ? String(state.profile.weeklyFrequency) : null;
    onboardingSelectedGoal = state.profile.goal || null;
    onboardingNameInput.value = state.profile.name || "";
    onboardingBirthdayInput.value = state.profile.birthday || "";
    freqBtnEls.forEach(function (b) {
      b.classList.toggle("selected", b.getAttribute("data-value") === onboardingSelectedFreq);
    });
    goalBtnEls.forEach(function (b) {
      b.classList.toggle("selected", b.getAttribute("data-value") === onboardingSelectedGoal);
    });
    renderOnboardingStep();
    showScreen("onboarding");
  }

  document.getElementById("onboarding-settings-row").addEventListener("click", startOnboardingReplay);

  function completeOnboarding() {
    var typed = onboardingNameInput.value.trim();
    state.profile.name = typed || defaultState.profile.name;
    state.profile.weeklyFrequency = onboardingSelectedFreq ? Number(onboardingSelectedFreq) : null;
    state.profile.goal = onboardingSelectedGoal;
    state.profile.birthday = onboardingBirthdayInput.value || null;
    var wasReplay = onboardingReplay;
    if (!wasReplay) {
      state.coins += 150; // 100 starting + 50 first-week bonus
    }
    state.onboardingComplete = true;
    onboardingReplay = false;
    saveState();
    renderCoinBadge();
    renderSettings();
    renderHome();
    if (wasReplay) {
      showToast("הפרטים עודכנו בהצלחה");
      showScreen("settings");
    } else {
      showScreen("home");
    }
  }

  onboardingNextBtn.addEventListener("click", function () {
    if (!canAdvanceOnboarding()) return;
    if (onboardingStepIndex === ONBOARDING_STEP_COUNT - 1) {
      completeOnboarding();
      return;
    }
    onboardingStepIndex++;
    renderOnboardingStep();
  });

  onboardingBackBtn.addEventListener("click", function () {
    if (onboardingStepIndex === 0) {
      if (onboardingReplay) {
        onboardingReplay = false;
        showScreen("settings");
      }
      return;
    }
    onboardingStepIndex--;
    renderOnboardingStep();
  });

  onboardingNameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") onboardingNextBtn.click();
  });

  renderOnboardingStep();

  // ---------- Stats ----------
  var weekRowEl = document.getElementById("week-row");
  var avgTimeEl = document.getElementById("avg-time");
  var streakCountEl = document.getElementById("streak-count");
  var monthlyRingEl = document.getElementById("monthly-ring");
  var monthlyPercentEl = document.getElementById("monthly-percent");
  var monthlyCountEl = document.getElementById("monthly-count");
  var monthlyTotalEl = document.getElementById("monthly-total");
  var MONTHLY_WINDOW_DAYS = 30;
  var compareEmptyEl = document.getElementById("compare-empty");
  var compareMarkerTodayEl = document.getElementById("compare-marker-today");
  var compareMarkerAvgEl = document.getElementById("compare-marker-avg");
  var compareMarkerTodayTimeEl = document.getElementById("compare-marker-today-time");
  var compareMarkerAvgTimeEl = document.getElementById("compare-marker-avg-time");
  var compareAxisLabelsEl = document.getElementById("compare-axis-labels");
  [4, 6, 8, 10, 12].forEach(function (h) {
    var span = document.createElement("span");
    span.textContent = pad(h) + ":00";
    compareAxisLabelsEl.appendChild(span);
  });

  var dayLetters = ["א", "ב", "ג", "ד", "ה", "ו", "ש"]; // Sun..Sat

  function computeStreak() {
    var streak = 0;
    var d = new Date();
    if (!state.log[todayKey(d)]) {
      d.setDate(d.getDate() - 1);
    }
    while (state.log[todayKey(d)]) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  function computeAverageTime() {
    var entries = Object.values(state.log);
    if (!entries.length) return "--:--";
    var totalMinutes = 0;
    entries.forEach(function (t) {
      var parts = t.split(":");
      totalMinutes += parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    });
    var avg = Math.round(totalMinutes / entries.length);
    return pad(Math.floor(avg / 60)) + ":" + pad(avg % 60);
  }

  var COMPARE_AXIS_START_MIN = 4 * 60;  // 04:00
  var COMPARE_AXIS_END_MIN = 12 * 60;   // 12:00

  function timeToMinutes(t) {
    var parts = t.split(":");
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }

  function computeLast7DaysAverageTime() {
    var d = new Date();
    var minutesList = [];
    for (var i = 1; i <= 7; i++) {
      d.setDate(d.getDate() - (i === 1 ? 0 : 1));
      var key = todayKey(d);
      if (state.log[key]) minutesList.push(timeToMinutes(state.log[key]));
    }
    if (!minutesList.length) return null;
    var total = minutesList.reduce(function (a, b) { return a + b; }, 0);
    return Math.round(total / minutesList.length);
  }

  function minutesToPercent(minutes) {
    var clamped = Math.max(COMPARE_AXIS_START_MIN, Math.min(COMPARE_AXIS_END_MIN, minutes));
    return ((clamped - COMPARE_AXIS_START_MIN) / (COMPARE_AXIS_END_MIN - COMPARE_AXIS_START_MIN)) * 100;
  }

  function minutesToHHMM(minutes) {
    return pad(Math.floor(minutes / 60)) + ":" + pad(minutes % 60);
  }

  function renderComparisonChart() {
    var todayEntry = state.log[todayKey()];
    var avgMinutes = computeLast7DaysAverageTime();

    if (!todayEntry && avgMinutes == null) {
      compareEmptyEl.classList.remove("hidden");
      compareMarkerTodayEl.classList.add("hidden");
      compareMarkerAvgEl.classList.add("hidden");
      return;
    }
    compareEmptyEl.classList.add("hidden");

    if (todayEntry) {
      var todayMinutes = timeToMinutes(todayEntry);
      compareMarkerTodayEl.classList.remove("hidden");
      compareMarkerTodayEl.style.left = minutesToPercent(todayMinutes) + "%";
      compareMarkerTodayTimeEl.textContent = todayEntry;
    } else {
      compareMarkerTodayEl.classList.add("hidden");
    }

    if (avgMinutes != null) {
      compareMarkerAvgEl.classList.remove("hidden");
      compareMarkerAvgEl.style.left = minutesToPercent(avgMinutes) + "%";
      compareMarkerAvgTimeEl.textContent = minutesToHHMM(avgMinutes);
    } else {
      compareMarkerAvgEl.classList.add("hidden");
    }
  }

  function computeMonthlyStats() {
    var laidCount = 0;
    var d = new Date();
    for (var i = 0; i < MONTHLY_WINDOW_DAYS; i++) {
      if (state.log[todayKey(d)]) laidCount++;
      d.setDate(d.getDate() - 1);
    }
    var percent = Math.round((laidCount / MONTHLY_WINDOW_DAYS) * 100);
    return { laidCount: laidCount, total: MONTHLY_WINDOW_DAYS, percent: percent };
  }

  function renderStats() {
    weekRowEl.innerHTML = "";
    var today = new Date();
    var startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());

    for (var i = 0; i < 7; i++) {
      var d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      var laid = !!state.log[todayKey(d)];
      var isToday = todayKey(d) === todayKey(today);

      var col = document.createElement("div");
      col.className = "day-col";

      var dot = document.createElement("div");
      dot.className = "day-dot" + (laid ? " laid" : "") + (isToday ? " today" : "");
      dot.textContent = laid ? "✓" : "";

      var letter = document.createElement("div");
      letter.className = "day-letter" + (isToday ? " today" : "");
      letter.textContent = dayLetters[i];

      col.appendChild(dot);
      col.appendChild(letter);
      weekRowEl.appendChild(col);
    }

    avgTimeEl.textContent = computeAverageTime();
    streakCountEl.textContent = computeStreak();

    var monthly = computeMonthlyStats();
    monthlyPercentEl.textContent = monthly.percent + "%";
    monthlyCountEl.textContent = monthly.laidCount;
    monthlyTotalEl.textContent = monthly.total;
    monthlyRingEl.style.background =
      "conic-gradient(var(--blue) " + monthly.percent + "%, #e2e8ee 0)";

    renderComparisonChart();
  }

  document.getElementById("share-inspiration").addEventListener("click", function () {
    openShareSheet(getDailyTip() + " 🙏");
  });

  document.getElementById("share-app-row").addEventListener("click", function () {
    openShareSheet("אני משתמש באפליקציית 'תזכורת תפילין' כדי לזכור להניח תפילין כל יום - בואו תנסו גם אתם 🙏");
  });

  // ---------- Share sheet ----------
  var shareSheetEl = document.getElementById("share-sheet");
  var shareWhatsapp = document.getElementById("share-whatsapp");
  var shareFacebook = document.getElementById("share-facebook");
  var shareTwitter = document.getElementById("share-twitter");
  var shareInstagram = document.getElementById("share-instagram");
  var shareCopy = document.getElementById("share-copy");
  var pendingShareText = "";

  function closeShareSheet() {
    shareSheetEl.classList.add("hidden");
  }

  function copyShareText() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(pendingShareText).then(function () {
        showToast("הטקסט הועתק ללוח");
      }).catch(function () {
        showToast("לא ניתן להעתיק בדפדפן זה");
      });
    } else {
      showToast("לא ניתן להעתיק בדפדפן זה");
    }
  }

  function openShareSheet(text) {
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () {});
      return;
    }
    pendingShareText = text;
    var encodedText = encodeURIComponent(text);
    var pageUrl = encodeURIComponent(location.href);
    shareWhatsapp.href = "https://wa.me/?text=" + encodedText;
    shareFacebook.href = "https://www.facebook.com/sharer/sharer.php?u=" + pageUrl + "&quote=" + encodedText;
    shareTwitter.href = "https://twitter.com/intent/tweet?text=" + encodedText;
    shareSheetEl.classList.remove("hidden");
  }

  shareInstagram.addEventListener("click", function () {
    copyShareText();
    showToast("הטקסט הועתק - הדביקו אותו בסטורי או בפוסט באינסטגרם");
    closeShareSheet();
  });

  shareCopy.addEventListener("click", function () {
    copyShareText();
    closeShareSheet();
  });

  [shareWhatsapp, shareFacebook, shareTwitter].forEach(function (el) {
    el.addEventListener("click", function () {
      closeShareSheet();
    });
  });

  document.getElementById("share-cancel").addEventListener("click", closeShareSheet);
  document.getElementById("share-sheet-backdrop").addEventListener("click", closeShareSheet);

  // ---------- Settings ----------
  var profileNameEl = document.getElementById("profile-name");
  var profileStreakEl = document.getElementById("profile-streak");
  var levelValueEl = document.getElementById("level-value");
  var darkModeToggle = document.getElementById("dark-mode-toggle");
  var nusachSettingsValueEl = document.getElementById("nusach-settings-value");

  function renderSettings() {
    profileNameEl.textContent = state.profile.name;
    var streak = computeStreak();
    profileStreakEl.textContent = streak;
    levelValueEl.textContent = getCurrentTier().name;
    darkModeToggle.checked = state.darkMode;
    nusachSettingsValueEl.textContent = state.nusach ? NUSACH_LABELS[state.nusach] : "לא נבחר";
  }

  darkModeToggle.addEventListener("change", function () {
    state.darkMode = darkModeToggle.checked;
    document.body.classList.toggle("dark", state.darkMode);
    saveState();
  });

  // ---------- Reminders ----------
  var reminderEnabledEl = document.getElementById("reminder-enabled");
  var commitStartInput = document.getElementById("commit-start-input");
  var commitEndInput = document.getElementById("commit-end-input");
  var reminderTimeInput = document.getElementById("reminder-time-input");
  var useSunsetToggle = document.getElementById("use-sunset-toggle");
  var sunsetInfoEl = document.getElementById("sunset-info");

  function renderReminders() {
    reminderEnabledEl.checked = state.reminderEnabled;
    commitStartInput.value = state.commitStart;
    commitEndInput.value = state.commitEnd;
    reminderTimeInput.value = state.reminderTime;
    useSunsetToggle.checked = state.useSunset;
    commitEndInput.disabled = state.useSunset;

    if (state.useSunset) {
      if (state.lat != null && state.lon != null) {
        var sunset = calculateSunset(new Date(), state.lat, state.lon);
        sunsetInfoEl.innerHTML = sunset
          ? '<svg class="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18M5 18a7 7 0 0 1 14 0"/><path d="M12 8V5M6.5 10.5 5 9M17.5 10.5 19 9"/></svg> שקיעה מחושבת להיום: ' + sunset
          : "לא ניתן לחשב שקיעה במיקום זה";
      } else {
        sunsetInfoEl.textContent = "ממתין להרשאת מיקום...";
      }
      sunsetInfoEl.classList.remove("hidden");
    } else {
      sunsetInfoEl.classList.add("hidden");
    }
  }

  reminderEnabledEl.addEventListener("change", function () {
    state.reminderEnabled = reminderEnabledEl.checked;
    saveState();
    if (state.reminderEnabled) requestNotificationPermission();
  });

  commitStartInput.addEventListener("change", function () {
    if (!commitStartInput.value) return;
    state.commitStart = commitStartInput.value;
    saveState();
    renderHome();
  });

  commitEndInput.addEventListener("change", function () {
    if (!commitEndInput.value) return;
    state.commitEnd = commitEndInput.value;
    saveState();
    renderHome();
  });

  reminderTimeInput.addEventListener("change", function () {
    if (!reminderTimeInput.value) return;
    state.reminderTime = reminderTimeInput.value;
    saveState();
    showToast("שעת התזכורת עודכנה ל-" + state.reminderTime);
  });

  useSunsetToggle.addEventListener("change", function () {
    if (useSunsetToggle.checked) {
      if (!("geolocation" in navigator)) {
        showToast("הדפדפן לא תומך באיתור מיקום");
        useSunsetToggle.checked = false;
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          state.lat = pos.coords.latitude;
          state.lon = pos.coords.longitude;
          state.useSunset = true;
          saveState();
          renderReminders();
          renderHome();
          showToast("מיקום אותר - השקיעה תחושב אוטומטית");
        },
        function () {
          showToast("לא ניתן לגשת למיקום - בדוק הרשאות מיקום בדפדפן");
          useSunsetToggle.checked = false;
        }
      );
    } else {
      state.useSunset = false;
      saveState();
      renderReminders();
      renderHome();
    }
  });

  // ---------- Notifications (best-effort, foreground only) ----------
  function requestNotificationPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  var lastNotifiedKey = null;
  function checkReminder() {
    if (!state.reminderEnabled) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    var key = todayKey() + "_" + state.reminderTime;
    if (key === lastNotifiedKey) return;
    if (state.log[todayKey()]) return;
    if (nowHHMM() >= state.reminderTime) {
      lastNotifiedKey = key;
      new Notification("תזכורת תפילין", {
        body: "הגיע הזמן להניח תפילין 🙏",
        icon: "icons/icon-192.png"
      });
    }
  }
  setInterval(checkReminder, 30000);

  // ---------- Service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
    // A new SW version means stale cached HTML/CSS/JS is still active on this
    // page - reload once so the user actually gets the update they expect.
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      location.reload();
    });
  }

  // ---------- Cloud sync (Firebase) ----------
  var firestoreDb = null;
  var firebaseUid = null;

  function pushStateToCloud() {
    if (!firestoreDb || !firebaseUid) return;
    firestoreDb.collection("users").doc(firebaseUid).collection("state").doc("main")
      .set({ state: state })
      .catch(function (err) { console.warn("Firestore save failed", err); });
  }

  function mergeCloudState(remoteState) {
    state = Object.assign({}, defaultState, remoteState, {
      log: remoteState.log || {},
      coinLog: remoteState.coinLog || {},
      notifications: remoteState.notifications || []
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    document.body.classList.toggle("dark", state.darkMode);
    renderHome();
    renderCoinBadge();
    renderNotifBadges();
  }

  function syncFromCloud() {
    if (!firestoreDb || !firebaseUid) return;
    firestoreDb.collection("users").doc(firebaseUid).collection("state").doc("main").get()
      .then(function (doc) {
        var remoteState = doc.exists ? doc.data().state : null;
        if (remoteState && (remoteState.updatedAt || 0) > (state.updatedAt || 0)) {
          mergeCloudState(remoteState);
        } else {
          pushStateToCloud();
        }
      })
      .catch(function (err) { console.warn("Firestore load failed", err); });
  }

  function initFirebaseSync() {
    if (typeof firebase === "undefined" || !window.FIREBASE_CONFIG) return;
    firebase.initializeApp(window.FIREBASE_CONFIG);
    firestoreDb = firebase.firestore();
    firebase.auth().onAuthStateChanged(function (user) {
      if (user) {
        firebaseUid = user.uid;
        syncFromCloud();
      }
    });
    firebase.auth().signInAnonymously().catch(function (err) {
      console.warn("Firebase anonymous sign-in failed", err);
    });
  }

  initFirebaseSync();

  // ---------- Init ----------
  document.body.classList.toggle("dark", state.darkMode);
  renderHome();
  renderCoinBadge();
  renderNotifBadges();
  if (state.onboardingComplete) {
    showScreen("home");
  } else {
    showScreen("onboarding");
  }
  appReady = true;
})();
