"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const L = require("./load-logic")()

const WEB = "World English Bible (WEB)\nPublic Domain (CC0).\nThe World English Bible has been dedicated to the public domain by its translators and may be freely used and distributed."
const LSV = "Literal Standard Version (LSV)\nCopyright \u00a9 2020 Covenant Press\nThe Literal Standard Version of the Holy Bible is a registered copyright of Covenant Press and the Covenant Christian Coalition (\u00a9 2020).\nCreative Commons Attribution-ShareAlike 4.0 International License (CC BY-SA 4.0).\nSource: eBible.org."

test("shortenReference uses book_slug, chapter and verses", () => {
  assert.equal(L.shortenReference({ book_slug: "james", chapter: 1, verse_start: 22, verse_end: 22, reference: "James 1:22" }), "Jas 1:22")
  assert.equal(L.shortenReference({ book_slug: "1-corinthians", chapter: 15, verse_start: 58 }), "1 Cor 15:58")
  assert.equal(L.shortenReference({ book_slug: "psalms", chapter: "23", verse_start: "1", verse_end: "3" }), "Ps 23:1-3")
  assert.equal(L.shortenReference({ book_slug: "song-of-songs", chapter: 2, verse_start: 4, verse_end: 4 }), "Song 2:4")
})

test("shortenReference ignores a reversed or missing range end", () => {
  assert.equal(L.shortenReference({ book_slug: "john", chapter: 3, verse_start: 16, verse_end: 10 }), "John 3:16")
  assert.equal(L.shortenReference({ book_slug: "john", chapter: 3, verse_start: 16, verse_end: null }), "John 3:16")
})

test("shortenReference falls back to the reference string", () => {
  assert.equal(L.shortenReference({ reference: "1 Thessalonians 5:16-18" }), "1 Thess 5:16-18")
  assert.equal(L.shortenReference({ reference: "Psalms 119:105" }), "Ps 119:105")
  assert.equal(L.shortenReference({ book_slug: "unknown-book", chapter: 1, verse_start: 1, reference: "Revelation 21:4" }), "Rev 21:4")
  assert.equal(L.shortenReference({ book_slug: "james", chapter: 0, verse_start: 1, reference: "James 1:1" }), "Jas 1:1")
})

test("shortenReference matches whole book names only", () => {
  assert.equal(L.shortenReference({ reference: "Johnny 1:1" }), "Johnny 1:1")
  assert.equal(L.shortenReference({ reference: "Salmos 23:1" }), "Salmos 23:1")
  assert.equal(L.shortenReference({}), "")
  assert.equal(L.shortenReference(null), "")
})

test("validPayload rejects unusable data", () => {
  assert.equal(L.validPayload(null), null)
  assert.equal(L.validPayload([]), null)
  assert.equal(L.validPayload({ reference: "  ", text: "x" }), null)
  assert.equal(L.validPayload({ reference: "John 3:16", text: "" }), null)
  const p = L.validPayload({ reference: " John 3:16 ", text: " For God... ", chapter: "x", version: "WEB" })
  assert.equal(p.reference, "John 3:16")
  assert.equal(p.chapter, null)
  assert.equal(p.version, "web")
})

test("parseCurlOutput splits headers and body, keeping the last block", () => {
  const raw = "HTTP/1.1 100 Continue\r\n\r\nHTTP/2 200 \r\ncontent-type: application/json\r\netag: \"votd-cr-2026-10-11-en-web-59-1-22-22\"\r\n\r\n{\"a\":1}"
  const r = L.parseCurlOutput(raw)
  assert.equal(r.status, 200)
  assert.equal(r.etag, "\"votd-cr-2026-10-11-en-web-59-1-22-22\"")
  assert.equal(r.body, "{\"a\":1}")
  assert.equal(L.parseCurlOutput("").status, 0)
  assert.equal(L.parseCurlOutput("HTTP/2 200\r\netag: bad etag\r\n\r\n{}").etag, "")
})

test("decideResponse handles 200, 304, errors and malformed JSON", () => {
  const now = Date.UTC(2026, 9, 11, 12)
  const body = JSON.stringify({ reference: "James 1:22", text: "Be doers", version: "web", copyright: WEB })
  const fresh = L.decideResponse({ status: 200, etag: "\"votd-cr-2026-10-11-x\"", body }, null, "web", now)
  assert.equal(fresh.kind, "fresh")
  assert.equal(fresh.day, "2026-10-11")
  const cache = { payload: fresh.payload, etag: "\"votd-cr-2026-10-10-x\"", requestedVersion: "web" }
  assert.equal(L.decideResponse({ status: 304, etag: "", body: "" }, cache, "web", now).day, "2026-10-10")
  assert.equal(L.decideResponse({ status: 304, etag: "", body: "" }, cache, "kjv", now).kind, "error")
  assert.equal(L.decideResponse({ status: 503, etag: "", body: "" }, cache, "web", now).kind, "error")
  assert.equal(L.decideResponse({ status: 200, etag: "", body: "<html>" }, cache, "web", now).reason, "malformed JSON")
  assert.equal(L.decideResponse({ status: 200, etag: "", body: "{}" }, cache, "web", now).reason, "unexpected payload")
  assert.equal(L.decideResponse({ status: 0 }, cache, "web", now).kind, "error")
})

