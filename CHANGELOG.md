# Changelog

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
