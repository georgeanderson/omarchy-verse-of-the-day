# Changelog

## 1.0.2 - 2026-10-13

- Cap each fetch at 64 KiB so an oversized or endless response can't use up
  memory or stall the shell: `curl --max-filesize 65536`, a `head -c` that
  stops chunked or length-less bodies at the source (with pipefail, so curl's
  exit status still counts), and a size check in QML and `Logic.js` before
  anything is copied or parsed. Oversized responses are treated as a failed
  fetch: the cached verse stays and the normal retry backoff applies.
- The URL and headers are passed to that pipeline as arguments, never
  interpolated into the shell script.
- An oversized cache file is ignored.

## 1.0.1 - 2026-10-11

- Reset the retry backoff when the verse on the bar is already today's, so a
  failed manual refresh no longer makes the next day's first retry wait 5
  minutes instead of 1.

## 1.0.0 - 2026-10-11

First public release.

- Bar widget showing today's verse reference; click for the full verse as a
  single, replacing Omarchy notification.
- Translation credit in the tooltip and toast (always for licenses that
  require attribution).
- Settings: translation (11 English translations), label style, credit,
  toast timeout.
- Offline cache under `${XDG_STATE_HOME:-~/.local/state}/io.github.georgeanderson.verse-of-the-day/`,
  with a stale marker for verses from an earlier UTC day.
- Conditional requests (ETag), no polling while the cached verse is current,
  refresh just after 00:00 UTC, retry with backoff.
- Settles cleanly when `curl` is missing, fails, or hangs.
- Vertical bar support (icon only) and elided long labels.
- IPC target with `show`, `refresh` and `status`.
- Compact translation credit in the toast so it is never cut off.
