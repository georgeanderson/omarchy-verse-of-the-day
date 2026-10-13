import QtQuick
import Quickshell
import Quickshell.Io
import qs.Ui
import "Logic.js" as Logic

// Verse of the day. The bar shows a short reference; the verse itself is the
// notification toast, not a nested panel.
BarWidget {
  id: root
  moduleName: "io.github.georgeanderson.verse-of-the-day"

  // Settings (inline on this widget's shell.json entry; see manifest schema).
  readonly property string translation: Logic.normalizeVersion(root.setting("translation", Logic.DEFAULT_VERSION))
  readonly property string labelStyle: Logic.normalizeLabelStyle(root.setting("labelStyle", "short"))
  readonly property bool showCredit: Logic.toBool(root.setting("showCredit", true), true)
  readonly property int toastTimeoutSec: Logic.clampInt(root.setting("toastTimeoutSec", 15), 3, 120, 15)
  // Advanced, undocumented in the settings form: point at another API base
  // (used to test outages). Only plain http(s) URLs are accepted.
  readonly property string apiBase: Logic.normalizeApiBase(root.setting("apiBase", ""))
  readonly property string endpoint: Logic.endpointFor(apiBase, translation)

  readonly property string stateHome: Quickshell.env("XDG_STATE_HOME") || (Quickshell.env("HOME") + "/.local/state")
  readonly property string cacheDir: stateHome + "/" + Logic.PLUGIN_ID
  readonly property string cachePath: cacheDir + "/cache.json"

  // Verse state.
  property var verse: null
  property string verseDay: ""
  property string etag: ""
  property string cachedVersion: ""
  property string fetchedAt: ""
  property bool networkWon: false

  // Fetch state.
  property bool cacheSettled: false
  property bool initialRefreshStarted: false
  property bool attempted: false
  property bool fetching: false
  property bool lastFetchFailed: false
  property int failures: 0
  property bool refreshQueued: false
  property bool queuedForce: false
  property string requestedVersion: ""
  property var streamOutcome: null
  property bool streamDone: false
  property bool processExited: false
  property int exitedCode: -1

  property bool dirReady: false
  property var pendingCache: null
  property double nowMs: Date.now()
  property int toastId: 0

  readonly property bool haveVerse: verse !== null
  readonly property string today: Logic.utcDay(nowMs)
  readonly property bool isCurrent: haveVerse && verseDay === today && cachedVersion === translation
  readonly property bool stale: haveVerse && verseDay !== "" && verseDay !== today
  readonly property bool waiting: !haveVerse && !(cacheSettled && attempted)
  readonly property string creditText: haveVerse ? Logic.creditShort(verse.copyright) : ""
  readonly property string headline: haveVerse
    ? verse.reference + (Logic.versionShortName(verse) !== "" ? " (" + Logic.versionShortName(verse) + ")" : "")
    : ""

  readonly property string barLabel: {
    if (root.vertical || labelStyle === "glyph") return Logic.BOOK_GLYPH
    if (haveVerse) return Logic.elide(labelStyle === "full" ? verse.reference : Logic.shortenReference(verse), Logic.MAX_LABEL)
    return waiting ? qsTr("Verse") : qsTr("Verse?")
  }

  readonly property string tooltipText: {
    if (!haveVerse) return waiting ? qsTr("Loading today's verse") : qsTr("Verse unavailable. Middle-click to retry.")
    var lines = [headline]
    if (creditText !== "") lines.push(creditText)
    if (stale) lines.push(qsTr("Saved verse from %1 (UTC); not refreshed yet").arg(verseDay))
    else if (cachedVersion !== translation) lines.push(qsTr("Switching translation…"))
    return lines.join("\n")
  }

  onTranslationChanged: if (initialRefreshStarted) Qt.callLater(root.refresh, false)
  onEndpointChanged: if (initialRefreshStarted) Qt.callLater(root.refresh, false)

  function startInitialRefresh() {
    if (initialRefreshStarted) return
    initialRefreshStarted = true
    cacheSettled = true
    root.refresh(false)
  }

  // force: ignore the "already today's verse" short-circuit (middle-click).
  function refresh(force) {
    nowMs = Date.now()
    if (fetching) {
      refreshQueued = true
      queuedForce = queuedForce || force === true
      return
    }
    if (force !== true && isCurrent) {
      // Today's verse is already shown, so an earlier failure (e.g. a
      // middle-click while offline) no longer counts toward the backoff.
      failures = 0
      lastFetchFailed = false
      retryTimer.stop()
      scheduleMidnight()
      return
    }
    retryTimer.stop()
    requestedVersion = translation
    var args = Logic.fetchCommand(endpoint,
      haveVerse && cachedVersion === requestedVersion ? etag : "")
    streamOutcome = null
    streamDone = false
    processExited = false
    exitedCode = -1
    fetching = true
    fetchProc.command = args
    watchdog.restart()
    fetchProc.running = true
  }

  function currentCache() {
    return haveVerse ? { payload: verse, etag: etag, requestedVersion: cachedVersion } : null
  }

  function settleFetch(outcome) {
    if (!fetching) return
    fetching = false
    watchdog.stop()
    exitSettle.stop()
    attempted = true
    nowMs = Date.now()
    var stamp = new Date(nowMs).toISOString()

    if (outcome.kind === "fresh") {
      verse = outcome.payload
      etag = outcome.etag
      verseDay = outcome.day
      cachedVersion = requestedVersion
      fetchedAt = stamp
      networkWon = true
      persist()
    } else if (outcome.kind === "notModified") {
      etag = outcome.etag
      verseDay = outcome.day
      fetchedAt = stamp
      networkWon = true
      persist()
    }

    if (outcome.kind === "error") {
      failures += 1
      lastFetchFailed = true
      console.info(Logic.PLUGIN_ID + ": fetch failed (" + outcome.reason + "), retry in "
        + Math.round(Logic.retryDelayMs(failures) / 60000) + " min")
      retryTimer.interval = Logic.retryDelayMs(failures)
      retryTimer.restart()
    } else {
      failures = 0
      lastFetchFailed = false
      if (verseDay !== today) {
        // An edge cache can still hand out yesterday's verse right after
        // midnight. Look again shortly instead of waiting for tomorrow.
        retryTimer.interval = Logic.retryDelayMs(2)
        retryTimer.restart()
      } else {
        scheduleMidnight()
      }
    }

    if (refreshQueued) {
      var force = queuedForce
      refreshQueued = false
      queuedForce = false
      Qt.callLater(root.refresh, force)
    }
  }

  function finishFromProcess() {
    if (!fetching) return
    if (processExited && exitedCode === 0 && streamOutcome) settleFetch(streamOutcome)
    else if (processExited && exitedCode !== 0) settleFetch({ kind: "error", reason: "curl exit " + exitedCode })
    else if (streamOutcome) settleFetch(streamOutcome)
    else settleFetch({ kind: "error", reason: "curl did not run" })
  }

  function scheduleMidnight() {
    // Two minutes of slack: the API's edge cache expires just after 00:00 UTC.
    midnightTimer.interval = Logic.msUntilNextUtcMidnight(Date.now()) + 2 * 60 * 1000
    midnightTimer.restart()
  }

  function persist() {
    if (!haveVerse) return
    var obj = Logic.buildCache(verse, etag, verseDay, cachedVersion, fetchedAt)
    if (!dirReady) {
      pendingCache = obj
      if (!mkdirProc.running) mkdirProc.running = true
      return
    }
    cacheFile.setText(JSON.stringify(obj) + "\n")
  }

  function applyCache(text) {
    if (networkWon) return
    var cache = Logic.parseCache(text)
    if (!cache) return
    verse = cache.payload
    verseDay = cache.day
    etag = cache.etag
    cachedVersion = cache.requestedVersion
    fetchedAt = cache.fetchedAt
  }

  function peers() {
    var items = root.bar && typeof root.bar.moduleWidgets === "function" ? root.bar.moduleWidgets(root.moduleName) : []
    if (!items || items.length === 0) items = [root]
    return items
  }

  // One toast for every bar: monitors share the replace id.
  function sharedToastId() {
    var id = toastId
    var items = peers()
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].toastId !== undefined && items[i].toastId > id) id = items[i].toastId
    }
    return id
  }

  function adoptToastId(id) {
    var items = peers()
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].toastId !== undefined) items[i].toastId = id
    }
    toastId = id
  }

  function showVerse() {
    if (!haveVerse) {
      root.refresh(true)
      return
    }
    if (toastProc.running) return
    var body = Logic.escapeMarkup(verse.text)
    var credit = Logic.creditCompact(verse)
    if (credit !== "" && (showCredit || Logic.requiresCredit(verse.copyright)))
      body += "\n\u2014 " + Logic.escapeMarkup(credit)
    var args = [
      "omarchy-notification-send",
      "-p",
      "-g", Logic.BOOK_GLYPH,
      "-u", "low",
      "-t", String(toastTimeoutSec * 1000),
      "--app-name", root.moduleName
    ]
    var replaceId = sharedToastId()
    if (replaceId > 0) args.push("-r", String(replaceId))
    args.push(Logic.safeArg(headline), Logic.safeArg(body))
    toastProc.command = args
    toastProc.running = true
  }

  function forceRefresh() {
    root.refresh(true)
  }

  function statusJson() {
    return JSON.stringify({
      label: barLabel,
      tooltip: tooltipText,
      dimmed: waiting || stale,
      haveVerse: haveVerse,
      verseDay: verseDay,
      today: today,
      isCurrent: isCurrent,
      stale: stale,
      fetching: fetching,
      lastFetchFailed: lastFetchFailed,
      failures: failures,
      nextRetryMs: retryTimer.running ? retryTimer.interval : 0,
      midnightInMs: midnightTimer.running ? midnightTimer.interval : 0,
      etag: etag,
      translation: translation,
      endpoint: endpoint,
      fetchedAt: fetchedAt,
      cachePath: cachePath,
      toastId: toastId
    })
  }

  Component.onCompleted: {
    mkdirProc.running = true
    cacheFile.reload()
  }

  // FileView's first read can race shell startup (same pattern as the weather
  // panel). Retry the read once, then start fetching even without a cache.
  Timer {
    interval: 1500
    running: true
    onTriggered: if (!root.cacheSettled) cacheFile.reload()
  }

  Timer {
    interval: 3000
    running: true
    onTriggered: root.startInitialRefresh()
  }

  // No network while the cached verse is today's; this only catches missed
  // timers (suspend/resume) and keeps the stale marker honest.
  Timer {
    interval: 15 * 60 * 1000
    running: true
    repeat: true
    onTriggered: root.refresh(false)
  }

  Timer {
    id: midnightTimer
    onTriggered: root.refresh(false)
  }

  Timer {
    id: retryTimer
    onTriggered: root.refresh(false)
  }

  // curl has --max-time 10; anything still pending after 20s (or a process
  // that never started) settles as a failure so the bar never hangs.
  Timer {
    id: watchdog
    interval: 20000
    onTriggered: {
      if (!root.fetching) return
      if (fetchProc.running) fetchProc.running = false
      root.settleFetch({ kind: "error", reason: "timed out or did not start" })
    }
  }

  // Exit and stdout can arrive in either order; give the other side a moment.
  Timer {
    id: exitSettle
    interval: 750
    onTriggered: root.finishFromProcess()
  }

  Process {
    id: mkdirProc
    command: ["mkdir", "-p", root.cacheDir]
    onExited: function(exitCode, exitStatus) {
      root.dirReady = exitCode === 0
      if (root.dirReady && root.pendingCache) {
        var obj = root.pendingCache
        root.pendingCache = null
        cacheFile.setText(JSON.stringify(obj) + "\n")
      }
    }
  }

  FileView {
    id: cacheFile
    path: root.cachePath
    watchChanges: false
    atomicWrites: true
    printErrors: false
    onLoaded: {
      root.applyCache(String(text() || ""))
      root.startInitialRefresh()
    }
    onLoadFailed: function(error) {
      root.startInitialRefresh()
    }
  }

  Process {
    id: fetchProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        if (!root.fetching) return
        // head -c already bounds this; never parse more than the cap anyway.
        var out = text || ""
        root.streamOutcome = out.length > Logic.MAX_RESPONSE_BYTES
          ? { kind: "error", reason: "response too large" }
          : Logic.decideResponse(Logic.parseCurlOutput(String(out)),
              root.currentCache(), root.requestedVersion, Date.now())
        root.streamDone = true
        if (root.processExited) root.finishFromProcess()
        else exitSettle.restart()
      }
    }
    onExited: function(exitCode, exitStatus) {
      root.exitedCode = exitCode
      root.processExited = true
      if (root.streamDone) root.finishFromProcess()
      else exitSettle.restart()
    }
    onRunningChanged: if (!running && root.fetching && !root.processExited) exitSettle.restart()
  }

  Process {
    id: toastProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var id = parseInt(String(text || "").replace(/^\s+|\s+$/g, ""), 10)
        if (id > 0) root.adoptToastId(id)
      }
    }
  }

  // `omarchy-shell io.github.georgeanderson.verse-of-the-day show` from a
  // keybinding; `status` prints the widget state as JSON for debugging.
  IpcHandler {
    target: "io.github.georgeanderson.verse-of-the-day"

    function show(): void { root.showVerse() }
    function refresh(): void { root.broadcast("forceRefresh") }
    function status(): string { return root.statusJson() }
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.barLabel
    dimmed: root.waiting || root.stale
    tooltipText: root.tooltipText
    horizontalMargin: 8.75

    onPressed: function(b) {
      if (b === Qt.MiddleButton) root.refresh(true)
      else root.showVerse()
    }
  }
}
