# Changelog

All notable SDK changes are documented here. The TypeScript and Python packages
version independently; each entry names the affected package and version.

## Unreleased

## SDK release 2026-09-09

### `@boxcompute/sdk` 0.1.1

- **Security:** replaced polynomial-time regular-expression base URL
  normalization with a single-pass implementation. Callers that allow
  untrusted `baseUrl` values should upgrade from 0.1.0.
- Preserved the public API and Node.js 20-or-newer runtime requirement.

### `boxcompute` 0.1.0

- Initial Python release with synchronous and asynchronous clients, typed
  Pydantic models, structured errors, configurable timeouts, and injectable
  `httpx` transports.

### Release security

- The OpenAPI development toolchain overrides Redocly's exact `js-yaml`
  dependency to patched 4.3.2, addressing
  [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh).
- Python development and CI require pytest 9.0.3 or newer, addressing
  CVE-2025-71176 in the earlier test constraint.
- npm and PyPI publishing use trusted OIDC identities from protected GitHub
  environments. Build and test jobs do not receive OIDC permissions, and
  immutable artifacts cross into the publishing jobs through SHA-pinned
  GitHub Actions.
- Python distributions carry PyPI provenance for `boxcompute/sdk`,
  `publish-pypi.yml`, and the `pypi` environment.

## SDK release 2026-09-08

### `@boxcompute/sdk` 0.1.0

- Initial TypeScript release with ESM and CommonJS exports, generated types,
  structured errors, timeouts, cancellation, and asynchronous API-key
  providers.
- Superseded by 0.1.1 because base URL normalization in this version can take
  polynomial time for adversarial caller-controlled input.
