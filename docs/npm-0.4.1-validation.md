# Loader/exporter 0.4.1 release validation

Pre-merge validation for [Issue #13](https://github.com/takahirox/THREE_materials_tsl/issues/13),
performed on 2026-10-14 with Node.js 24.12.0 and npm 11.6.2.

Both package manifests and their lockfiles' top-level and root package entries
declare `0.4.1`. Dependency versions, scoped names, public access and export paths
are unchanged. Clean `npm ci` installs in loader, exporter and demo resolved
`three@0.186.1`, `@types/three@0.186.0` and `typescript@5.9.3` in each package.

## Packing and publication lifecycle

The following checks ran from **each library's package directory**, after its
clean dependency installation:

1. `npm run clean` removed `dist/`; its absence was asserted before packing.
2. `npm pack --json --pack-destination <temporary-directory>` succeeded without
   a separately invoked build. The resulting tarball contained 15 files for
   loader and 23 for exporter, including `dist/index.js`, `dist/index.d.ts`, the
   compiled plugin and resolver/serializer, their declarations, source and
   declaration maps, `package.json`, `README.md` and `LICENSE`.
3. Every file in the freshly generated `dist/` was present in the tarball and
   matched the build output byte for byte. The packed manifest matched the
   local manifest; neither `src/` nor `node_modules/` was packaged.
4. The packed loader checks `raw.version !== '2.0'` and validates the required
   `materialType`; its declaration requires `version: '2.0'` and
   `materialType: string`. The packed exporter emits `version: '2.0'` and
   `materialType: material.type`. Neither compiled plugin contains v1.0
   processing or the removed `supportedVersions` option. Library sources were
   unchanged, and the existing integration suite passed the old-encoding
   fallback cases.
5. Before each of `npm pack --dry-run --json` and `npm publish --dry-run`, a
   stale sentinel file was added to `dist/`. Both commands succeeded and
   removed the sentinel, confirming that their normal lifecycle invokes the
   clean build. The publication check was a dry run only.

Temporary tarballs were inspected locally and then removed.

## Build failure prevents packing

For each library, a temporary `src/release-build-failure.ts` contained:

```ts
const releaseBuildFailure: number = 'intentional build failure';
export {};
```

A stale sentinel was placed in the existing `dist/` before each failure check.
Both `npm pack --json --pack-destination <temporary-directory>` and
`npm publish --dry-run` failed with exit code 2 and TypeScript error `TS2322`.
The failed command reported the `npm run clean && npm run build` hook; the stale
sentinel was removed and no tarball was produced. This verifies that a failed
build aborts the lifecycle rather than packing existing artifacts. The `&&`
also prevents the build from running if cleaning fails.

The temporary source was removed in a cleanup block, followed by `npm run clean`.
Final library builds then passed with the original sources. These failure
checks made no registry changes.

## Required checks

| Command from repository root | Result |
| --- | --- |
| `npm --prefix packages/loader ci` | Passed |
| `npm --prefix packages/exporter ci` | Passed |
| `npm --prefix packages/demo ci` | Passed |
| `npm --prefix packages/demo test` | Passed: 70/70 tests |
| `npm --prefix packages/loader run build` | Passed |
| `npm --prefix packages/exporter run build` | Passed |
| `npm --prefix packages/demo run typecheck` | Passed |
| `npm --prefix packages/demo run build` | Passed; existing chunk-size warning |
| `git diff --check` | Passed |

Library installs reported zero vulnerabilities. Demo installation reported the
same ten dependency vulnerabilities documented in the
[r186 validation report](three-r186-validation.md#separate-dependency-audit-and-optional-checks).
Dependency remediation is outside this release reliability change.

## Pending manual post-merge verification

The maintainer must publish both libraries after review and merge, confirm both
registry versions are `0.4.1`, inspect the published tarballs for Draft v2.0
compiled files, and record the results. The package READMEs provide the manual
[loader](../packages/loader/README.md#manual-publishing-maintainer-only) and
[exporter](../packages/exporter/README.md#manual-publishing-maintainer-only)
commands and prohibit `--ignore-scripts`.

No actual npm publication, post-publication verification, deprecation, push,
PR, merge or GitHub comment was performed. Optional inspection of the already
published 0.4.0 tarballs was not performed; their contents remain unconfirmed.
