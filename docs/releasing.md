# Releasing

The TypeScript and Python packages release independently from protected GitHub
Actions environments. Never publish from a developer workstation after the
initial registry setup.

## Repository prerequisites

1. Make `boxcompute/sdk` public so customers can audit the source and npm can
   attach provenance to releases.
2. Create protected GitHub environments named `npm` and `pypi`.
3. Configure npm trusted publishing for package `@boxcompute/sdk`, repository
   `boxcompute/sdk`, workflow `publish-npm.yml`, environment `npm`.
4. Configure a pending PyPI trusted publisher for project `boxcompute`,
   repository `boxcompute/sdk`, workflow `publish-pypi.yml`, environment `pypi`.
5. Require the SDK validation workflow before merging to `main`.
6. Enable GitHub private vulnerability reporting under **Settings → Security →
   Code security** before announcing the repository.

The current developer shell does not need long-lived npm or PyPI tokens. Each
release workflow exchanges its GitHub OIDC identity for a short-lived registry
credential.

## TypeScript

Update `packages/typescript/package.json` and the changelog, merge the tested
change to `main`, then dispatch **Publish TypeScript SDK** with `publish=true`.
The workflow refuses to overwrite an existing version and verifies the new npm
version after publication.

## Python

Update `packages/python/pyproject.toml` and the changelog, merge the tested
change to `main`, then dispatch **Publish Python SDK** with `publish=true`. The
workflow builds both the wheel and source distribution, refuses an existing
version, and publishes through PyPI trusted publishing.

## Repository release notes

After every package in a release set is published and verified, create one
GitHub Release that follows the BoxCompute integrator-release convention:

1. Tag the exact qualified `main` commit as `sdk-YYYY-MM-DD`. Add `.2`, `.3`,
   and so on for another release on the same date. Never move or reuse a tag.
2. Use the tag as the release title. Start with a one-paragraph summary, then
   list customer-visible changes under `## Consumers`. Add `## Security` when
   security posture or consumer action changed.
3. Name every npm and PyPI version in the release. These versions are
   independent and may differ.
4. End the notes with `Through: <full commit SHA>` so the published packages,
   source snapshot, and qualification evidence have one explicit boundary.
5. Create the release as a draft, verify the target, notes, registry versions,
   provenance, and clean-install checks, then publish it unchanged.
