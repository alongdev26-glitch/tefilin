(function () {
  "use strict";

  var STORAGE_KEY = "tefillin-app-state-v1";

  var defaultState = {
    profile: { name: "ישראל ישראלי" },
    reminderEnabled: true,
    reminderTime: "08:30",
    commitStart: "06:15",
    commitEnd: "20:07",
    targetTime: "10:42",
    darkMode: false,
    log: {} // { "YYYY-MM-DD": "HH:MM" }
  };

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(defaultState));
      var parsed = JSON.parse(raw);
      return Object.assign({}, defaultState, parsed, { log: parsed.log || {} });
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

  // ---------- Navigation ----------
  var screens = {
    home: document.getElementById("screen-home"),
    reminders: document.getElementById("screen-reminders"),
    stats: document.getElementById("screen-stats"),
    settings: document.getElementById("screen-settings"),
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
    bottomNav.classList.toggle("hidden", name === "prayer");
    if (name === "stats") renderStats();
    if (name === "settings") renderSettings();
    if (name === "reminders") renderReminders();
    if (name === "prayer") {
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
    ["ברכת השנים", "בָּרֵךְ עָלֵינוּ יְהֹוָה אֱלֹהֵינוּ אֶת הַשָּׁנָה הַזֹּאת וְאֶת כָּל מִינֵי תְבוּאָתָהּ לְטוֹבָה, וְתֵן בְּרָכָה עַל פְּנֵי הָאֲדָמָה, וְשַׂבְּעֵנוּ מִטּוּבָךְ. בָּרוּךְ אַתָּה יְהֹוָה, מְבָרֵךְ הַשָּׁנִים."],
    ["קיבוץ גליות", "תְּקַע בְּשׁוֹפָר גָּדוֹל לְחֵרוּתֵנוּ, וְשָׂא נֵס לְקַבֵּץ גָּלֻיּוֹתֵינוּ, וְקַבְּצֵנוּ יַחַד מֵאַרְבַּע כַּנְפוֹת הָאָרֶץ. בָּרוּךְ אַתָּה יְהֹוָה, מְקַבֵּץ נִדְחֵי עַמּוֹ יִשְׂרָאֵל."],
    ["דין", "הָשִׁיבָה שׁוֹפְטֵינוּ כְּבָרִאשׁוֹנָה וְיוֹעֲצֵינוּ כְּבַתְּחִלָּה, וּמְלוֹךְ עָלֵינוּ אַתָּה יְהֹוָה לְבַדְּךָ בְּחֶסֶד וּבְרַחֲמִים, וְצַדְּקֵנוּ בַּמִּשְׁפָּט. בָּרוּךְ אַתָּה יְהֹוָה, מֶלֶךְ אוֹהֵב צְדָקָה וּמִשְׁפָּט."],
    ["ברכת המינים", "וְלַמַּלְשִׁינִים אַל תְּהִי תִקְוָה, וְכָל הָרִשְׁעָה כְּרֶגַע תֹּאבֵד, וְכָל אוֹיְבֶיךָ מְהֵרָה יִכָּרֵתוּ, וְהַזֵּדִים מְהֵרָה תְעַקֵּר וּתְשַׁבֵּר וּתְמַגֵּר וְתַכְנִיעַ בִּמְהֵרָה בְיָמֵינוּ. בָּרוּךְ אַתָּה יְהֹוָה, שׁוֹבֵר אֹיְבִים וּמַכְנִיעַ זֵדִים."],
    ["צדיקים", "עַל הַצַּדִּיקִים וְעַל הַחֲסִידִים וְעַל זִקְנֵי עַמְּךָ בֵּית יִשְׂרָאֵל, יֶהֱמוּ נָא רַחֲמֶיךָ יְהֹוָה אֱלֹהֵינוּ, וְתֵן שָׂכָר טוֹב לְכָל הַבּוֹטְחִים בְּשִׁמְךָ בֶּאֱמֶת, וְשִׂים חֶלְקֵנוּ עִמָּהֶם. בָּרוּךְ אַתָּה יְהֹוָה, מִשְׁעָן וּמִבְטָח לַצַּדִּיקִים."],
    ["בנין ירושלים", "וְלִירוּשָׁלַיִם עִירְךָ בְּרַחֲמִים תָּשׁוּב, וְתִשְׁכּוֹן בְּתוֹכָהּ כַּאֲשֶׁר דִּבַּרְתָּ, וּבְנֵה אוֹתָהּ בְּקָרוֹב בְּיָמֵינוּ בִּנְיַן עוֹלָם. בָּרוּךְ אַתָּה יְהֹוָה, בּוֹנֵה יְרוּשָׁלָיִם."],
    ["מלכות בית דוד", "אֶת צֶמַח דָּוִד עַבְדְּךָ מְהֵרָה תַצְמִיחַ, וְקַרְנוֹ תָּרוּם בִּישׁוּעָתֶךָ, כִּי לִישׁוּעָתְךָ קִוִּינוּ כָּל הַיּוֹם. בָּרוּךְ אַתָּה יְהֹוָה, מַצְמִיחַ קֶרֶן יְשׁוּעָה."],
    ["קבלת תפילה", "שְׁמַע קוֹלֵנוּ יְהֹוָה אֱלֹהֵינוּ, חוּס וְרַחֵם עָלֵינוּ, וְקַבֵּל בְּרַחֲמִים וּבְרָצוֹן אֶת תְּפִלָּתֵנוּ, כִּי אֵל שׁוֹמֵעַ תְּפִלּוֹת וְתַחֲנוּנִים אָתָּה. בָּרוּךְ אַתָּה יְהֹוָה, שׁוֹמֵעַ תְּפִלָּה."],
    ["עבודה", "רְצֵה יְהֹוָה אֱלֹהֵינוּ בְּעַמְּךָ יִשְׂרָאֵל וּבִתְפִלָּתָם, וְהָשֵׁב אֶת הָעֲבוֹדָה לִדְבִיר בֵּיתֶךָ. וְתֶחֱזֶינָה עֵינֵינוּ בְּשׁוּבְךָ לְצִיּוֹן בְּרַחֲמִים. בָּרוּךְ אַתָּה יְהֹוָה, הַמַּחֲזִיר שְׁכִינָתוֹ לְצִיּוֹן."],
    ["הודאה", "מוֹדִים אֲנַחְנוּ לָךְ שָׁאַתָּה הוּא יְהֹוָה אֱלֹהֵינוּ וֵאלֹהֵי אֲבוֹתֵינוּ לְעוֹלָם וָעֶד, צוּר חַיֵּינוּ מָגֵן יִשְׁעֵנוּ אַתָּה הוּא לְדוֹר וָדוֹר. נוֹדֶה לְּךָ וּנְסַפֵּר תְּהִלָּתֶךָ עַל חַיֵּינוּ הַמְּסוּרִים בְּיָדֶךָ, וְעַל נִשְׁמוֹתֵינוּ הַפְּקוּדוֹת לָךְ, וְעַל נִסֶּיךָ שֶׁבְּכָל יוֹם עִמָּנוּ, וְעַל נִפְלְאוֹתֶיךָ וְטוֹבוֹתֶיךָ שֶׁבְּכָל עֵת, עֶרֶב וָבֹקֶר וְצָהֳרָיִם. וְעַל כֻּלָּם יִתְבָּרַךְ וְיִתְרוֹמַם שִׁמְךָ מַלְכֵּנוּ תָּמִיד לְעוֹלָם וָעֶד. בָּרוּךְ אַתָּה יְהֹוָה, הַטּוֹב שִׁמְךָ וּלְךָ נָאֶה לְהוֹדוֹת."],
    ["שלום", "שִׂים שָׁלוֹם טוֹבָה וּבְרָכָה, חֵן וָחֶסֶד וְרַחֲמִים, עָלֵינוּ וְעַל כָּל יִשְׂרָאֵל עַמֶּךָ. בָּרְכֵנוּ אָבִינוּ כֻּלָּנוּ כְּאֶחָד בְּאוֹר פָּנֶיךָ, כִּי בְאוֹר פָּנֶיךָ נָתַתָּ לָּנוּ יְהֹוָה אֱלֹהֵינוּ תּוֹרַת חַיִּים וְאַהֲבַת חֶסֶד, וּצְדָקָה וּבְרָכָה וְרַחֲמִים וְחַיִּים וְשָׁלוֹם. בָּרוּךְ אַתָּה יְהֹוָה, הַמְבָרֵךְ אֶת עַמּוֹ יִשְׂרָאֵל בַּשָּׁלוֹם."],
    ["בסיום", "אֱלֹהַי, נְצוֹר לְשׁוֹנִי מֵרָע וּשְׂפָתַי מִדַּבֵּר מִרְמָה. יִהְיוּ לְרָצוֹן אִמְרֵי פִי וְהֶגְיוֹן לִבִּי לְפָנֶיךָ, יְהֹוָה צוּרִי וְגוֹאֲלִי."]
  ];

  var AMIDAH_FULL_HTML = AMIDAH_ITEMS.map(function (item) {
    return '<div class="amidah-item"><p class="amidah-name">' + item[0] + '</p><p class="amidah-text">' + item[1] + '</p></div>';
  }).join("");

  ["shema-full", "shema-full-2"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = SHEMA_FULL_HTML;
  });
  var amidahFullEl = document.getElementById("amidah-full");
  if (amidahFullEl) amidahFullEl.innerHTML = AMIDAH_FULL_HTML;

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

  // ---------- Home screen ----------
  var greetingEl = document.getElementById("greeting-text");
  var statusEl = document.getElementById("status-text");
  var targetTimeEl = document.getElementById("target-time");
  var layBtn = document.getElementById("lay-btn");
  var layBtnLabel = document.getElementById("lay-btn-label");
  var layBtnArrow = document.getElementById("lay-btn-arrow");

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
    targetTimeEl.textContent = state.targetTime;

    var laidToday = !!state.log[todayKey()];
    if (laidToday) {
      statusEl.innerHTML = "כל הכבוד! הנחתם תפילין היום בשעה " +
        "<span id=\"target-time\">" + state.log[todayKey()] + "</span>.";
      layBtn.classList.add("done");
      layBtnLabel.textContent = "הונחו היום";
      layBtnArrow.textContent = "✓";
    } else {
      statusEl.innerHTML = "זמן הנחת תפילין עד השעה " +
        "<span id=\"target-time\">" + state.targetTime + "</span>. האם כבר הנחתם?";
      layBtn.classList.remove("done");
      layBtnLabel.textContent = "הנח תפילין";
      layBtnArrow.textContent = "◂";
    }
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
    showScreen("prayer");
  });

  document.getElementById("prayer-close").addEventListener("click", function () {
    showScreen("home");
  });

  document.getElementById("confirm-lay-btn").addEventListener("click", function () {
    state.log[todayKey()] = nowHHMM();
    saveState();
    renderHome();
    showScreen("home");
    showToast("הנחת בהצלחה! 🙏 הנתון נשמר");
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

  function levelForStreak(streak) {
    if (streak >= 30) return "זהב";
    if (streak >= 7) return "כסף";
    return "ברונזה";
  }

  function renderSettings() {
    profileNameEl.textContent = state.profile.name;
    var streak = computeStreak();
    profileStreakEl.textContent = streak;
    levelValueEl.textContent = levelForStreak(streak);
    darkModeToggle.checked = state.darkMode;
  }

  darkModeToggle.addEventListener("change", function () {
    state.darkMode = darkModeToggle.checked;
    document.body.classList.toggle("dark", state.darkMode);
    saveState();
  });

  // ---------- Reminders ----------
  var reminderEnabledEl = document.getElementById("reminder-enabled");
  var commitStartEl = document.getElementById("commit-start");
  var commitEndEl = document.getElementById("commit-end");
  var alarmTimeEl = document.getElementById("alarm-time");
  var alarmChip = document.getElementById("alarm-chip");

  function renderReminders() {
    reminderEnabledEl.checked = state.reminderEnabled;
    commitStartEl.textContent = state.commitStart;
    commitEndEl.textContent = state.commitEnd;
    alarmTimeEl.textContent = "מתוזמן לשעה " + state.reminderTime;
  }

  reminderEnabledEl.addEventListener("change", function () {
    state.reminderEnabled = reminderEnabledEl.checked;
    saveState();
    if (state.reminderEnabled) requestNotificationPermission();
  });

  alarmChip.addEventListener("click", function () {
    var input = prompt("הגדר שעת תזכורת (HH:MM)", state.reminderTime);
    if (!input) return;
    if (!/^\d{1,2}:\d{2}$/.test(input)) {
      showToast("פורמט שעה לא תקין");
      return;
    }
    state.reminderTime = input;
    state.targetTime = input;
    saveState();
    renderReminders();
    showToast("התזכורת עודכנה ל-" + input);
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
  showScreen("home");
})();
