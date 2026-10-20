# TODO

## Cuby independence from Memmy

Memmy → Cuby data migration is explicitly out of scope: users install Cuby
fresh, and the two products must be able to run independently. The remaining
work to remove Memmy infrastructure dependencies:

- [ ] **Cloud service** — `CUBY_CLOUD_SERVICE` still points at
  `https://api.memmy.cn`. The backend cloud client, analytics transport, agent
  external API, and update checks all use it. Move it to the Cuby backend.
- [ ] **Update channel** — the updater still calls
  `/api/memmy/desktop/latest` with `platformType` keys of the form
  `<platform>-<arch>-<cn|intl>-<signed|unsigned>`, which shares a namespace with
  Memmy. Move the endpoint and keys to a Cuby namespace, and plan the
  transition for already-installed clients (keep publishing under the old keys
  during the transition, or force an update with `minSupportedVersion`).
- [ ] **Legal and docs** — legal agreement pages and Memory documentation still
  link to `memmy.cn` / `memmy.bot`. Point them at the Cuby domains.