test("cache round-trips and rejects junk", () => {
  const payload = L.validPayload({ reference: "James 1:22", text: "Be doers", copyright: WEB })
  const text = JSON.stringify(L.buildCache(payload, "\"e\"", "2026-10-11", "web", "2026-10-11T12:00:00.000Z"))
  const c = L.parseCache(text)
  assert.equal(c.payload.reference, "James 1:22")
  assert.equal(c.day, "2026-10-11")
  assert.equal(c.requestedVersion, "web")
  assert.equal(L.parseCache("not json"), null)
  assert.equal(L.parseCache(JSON.stringify({ schema: 2, payload })), null)
  assert.equal(L.parseCache(JSON.stringify({ reference: "old format", text: "x" })), null)
})

test("credit text and attribution rules", () => {
  assert.equal(L.creditShort(WEB), "World English Bible (WEB), Public Domain (CC0)")
  assert.equal(L.creditShort(LSV), "Literal Standard Version (LSV), Copyright \u00a9 2020 Covenant Press, Creative Commons Attribution-ShareAlike 4.0 International License (CC BY-SA 4.0)")
  assert.equal(L.creditCompact({ copyright: WEB, version: "web" }), "WEB, Public Domain (CC0)")
  assert.equal(L.creditCompact({ copyright: LSV, version: "lsv" }), "LSV, \u00a9 2020 Covenant Press, CC BY-SA 4.0")
  assert.equal(L.creditCompact({ copyright: "", version: "web" }), "")
  assert.equal(L.requiresCredit(WEB), false)
  assert.equal(L.requiresCredit(LSV), true)
  assert.equal(L.versionShortName({ copyright: WEB, version: "web" }), "WEB")
  assert.equal(L.versionShortName({ copyright: "", version: "kjv" }), "KJV")
})

test("markup escaping and argument safety", () => {
  assert.equal(L.escapeMarkup("a < b & c > d"), "a &lt; b &amp; c &gt; d")
  assert.equal(L.escapeMarkup("<img src=\"http://x\">"), "&lt;img src=\"http://x\"&gt;")
  assert.equal(L.safeArg("--exec"), "\u2060--exec")
  assert.equal(L.safeArg("John 3:16"), "John 3:16")
})

test("settings normalization", () => {
  assert.equal(L.normalizeVersion("KJV"), "kjv")
  assert.equal(L.normalizeVersion("niv"), "web")
  assert.equal(L.normalizeLabelStyle("glyph"), "glyph")
  assert.equal(L.normalizeLabelStyle("weird"), "short")
  assert.equal(L.toBool("false", true), false)
  assert.equal(L.toBool(undefined, true), true)
  assert.equal(L.clampInt("500", 3, 120, 15), 120)
  assert.equal(L.clampInt("x", 3, 120, 15), 15)
  assert.equal(L.normalizeApiBase(""), "https://api.midvash.com")
  assert.equal(L.normalizeApiBase("http://127.0.0.1:8765/"), "http://127.0.0.1:8765")
  assert.equal(L.normalizeApiBase("file:///etc/passwd"), "https://api.midvash.com")
  assert.equal(L.normalizeApiBase("https://x.test/a b"), "https://api.midvash.com")
  assert.equal(L.endpointFor("", "kjv"), "https://api.midvash.com/v1/votd?language=en&version=kjv")
})

test("time helpers", () => {
  assert.equal(L.utcDay(Date.UTC(2026, 9, 11, 23, 59)), "2026-10-11")
  assert.equal(L.msUntilNextUtcMidnight(Date.UTC(2026, 9, 11, 23, 0)), 3600000)
  assert.equal(L.msUntilNextUtcMidnight(Date.UTC(2026, 11, 31, 12, 0)), 12 * 3600000)
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(n => L.retryDelayMs(n) / 60000), [1, 5, 15, 30, 60, 60])
  assert.equal(L.dayFromEtag("\"votd-cr-2026-10-11-en-web\""), "2026-10-11")
})

test("elide", () => {
  assert.equal(L.elide("short", 24), "short")
  assert.equal(L.elide("A very long reference name 12:34", 24).length, 24)
  assert.ok(L.elide("A very long reference name 12:34", 24).endsWith("\u2026"))
})
