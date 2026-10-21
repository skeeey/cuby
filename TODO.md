# TODO

## Cuby independence from Memmy

Memmy → Cuby data migration is explicitly out of scope: users install Cuby
fresh, and the two products must be able to run independently. The desktop now
ships one universal installer per platform/arch; legal/docs pages follow the UI
language. The remaining work to remove Memmy infrastructure dependencies:

- [ ] **Cloud service** — `CUBY_CLOUD_SERVICE` still points at
  `https://api.memmy.cn`. The backend cloud client, analytics transport, agent
  external API, and update checks all use it. Move it to the Cuby backend.
- [ ] **Online update channel (deferred)** — online upgrades are not used right
  now; users reinstall with the installer. When online updates are added, move
  `/api/memmy/desktop/latest` and the `platformType` keys to a Cuby namespace,
  and plan the transition for already-installed clients (keep publishing under
  the old keys, or force an update with `minSupportedVersion`).
- [ ] **Legal and docs** — legal agreement pages and Memory documentation still
  link to `memmy.cn` / `memmy.bot`. Point them at the Cuby domains.
