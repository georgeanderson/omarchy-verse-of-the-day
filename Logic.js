.pragma library

// Pure helpers for BarWidget.qml. No QML imports, ES5-style, so the Node tests
// in tests/ can load this file directly.

var PLUGIN_ID = "io.github.georgeanderson.verse-of-the-day"
var DEFAULT_API_BASE = "https://api.midvash.com"
var DEFAULT_VERSION = "web"
// English translations offered by GET /v1/versions?language=en.
var VERSIONS = ["web", "kjv", "asv", "bsb", "ylt", "dra", "bbe", "geneva1599", "lsv", "darby", "rv1885"]
var LABEL_STYLES = ["short", "full", "glyph"]
var BOOK_GLYPH = "\uf02d"
var MAX_LABEL = 24
var RETRY_MINUTES = [1, 5, 15, 30, 60]
var CACHE_SCHEMA = 1

function trim(value) {
  if (value === undefined || value === null) return ""
  return String(value).replace(/^\s+|\s+$/g, "")
}

function normalizeVersion(value) {
  var v = trim(value).toLowerCase()
  return VERSIONS.indexOf(v) !== -1 ? v : DEFAULT_VERSION
}

function normalizeLabelStyle(value) {
  var v = trim(value).toLowerCase()
  return LABEL_STYLES.indexOf(v) !== -1 ? v : "short"
}

function toBool(value, fallback) {
  if (value === true || value === false) return value
  var s = trim(value).toLowerCase()
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true
  if (s === "false" || s === "0" || s === "no" || s === "off") return false
  return fallback
}

