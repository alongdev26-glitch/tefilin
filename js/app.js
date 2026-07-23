(function () {
  "use strict";

  var STORAGE_KEY = "tefillin-app-state-v1";

  var defaultState = {
    profile: { name: "ישראל ישראלי" },
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
    weeklyMilestonesAwarded: 0
  };

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(defaultState));
      var parsed = JSON.parse(raw);
      return Object.assign({}, defaultState, parsed, {
        log: parsed.log || {},
        coinLog: parsed.coinLog || {}
      });
    } catch (e) {
      return JSON.parse(JSON.stringify(defaultState));
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    bottomNav.classList.toggle("hidden", name === "prayer" || name === "onboarding" || name === "nusach" || name === "shop");
    document.getElementById("coin-badge").classList.toggle("hidden", name === "onboarding");
    if (name === "stats") renderStats();
    if (name === "settings") renderSettings();
    if (name === "reminders") renderReminders();
    if (name === "shop") renderShop();
    if (name === "prayer") {
      renderBlessingCard();
      renderAmidahCard();
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

  // ---------- Full prayer texts ----------
  var SHEMA_FULL_HTML =
    '<p class="shema-para">' +
      'שְׁמַע יִשְׂרָאֵל יְהֹוָה אֱלֹהֵינוּ יְהֹוָה אֶחָד: (בלחש: בָּרוּךְ שֵׁם כְּבוֹד מַלְכוּתוֹ לְעוֹלָם וָעֶד:) ' +
      'וְאָהַבְתָּ אֵת יְהֹוָה אֱלֹהֶיךָ בְּכָל לְבָבְךָ וּבְכָל נַפְשְׁךָ וּבְכָל מְאֹדֶךָ. וְהָיוּ הַדְּבָרִים הָאֵלֶּה ' +
      'אֲשֶׁר אָנֹכִי מְצַוְּךָ הַיּוֹם עַל לְבָבֶךָ. וְשִׁנַּנְתָּם לְבָנֶיךָ וְדִבַּרְתָּ בָּם בְּשִׁבְתְּךָ בְּבֵיתֶךָ וּבְלֶכְתְּךָ ' +
      'בַדֶּרֶךְ וּבְשָׁכְבְּךָ וּבְקוּמֶךָ. וּקְשַׁרְתָּם לְאוֹת עַל יָדֶךָ וְהָיוּ לְטֹטָפֹת בֵּין עֵינֶיךָ. וּכְתַבְתָּם עַל מְזֻזוֹת ' +
      'בֵּיתֶךָ וּבִשְׁעָרֶיךָ.' +
    '</p>' +
    '<p class="shema-para">' +
      'וְהָיָה אִם שָׁמֹעַ תִּשְׁמְעוּ אֶל מִצְוֹתַי אֲשֶׁר אָנֹכִי מְצַוֶּה אֶתְכֶם הַיּוֹם, לְאַהֲבָה אֶת יְהֹוָה אֱלֹהֵיכֶם ' +
      'וּלְעָבְדוֹ בְּכָל לְבַבְכֶם וּבְכָל נַפְשְׁכֶם. וְנָתַתִּי מְטַר אַרְצְכֶם בְּעִתּוֹ יוֹרֶה וּמַלְקוֹשׁ, וְאָסַפְתָּ דְגָנֶךָ ' +
      'וְתִירֹשְׁךָ וְיִצְהָרֶךָ. וְנָתַתִּי עֵשֶׂב בְּשָׂדְךָ לִבְהֶמְתֶּךָ וְאָכַלְתָּ וְשָׂבָעְתָּ. הִשָּׁמְרוּ לָכֶם פֶּן יִפְתֶּה ' +
      'לְבַבְכֶם וְסַרְתֶּם וַעֲבַדְתֶּם אֱלֹהִים אֲחֵרִים וְהִשְׁתַּחֲוִיתֶם לָהֶם. וְחָרָה אַף יְהֹוָה בָּכֶם וְעָצַר אֶת הַשָּׁמַיִם ' +
      'וְלֹא יִהְיֶה מָטָר וְהָאֲדָמָה לֹא תִתֵּן אֶת יְבוּלָהּ, וַאֲבַדְתֶּם מְהֵרָה מֵעַל הָאָרֶץ הַטֹּבָה אֲשֶׁר יְהֹוָה נֹתֵן ' +
      'לָכֶם. וְשַׂמְתֶּם אֶת דְּבָרַי אֵלֶּה עַל לְבַבְכֶם וְעַל נַפְשְׁכֶם, וּקְשַׁרְתֶּם אֹתָם לְאוֹת עַל יֶדְכֶם וְהָיוּ ' +
      'לְטוֹטָפֹת בֵּין עֵינֵיכֶם. וְלִמַּדְתֶּם אֹתָם אֶת בְּנֵיכֶם לְדַבֵּר בָּם, בְּשִׁבְתְּךָ בְּבֵיתֶךָ וּבְלֶכְתְּךָ בַדֶּרֶךְ ' +
      'וּבְשָׁכְבְּךָ וּבְקוּמֶךָ. וּכְתַבְתָּם עַל מְזוּזוֹת בֵּיתֶךָ וּבִשְׁעָרֶיךָ. לְמַעַן יִרְבּוּ יְמֵיכֶם וִימֵי בְנֵיכֶם עַל ' +
      'הָאֲדָמָה אֲשֶׁר נִשְׁבַּע יְהֹוָה לַאֲבֹתֵיכֶם לָתֵת לָהֶם, כִּימֵי הַשָּׁמַיִם עַל הָאָרֶץ.' +
    '</p>' +
    '<p class="shema-para">' +
      'וַיֹּאמֶר יְהֹוָה אֶל מֹשֶׁה לֵּאמֹר. דַּבֵּר אֶל בְּנֵי יִשְׂרָאֵל וְאָמַרְתָּ אֲלֵהֶם וְעָשׂוּ לָהֶם צִיצִת עַל כַּנְפֵי ' +
      'בִגְדֵיהֶם לְדֹרֹתָם, וְנָתְנוּ עַל צִיצִת הַכָּנָף פְּתִיל תְּכֵלֶת. וְהָיָה לָכֶם לְצִיצִת וּרְאִיתֶם אֹתוֹ וּזְכַרְתֶּם ' +
      'אֶת כָּל מִצְוֹת יְהֹוָה וַעֲשִׂיתֶם אֹתָם, וְלֹא תָתוּרוּ אַחֲרֵי לְבַבְכֶם וְאַחֲרֵי עֵינֵיכֶם אֲשֶׁר אַתֶּם זֹנִים ' +
      'אַחֲרֵיהֶם. לְמַעַן תִּזְכְּרוּ וַעֲשִׂיתֶם אֶת כָּל מִצְוֹתָי, וִהְיִיתֶם קְדֹשִׁים לֵאלֹהֵיכֶם. אֲנִי יְהֹוָה אֱלֹהֵיכֶם ' +
      'אֲשֶׁר הוֹצֵאתִי אֶתְכֶם מֵאֶרֶץ מִצְרַיִם לִהְיוֹת לָכֶם לֵאלֹהִים, אֲנִי יְהֹוָה אֱלֹהֵיכֶם. יְהֹוָה אֱלֹהֵיכֶם אֱמֶת.' +
    '</p>';

  var AMIDAH_ITEMS = [
    ["אבות", "בָּרוּךְ אַתָּה יְהֹוָה אֱלֹהֵינוּ וֵאלֹהֵי אֲבוֹתֵינוּ, אֱלֹהֵי אַבְרָהָם אֱלֹהֵי יִצְחָק וֵאלֹהֵי יַעֲקֹב, הָאֵל הַגָּדוֹל הַגִּבּוֹר וְהַנּוֹרָא, אֵל עֶלְיוֹן, גּוֹמֵל חֲסָדִים טוֹבִים וְקֹנֵה הַכֹּל, וְזוֹכֵר חַסְדֵי אָבוֹת וּמֵבִיא גוֹאֵל לִבְנֵי בְנֵיהֶם לְמַעַן שְׁמוֹ בְּאַהֲבָה. מֶלֶךְ עוֹזֵר וּמוֹשִׁיעַ וּמָגֵן. בָּרוּךְ אַתָּה יְהֹוָה, מָגֵן אַבְרָהָם."],
    ["גבורות", "אַתָּה גִּבּוֹר לְעוֹלָם אֲדֹנָי, מְחַיֶּה מֵתִים אַתָּה, רַב לְהוֹשִׁיעַ. מְכַלְכֵּל חַיִּים בְּחֶסֶד, מְחַיֶּה מֵתִים בְּרַחֲמִים רַבִּים, סוֹמֵךְ נוֹפְלִים וְרוֹפֵא חוֹלִים וּמַתִּיר אֲסוּרִים, וּמְקַיֵּם אֱמוּנָתוֹ לִישֵׁנֵי עָפָר. מִי כָמוֹךָ בַּעַל גְּבוּרוֹת וּמִי דּוֹמֶה לָּךְ, מֶלֶךְ מֵמִית וּמְחַיֶּה וּמַצְמִיחַ יְשׁוּעָה. וְנֶאֱמָן אַתָּה לְהַחֲיוֹת מֵתִים. בָּרוּךְ אַתָּה יְהֹוָה, מְחַיֵּה הַמֵּתִים."],
    ["קדושת השם", "אַתָּה קָדוֹשׁ וְשִׁמְךָ קָדוֹשׁ, וּקְדוֹשִׁים בְּכָל יוֹם יְהַלְלוּךָ סֶּלָה. בָּרוּךְ אַתָּה יְהֹוָה, הָאֵל הַקָּדוֹשׁ."],
    ["בינה", "אַתָּה חוֹנֵן לְאָדָם דַּעַת וּמְלַמֵּד לֶאֱנוֹשׁ בִּינָה. חָנֵּנוּ מֵאִתְּךָ חָכְמָה בִּינָה וָדָעַת. בָּרוּךְ אַתָּה יְהֹוָה, חוֹנֵן הַדָּעַת."],
    ["תשובה", "הֲשִׁיבֵנוּ אָבִינוּ לְתוֹרָתֶךָ, וְקָרְבֵנוּ מַלְכֵּנוּ לַעֲבוֹדָתֶךָ, וְהַחֲזִירֵנוּ בִּתְשׁוּבָה שְׁלֵמָה לְפָנֶיךָ. בָּרוּךְ אַתָּה יְהֹוָה, הָרוֹצֶה בִּתְשׁוּבָה."],
    ["סליחה", "סְלַח לָנוּ אָבִינוּ כִּי חָטָאנוּ, מְחַל לָנוּ מַלְכֵּנוּ כִּי פָשָׁעְנוּ, כִּי מוֹחֵל וְסוֹלֵחַ אָתָּה. בָּרוּךְ אַתָּה יְהֹוָה, חַנּוּן הַמַּרְבֶּה לִסְלוֹחַ."],
    ["גאולה", "רְאֵה נָא בְעָנְיֵנוּ וְרִיבָה רִיבֵנוּ, וּגְאָלֵנוּ מְהֵרָה לְמַעַן שְׁמֶךָ, כִּי אֵל גּוֹאֵל חָזָק אָתָּה. בָּרוּךְ אַתָּה יְהֹוָה, גּוֹאֵל יִשְׂרָאֵל."],
    ["רפואה", "רְפָאֵנוּ יְהֹוָה וְנֵרָפֵא, הוֹשִׁיעֵנוּ וְנִוָּשֵׁעָה, כִּי תְהִלָּתֵנוּ אָתָּה, וְהַעֲלֵה רְפוּאָה שְׁלֵמָה לְכָל מַכּוֹתֵינוּ. בָּרוּךְ אַתָּה יְהֹוָה, רוֹפֵא חוֹלֵי עַמּוֹ יִשְׂרָאֵל."],
    ["ברכת השנים",
      "בָּרֵךְ עָלֵינוּ יְהֹוָה אֱלֹהֵינוּ אֶת הַשָּׁנָה הַזֹּאת וְאֶת כָּל מִינֵי תְבוּאָתָהּ לְטוֹבָה, וְתֵן בְּרָכָה עַל פְּנֵי הָאֲדָמָה, וְשַׂבְּעֵנוּ מִטּוּבָךְ. בָּרוּךְ אַתָּה יְהֹוָה, מְבָרֵךְ הַשָּׁנִים.",
      "בָּרְכֵנוּ יְהֹוָה אֱלֹהֵינוּ בְּכָל מַעֲשֵׂה יָדֵינוּ, וּבָרֵךְ שְׁנָתֵנוּ בְּטַלְלֵי רָצוֹן בְּרָכָה וּנְדָבָה, וּתְהִי אַחֲרִיתָהּ חַיִּים וְשָׂבָע וְשָׁלוֹם כַּשָּׁנִים הַטּוֹבוֹת לִבְרָכָה, כִּי אֵל טוֹב וּמֵטִיב אַתָּה וּמְבָרֵךְ הַשָּׁנִים. בָּרוּךְ אַתָּה יְהֹוָה, מְבָרֵךְ הַשָּׁנִים."
    ],
    ["קיבוץ גליות", "תְּקַע בְּשׁוֹפָר גָּדוֹל לְחֵרוּתֵנוּ, וְשָׂא נֵס לְקַבֵּץ גָּלֻיּוֹתֵינוּ, וְקַבְּצֵנוּ יַחַד מֵאַרְבַּע כַּנְפוֹת הָאָרֶץ. בָּרוּךְ אַתָּה יְהֹוָה, מְקַבֵּץ נִדְחֵי עַמּוֹ יִשְׂרָאֵל."],
    ["דין", "הָשִׁיבָה שׁוֹפְטֵינוּ כְּבָרִאשׁוֹנָה וְיוֹעֲצֵינוּ כְּבַתְּחִלָּה, וּמְלוֹךְ עָלֵינוּ אַתָּה יְהֹוָה לְבַדְּךָ בְּחֶסֶד וּבְרַחֲמִים, וְצַדְּקֵנוּ בַּמִּשְׁפָּט. בָּרוּךְ אַתָּה יְהֹוָה, מֶלֶךְ אוֹהֵב צְדָקָה וּמִשְׁפָּט."],
    ["ברכת המינים", "וְלַמַּלְשִׁינִים אַל תְּהִי תִקְוָה, וְכָל הָרִשְׁעָה כְּרֶגַע תֹּאבֵד, וְכָל אוֹיְבֶיךָ מְהֵרָה יִכָּרֵתוּ, וְהַזֵּדִים מְהֵרָה תְעַקֵּר וּתְשַׁבֵּר וּתְמַגֵּר וְתַכְנִיעַ בִּמְהֵרָה בְיָמֵינוּ. בָּרוּךְ אַתָּה יְהֹוָה, שׁוֹבֵר אֹיְבִים וּמַכְנִיעַ זֵדִים."],
    ["צדיקים", "עַל הַצַּדִּיקִים וְעַל הַחֲסִידִים וְעַל זִקְנֵי עַמְּךָ בֵּית יִשְׂרָאֵל, יֶהֱמוּ נָא רַחֲמֶיךָ יְהֹוָה אֱלֹהֵינוּ, וְתֵן שָׂכָר טוֹב לְכָל הַבּוֹטְחִים בְּשִׁמְךָ בֶּאֱמֶת, וְשִׂים חֶלְקֵנוּ עִמָּהֶם. בָּרוּךְ אַתָּה יְהֹוָה, מִשְׁעָן וּמִבְטָח לַצַּדִּיקִים."],
    ["בנין ירושלים", "וְלִירוּשָׁלַיִם עִירְךָ בְּרַחֲמִים תָּשׁוּב, וְתִשְׁכּוֹן בְּתוֹכָהּ כַּאֲשֶׁר דִּבַּרְתָּ, וּבְנֵה אוֹתָהּ בְּקָרוֹב בְּיָמֵינוּ בִּנְיַן עוֹלָם. בָּרוּךְ אַתָּה יְהֹוָה, בּוֹנֵה יְרוּשָׁלָיִם."],
    ["מלכות בית דוד", "אֶת צֶמַח דָּוִד עַבְדְּךָ מְהֵרָה תַצְמִיחַ, וְקַרְנוֹ תָּרוּם בִּישׁוּעָתֶךָ, כִּי לִישׁוּעָתְךָ קִוִּינוּ כָּל הַיּוֹם. בָּרוּךְ אַתָּה יְהֹוָה, מַצְמִיחַ קֶרֶן יְשׁוּעָה."],
    ["קבלת תפילה", "שְׁמַע קוֹלֵנוּ יְהֹוָה אֱלֹהֵינוּ, חוּס וְרַחֵם עָלֵינוּ, וְקַבֵּל בְּרַחֲמִים וּבְרָצוֹן אֶת תְּפִלָּתֵנוּ, כִּי אֵל שׁוֹמֵעַ תְּפִלּוֹת וְתַחֲנוּנִים אָתָּה. בָּרוּךְ אַתָּה יְהֹוָה, שׁוֹמֵעַ תְּפִלָּה."],
    ["עבודה", "רְצֵה יְהֹוָה אֱלֹהֵינוּ בְּעַמְּךָ יִשְׂרָאֵל וּבִתְפִלָּתָם, וְהָשֵׁב אֶת הָעֲבוֹדָה לִדְבִיר בֵּיתֶךָ. וְתֶחֱזֶינָה עֵינֵינוּ בְּשׁוּבְךָ לְצִיּוֹן בְּרַחֲמִים. בָּרוּךְ אַתָּה יְהֹוָה, הַמַּחֲזִיר שְׁכִינָתוֹ לְצִיּוֹן."],
    ["הודאה", "מוֹדִים אֲנַחְנוּ לָךְ שָׁאַתָּה הוּא יְהֹוָה אֱלֹהֵינוּ וֵאלֹהֵי אֲבוֹתֵינוּ לְעוֹלָם וָעֶד, צוּר חַיֵּינוּ מָגֵן יִשְׁעֵנוּ אַתָּה הוּא לְדוֹר וָדוֹר. נוֹדֶה לְּךָ וּנְסַפֵּר תְּהִלָּתֶךָ עַל חַיֵּינוּ הַמְּסוּרִים בְּיָדֶךָ, וְעַל נִשְׁמוֹתֵינוּ הַפְּקוּדוֹת לָךְ, וְעַל נִסֶּיךָ שֶׁבְּכָל יוֹם עִמָּנוּ, וְעַל נִפְלְאוֹתֶיךָ וְטוֹבוֹתֶיךָ שֶׁבְּכָל עֵת, עֶרֶב וָבֹקֶר וְצָהֳרָיִם. וְעַל כֻּלָּם יִתְבָּרַךְ וְיִתְרוֹמַם שִׁמְךָ מַלְכֵּנוּ תָּמִיד לְעוֹלָם וָעֶד. בָּרוּךְ אַתָּה יְהֹוָה, הַטּוֹב שִׁמְךָ וּלְךָ נָאֶה לְהוֹדוֹת."],
    ["שלום",
      "שִׂים שָׁלוֹם טוֹבָה וּבְרָכָה, חֵן וָחֶסֶד וְרַחֲמִים, עָלֵינוּ וְעַל כָּל יִשְׂרָאֵל עַמֶּךָ. בָּרְכֵנוּ אָבִינוּ כֻּלָּנוּ כְּאֶחָד בְּאוֹר פָּנֶיךָ, כִּי בְאוֹר פָּנֶיךָ נָתַתָּ לָּנוּ יְהֹוָה אֱלֹהֵינוּ תּוֹרַת חַיִּים וְאַהֲבַת חֶסֶד, וּצְדָקָה וּבְרָכָה וְרַחֲמִים וְחַיִּים וְשָׁלוֹם. בָּרוּךְ אַתָּה יְהֹוָה, הַמְבָרֵךְ אֶת עַמּוֹ יִשְׂרָאֵל בַּשָּׁלוֹם.",
      "שָׁלוֹם רָב עַל יִשְׂרָאֵל עַמְּךָ תָּשִׂים לְעוֹלָם, כִּי אַתָּה הוּא מֶלֶךְ אָדוֹן לְכָל הַשָּׁלוֹם, וְטוֹב בְּעֵינֶיךָ לְבָרֵךְ אֶת עַמְּךָ יִשְׂרָאֵל בְּכָל עֵת וּבְכָל שָׁעָה בִּשְׁלוֹמֶךָ. בָּרוּךְ אַתָּה יְהֹוָה, הַמְבָרֵךְ אֶת עַמּוֹ יִשְׂרָאֵל בַּשָּׁלוֹם."
    ],
    ["בסיום", "אֱלֹהַי, נְצוֹר לְשׁוֹנִי מֵרָע וּשְׂפָתַי מִדַּבֵּר מִרְמָה. יִהְיוּ לְרָצוֹן אִמְרֵי פִי וְהֶגְיוֹן לִבִּי לְפָנֶיךָ, יְהֹוָה צוּרִי וְגוֹאֲלִי."]
  ];

  function isAshkenazi() {
    return state.nusach === "ashkenazi" || !state.nusach;
  }

  function buildAmidahHtml() {
    var useAshkenazi = isAshkenazi();
    return AMIDAH_ITEMS.map(function (item) {
      var text = (!useAshkenazi && item[2]) ? item[2] : item[1];
      return '<div class="amidah-item"><p class="amidah-name">' + item[0] + '</p><p class="amidah-text">' + text + '</p></div>';
    }).join("");
  }

  var amidahFullEl = document.getElementById("amidah-full");

  function renderAmidahCard() {
    if (amidahFullEl) amidahFullEl.innerHTML = buildAmidahHtml();
  }

  var shemaFullEl = document.getElementById("shema-full-2");
  if (shemaFullEl) shemaFullEl.innerHTML = SHEMA_FULL_HTML;

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

  document.querySelectorAll(".expandable .prayer-card-head").forEach(function (head) {
    head.addEventListener("click", function () {
      var card = head.closest(".prayer-card");
      var full = card.querySelector(".prayer-full");
      var toggle = head.querySelector(".prayer-toggle");
      var isHidden = full.classList.contains("hidden");
      full.classList.toggle("hidden", !isHidden);
      toggle.textContent = isHidden ? "הסתר ⌃" : "הצג הכל ⌄";
      if (isHidden) card.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
  var levelProgressBarEl = document.getElementById("level-progress-bar");
  var levelProgressNextEl = document.getElementById("level-progress-next");

  // ---------- Devotion level tiers (purchased with coins) ----------
  var LEVEL_TIERS = [
    { name: "בית הכנסת", flavor: "הולך לבית כנסת עם כיפה בשבת", price: 0 },
    { name: "שחרית", flavor: "הולך להתפלל שחרית כל בוקר", price: 500 },
    { name: "לומד תורה", flavor: "לומד תורה מדי יום", price: 1000 },
    { name: "מרביץ תורה", flavor: "מרביץ תורה ומלמד אחרים", price: 2500 },
    { name: "מוסיף לשם", flavor: "מוסיף קדושה וכבוד לשם שמים בכל מעשיו", price: 5000 },
    { name: "מטאור", flavor: "מועמד לרשות הסנהדרין", price: 10000 },
    { name: "רבינו הגדול", flavor: "פסגת המסע הרוחני", price: 25000 }
  ];

  function getCurrentTier() { return LEVEL_TIERS[state.purchasedTierIndex]; }
  function getNextTier() { return LEVEL_TIERS[state.purchasedTierIndex + 1] || null; }

  function renderLevelProgress() {
    var current = getCurrentTier();
    var next = getNextTier();
    levelProgressCurrentEl.textContent = current.name;

    if (next) {
      var progress = Math.min(100, Math.round((state.coins / next.price) * 100));
      levelProgressBarEl.style.width = progress + "%";
      var missing = Math.max(0, next.price - state.coins);
      levelProgressNextEl.textContent = missing > 0
        ? "עוד " + missing + " מטבעות לדרגת " + next.name
        : "יש לך מספיק מטבעות לדרגת " + next.name + " - עברו לחנות";
    } else {
      levelProgressBarEl.style.width = "100%";
      levelProgressNextEl.textContent = "הגעת לדרגה הגבוהה ביותר!";
    }
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

    var laidToday = !!state.log[todayKey()];
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

  layBtn.addEventListener("click", function () {
    var key = todayKey();
    if (state.log[key]) {
      delete state.log[key];
      saveState();
      renderHome();
      showToast("הסימון הוסר");
      return;
    }
    if (!state.nusach) {
      openNusachPicker("home");
      return;
    }
    showScreen("prayer");
  });

  document.getElementById("prayer-close").addEventListener("click", function () {
    showScreen("home");
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
        showScreen("prayer");
      }
    });
  });

  document.getElementById("nusach-settings-row").addEventListener("click", function () {
    openNusachPicker("settings");
  });

  // ---------- Shop ----------
  var shopTierListEl = document.getElementById("shop-tier-list");

  function renderShop() {
    var html = "";
    LEVEL_TIERS.forEach(function (tier, i) {
      var owned = i <= state.purchasedTierIndex;
      var isNext = i === state.purchasedTierIndex + 1;
      var stateClass = owned ? "owned" : (isNext ? "next" : "locked");
      var actionHtml;
      if (owned) {
        actionHtml = '<span class="shop-tier-status shop-tier-owned">בבעלותך ✓</span>';
      } else if (isNext) {
        var afford = state.coins >= tier.price;
        actionHtml = '<button class="pill-btn shop-buy-btn" data-tier-index="' + i + '"' + (afford ? "" : " disabled") + '>קנה ב-' + tier.price + ' מטבעות</button>';
      } else {
        actionHtml = '<span class="shop-tier-status shop-tier-locked">נעול</span>';
      }
      var nameHtml = (owned || isNext) ? tier.name : "?";
      var flavorHtml = (owned || isNext) ? tier.flavor : "המשיכו להתקדם כדי לגלות את הדרגה הבאה";
      html += '<div class="card shop-tier-card ' + stateClass + '">' +
        '<div class="shop-tier-name">' + nameHtml + '</div>' +
        '<div class="shop-tier-flavor">' + flavorHtml + '</div>' +
        actionHtml + '</div>';
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
  }

  document.getElementById("shop-close").addEventListener("click", function () {
    showScreen("home");
  });

  // ---------- Onboarding ----------
  var onboardingNameInput = document.getElementById("onboarding-name-input");
  var onboardingSubmitBtn = document.getElementById("onboarding-submit-btn");

  function completeOnboarding() {
    var typed = onboardingNameInput.value.trim();
    state.profile.name = typed || defaultState.profile.name;
    state.onboardingComplete = true;
    state.coins += 150; // 100 starting + 50 first-week bonus
    saveState();
    renderCoinBadge();
    renderSettings();
    renderHome();
    showScreen("home");
  }

  onboardingSubmitBtn.addEventListener("click", completeOnboarding);
  onboardingNameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") completeOnboarding();
  });

  // ---------- Stats ----------
  var weekRowEl = document.getElementById("week-row");
  var avgTimeEl = document.getElementById("avg-time");
  var streakCountEl = document.getElementById("streak-count");
  var monthlyRingEl = document.getElementById("monthly-ring");
  var monthlyPercentEl = document.getElementById("monthly-percent");
  var monthlyCountEl = document.getElementById("monthly-count");
  var monthlyTotalEl = document.getElementById("monthly-total");
  var MONTHLY_WINDOW_DAYS = 30;

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
  }

  document.getElementById("share-inspiration").addEventListener("click", function () {
    openShareSheet("הנחת תפילין מחברת אותנו למקור הכוח שלנו 🙏");
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
  }

  // ---------- Init ----------
  document.body.classList.toggle("dark", state.darkMode);
  renderHome();
  renderCoinBadge();
  if (state.onboardingComplete) {
    showScreen("home");
  } else {
    showScreen("onboarding");
  }
})();