function clampInt(value, min, max, fallback) {
  var n = parseInt(value, 10)
  if (isNaN(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

// Only plain http(s) bases are accepted; anything else falls back to midvash.
function normalizeApiBase(value) {
  var v = trim(value)
  if (!/^https?:\/\/[A-Za-z0-9.\-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~\-\/]*)?$/.test(v)) return DEFAULT_API_BASE
  return v.replace(/\/+$/, "")
}

function endpointFor(apiBase, version) {
  return normalizeApiBase(apiBase) + "/v1/votd?language=en&version=" + normalizeVersion(version)
}

function positiveInt(value) {
  if (value === undefined || value === null || value === "") return null
  var n = Number(value)
  if (!isFinite(n) || n <= 0 || Math.floor(n) !== n) return null
  return n
}

// Validate and copy an API payload. Returns null when it is unusable.
function validPayload(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  var reference = trim(data.reference).slice(0, 200)
  var text = trim(data.text).slice(0, 4000)
  if (reference === "" || text === "") return null
  return {
    reference: reference,
    text: text,
    version: trim(data.version).toLowerCase().slice(0, 32),
    book_slug: trim(data.book_slug).toLowerCase().slice(0, 64),
    chapter: positiveInt(data.chapter),
    verse_start: positiveInt(data.verse_start),
    verse_end: positiveInt(data.verse_end),
    url: trim(data.url).slice(0, 500),
    copyright: trim(data.copyright).slice(0, 2000)
  }
}

var BOOKS = {
  "genesis": "Gen", "exodus": "Exod", "leviticus": "Lev", "numbers": "Num",
  "deuteronomy": "Deut", "joshua": "Josh", "judges": "Judg", "ruth": "Ruth",
  "1-samuel": "1 Sam", "2-samuel": "2 Sam", "1-kings": "1 Kgs", "2-kings": "2 Kgs",
  "1-chronicles": "1 Chr", "2-chronicles": "2 Chr", "ezra": "Ezra", "nehemiah": "Neh",
  "esther": "Esth", "job": "Job", "psalm": "Ps", "psalms": "Ps", "proverbs": "Prov",
  "ecclesiastes": "Eccl", "song-of-solomon": "Song", "song-of-songs": "Song",
  "isaiah": "Isa", "jeremiah": "Jer", "lamentations": "Lam", "ezekiel": "Ezek",
  "daniel": "Dan", "hosea": "Hos", "joel": "Joel", "amos": "Amos", "obadiah": "Obad",
  "jonah": "Jonah", "micah": "Mic", "nahum": "Nah", "habakkuk": "Hab",
  "zephaniah": "Zeph", "haggai": "Hag", "zechariah": "Zech", "malachi": "Mal",
  "matthew": "Matt", "mark": "Mark", "luke": "Luke", "john": "John", "acts": "Acts",
  "romans": "Rom", "1-corinthians": "1 Cor", "2-corinthians": "2 Cor",
  "galatians": "Gal", "ephesians": "Eph", "philippians": "Phil", "colossians": "Col",
  "1-thessalonians": "1 Thess", "2-thessalonians": "2 Thess", "1-timothy": "1 Tim",
  "2-timothy": "2 Tim", "titus": "Titus", "philemon": "Phlm", "hebrews": "Heb",
  "james": "Jas", "1-peter": "1 Pet", "2-peter": "2 Pet", "1-john": "1 John",
  "2-john": "2 John", "3-john": "3 John", "jude": "Jude", "revelation": "Rev"
}

function shortBook(slug) {
  var key = trim(slug).toLowerCase()
  return Object.prototype.hasOwnProperty.call(BOOKS, key) ? BOOKS[key] : ""
}

// Longest names first so "1 Thessalonians" wins over "Thessalonians".
var KNOWN_NAMES = [
  ["1 Thessalonians", "1 Thess"], ["2 Thessalonians", "2 Thess"],
  ["1 Corinthians", "1 Cor"], ["2 Corinthians", "2 Cor"],
  ["1 Chronicles", "1 Chr"], ["2 Chronicles", "2 Chr"],
  ["1 Samuel", "1 Sam"], ["2 Samuel", "2 Sam"], ["1 Timothy", "1 Tim"], ["2 Timothy", "2 Tim"],
  ["1 Kings", "1 Kgs"], ["2 Kings", "2 Kgs"], ["1 Peter", "1 Pet"], ["2 Peter", "2 Pet"],
  ["1 John", "1 John"], ["2 John", "2 John"], ["3 John", "3 John"],
  ["Song of Solomon", "Song"], ["Song of Songs", "Song"], ["Deuteronomy", "Deut"],
  ["Ecclesiastes", "Eccl"], ["Lamentations", "Lam"], ["Thessalonians", "Thess"],
  ["Corinthians", "Cor"], ["Philippians", "Phil"], ["Colossians", "Col"],
  ["Zechariah", "Zech"], ["Zephaniah", "Zeph"], ["Revelation", "Rev"], ["Leviticus", "Lev"],
  ["Nehemiah", "Neh"], ["Habakkuk", "Hab"], ["Ephesians", "Eph"], ["Galatians", "Gal"],
  ["Philemon", "Phlm"], ["Obadiah", "Obad"], ["Proverbs", "Prov"], ["Jeremiah", "Jer"],
  ["Ezekiel", "Ezek"], ["Genesis", "Gen"], ["Exodus", "Exod"], ["Numbers", "Num"],
  ["Matthew", "Matt"], ["Hebrews", "Heb"], ["Isaiah", "Isa"], ["Esther", "Esth"],
  ["Joshua", "Josh"], ["Judges", "Judg"], ["Psalms", "Ps"], ["Daniel", "Dan"],
  ["Hosea", "Hos"], ["Romans", "Rom"], ["Haggai", "Hag"], ["Malachi", "Mal"],
  ["Timothy", "Tim"], ["Samuel", "Sam"], ["Chronicles", "Chr"], ["James", "Jas"],
  ["Psalm", "Ps"]
]

function shortenKnownName(reference) {
  var ref = trim(reference)
  for (var i = 0; i < KNOWN_NAMES.length; i++) {
    var name = KNOWN_NAMES[i][0]
    if (ref.indexOf(name) === 0) {
      var next = ref.charAt(name.length)
      // Whole-word match only: "Johnny 1:1" must not become "Johnny".
      if (next === "" || next === " ") return KNOWN_NAMES[i][1] + ref.slice(name.length)
    }
  }
  return ref
}

function shortenReference(data) {
  if (!data || typeof data !== "object") return ""
  var book = shortBook(data.book_slug)
  var chapter = positiveInt(data.chapter)
  var start = positiveInt(data.verse_start)
  var end = positiveInt(data.verse_end)
  if (book !== "" && chapter !== null && start !== null) {
    var verses = String(start)
    if (end !== null && end > start) verses += "-" + String(end)
    return book + " " + chapter + ":" + verses
  }
  return shortenKnownName(data.reference)
}

function elide(text, max) {
  var s = String(text === undefined || text === null ? "" : text)
  if (s.length <= max) return s
  return s.slice(0, Math.max(1, max - 1)).replace(/\s+$/, "") + "\u2026"
}

// The Omarchy notification body renders as StyledText.
function escapeMarkup(text) {
  return String(text === undefined || text === null ? "" : text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// omarchy-notification-send parses leading-dash words as options; a word
// joiner in front keeps API text from ever being read as a flag.
function safeArg(text) {
  var s = String(text === undefined || text === null ? "" : text)
  return /^-/.test(s) ? "\u2060" + s : s
}

function copyrightLines(copyright) {
  var lines = trim(copyright).split(/\r?\n/)
  var out = []
  for (var i = 0; i < lines.length; i++) {
    var line = trim(lines[i])
    if (line !== "") out.push(line)
  }
  return out
}

// "World English Bible (WEB), Public Domain (CC0)"
function creditShort(copyright) {
  var lines = copyrightLines(copyright)
  if (lines.length === 0) return ""
  var parts = [lines[0]]
  var holder = ""
  var license = ""
  for (var i = 1; i < lines.length; i++) {
    if (holder === "" && /^copyright\b|^\u00a9/i.test(lines[i])) holder = lines[i]
    if (license === "" && /public domain|creative commons|\bCC BY/i.test(lines[i])) license = lines[i]
  }
  if (holder !== "") parts.push(holder)
  if (license !== "") parts.push(license)
  for (var j = 0; j < parts.length; j++) parts[j] = parts[j].replace(/\.$/, "")
  return parts.join(", ")
}

// Compact credit for the toast, whose body the notifier caps at three lines:
// "WEB, Public Domain (CC0)" or "LSV, © 2020 Covenant Press, CC BY-SA 4.0".
function creditCompact(payload) {
  var lines = copyrightLines(payload ? payload.copyright : "")
  if (lines.length === 0) return ""
  var parts = [versionShortName(payload)]
  for (var i = 1; i < lines.length; i++) {
    var line = lines[i].replace(/\.$/, "")
    var holder = /^copyright\s+(\u00a9.*)$/i.exec(line)
    if (holder) { parts.push(holder[1]); break }
  }
  for (var j = 1; j < lines.length; j++) {
    var l = lines[j].replace(/\.$/, "")
    if (/public domain/i.test(l)) { parts.push(l); break }
    var cc = /\((CC [^)]+)\)/.exec(l)
    if (cc) { parts.push(cc[1]); break }
  }
  return parts.join(", ")
}

// Licenses such as CC BY-SA need the credit next to the text.
function requiresCredit(copyright) {
  var c = trim(copyright)
  if (c === "") return false
  if (/creative commons|\bCC BY/i.test(c)) return true
  return /\bcopyright\b|\u00a9/i.test(c) && !/public domain/i.test(c)
}

function versionShortName(payload) {
  var lines = copyrightLines(payload ? payload.copyright : "")
  if (lines.length > 0) {
    var m = /\(([A-Za-z0-9]{2,10})\)\s*$/.exec(lines[0])
    if (m) return m[1]
  }
  return trim(payload ? payload.version : "").toUpperCase()
}

function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

function msUntilNextUtcMidnight(nowMs) {
  var d = new Date(nowMs)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - nowMs
}

function retryDelayMs(failures) {
  var i = Math.max(1, failures) - 1
  return RETRY_MINUTES[Math.min(i, RETRY_MINUTES.length - 1)] * 60000
}

function sanitizeEtag(etag) {
  var e = trim(etag)
  return /^(W\/)?"[\x21\x23-\x7e]{1,200}"$/.test(e) ? e : ""
}

function dayFromEtag(etag) {
  var m = /(\d{4}-\d{2}-\d{2})/.exec(String(etag || ""))
  return m ? m[1] : ""
}

// curl -D - writes every header block before the body.
function parseCurlOutput(raw) {
  var rest = String(raw || "")
  var status = 0
  var etag = ""
  while (/^HTTP\/[0-9.]+ [0-9]{3}/.test(rest)) {
    var sep = /\r?\n\r?\n/.exec(rest)
    var head = sep ? rest.slice(0, sep.index) : rest
    status = parseInt(/^HTTP\/[0-9.]+ ([0-9]{3})/.exec(head)[1], 10)
    var em = /^etag:[ \t]*(.*?)[ \t\r]*$/im.exec(head)
    etag = em ? em[1] : ""
    rest = sep ? rest.slice(sep.index + sep[0].length) : ""
  }
  return { status: status, etag: sanitizeEtag(etag), body: rest }
}

// Decide what a finished curl run means.
//   fresh:       new payload to show and cache
//   notModified: the cached payload is still today's
//   error:       keep what we have and retry later
function decideResponse(parsed, cache, requestedVersion, nowMs) {
  if (!parsed || parsed.status === 0) return { kind: "error", reason: "no HTTP response" }
  if (parsed.status === 304) {
    if (cache && cache.payload && cache.requestedVersion === requestedVersion) {
      var etag = parsed.etag || cache.etag
      return { kind: "notModified", etag: etag, day: dayFromEtag(etag) || utcDay(nowMs) }
    }
    return { kind: "error", reason: "304 without a cached verse" }
  }
  if (parsed.status !== 200) return { kind: "error", reason: "HTTP " + parsed.status }
  var data = null
  try {
    data = JSON.parse(trim(parsed.body))
  } catch (e) {
    return { kind: "error", reason: "malformed JSON" }
  }
  var payload = validPayload(data)
  if (!payload) return { kind: "error", reason: "unexpected payload" }
  return { kind: "fresh", payload: payload, etag: parsed.etag, day: dayFromEtag(parsed.etag) || utcDay(nowMs) }
}

function buildCache(payload, etag, day, requestedVersion, fetchedAt) {
  return {
    schema: CACHE_SCHEMA,
    fetchedAt: fetchedAt,
    day: day,
    etag: etag || "",
    requestedVersion: requestedVersion,
    payload: payload
  }
}

function parseCache(text) {
  var data = null
  try {
    data = JSON.parse(trim(text))
  } catch (e) {
    return null
  }
  if (!data || typeof data !== "object" || data.schema !== CACHE_SCHEMA) return null
  var payload = validPayload(data.payload)
  if (!payload) return null
  var day = /^\d{4}-\d{2}-\d{2}$/.test(String(data.day || "")) ? data.day : ""
  return {
    payload: payload,
    day: day,
    fetchedAt: trim(data.fetchedAt).slice(0, 40),
    etag: sanitizeEtag(data.etag),
    requestedVersion: normalizeVersion(data.requestedVersion)
  }
}
