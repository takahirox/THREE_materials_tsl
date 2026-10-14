# Three.js r186 validation

Validation for [Issue #11](https://github.com/takahirox/THREE_materials_tsl/issues/11),
performed on 2026-10-14 with Node.js 24.12.0 and npm 11.6.2.

## Release and installed versions

Rechecked the [latest GitHub release](https://github.com/mrdoob/three.js/releases/latest)
and npm's stable `latest` tags before upgrading. GitHub reported
[r186](https://github.com/mrdoob/three.js/releases/tag/r186), published 2026-09-24.
`npm view three dist-tags --json` reported `latest: 0.186.1`;
`npm view @types/three dist-tags --json` reported `latest: 0.186.0`.

All three packages' manifests and lockfiles now use those releases. After clean
`npm ci` installs, each package's installed manifests resolved to:

| Package | `three` | `@types/three` | Runtime `REVISION` |
| --- | --- | --- | --- |
| Loader | 0.186.1 | 0.186.0 | 186 |
| Exporter | 0.186.1 | 0.186.0 | 186 |
| Demo / integration suite | 0.186.1 | 0.186.0 | 186 |

The installed TypeScript version was 5.9.3 in each package.

## Compatibility fixes

The first run passed 61 of the 70 integration tests. The nine inferred
`UniformNode` literal-generation cases failed because r186's `NodeBuilder` now
reads `renderer.debug.diagnostics.keywords` when registering declarations. Their
fixture now supplies that setting while continuing to use Three.js's actual
`NodeBuilder`, uniform generation and type inference without a GPU.

The loader build and demo typecheck also exposed the new two-parameter
`ConstNode` generic declaration. The resolver's constructor annotations now
use the inferred placeholder type. Runtime construction, graph reconstruction
and Draft v2.0 semantics are unchanged. Existing tests cover both failures;
no additional regression cases were necessary.

The demo's version badge and all package README tested-baseline claims now say
r186. A dedicated demo `typecheck` script makes the check reproducible alongside
Vite's build, which does not typecheck TypeScript.

## Final checks

`npm ci` removes the existing `node_modules` before installing from the lockfile.
All checks below were run after that clean installation in every package.

| Command from repository root | Result |
| --- | --- |
| `npm --prefix packages/loader ci` | Passed |
| `npm --prefix packages/exporter ci` | Passed |
| `npm --prefix packages/demo ci` | Passed |
| `npm --prefix packages/demo test` | Passed: 70/70 tests, one test file |
| `npm --prefix packages/loader run build` | Passed |
| `npm --prefix packages/exporter run build` | Passed |
| `npm --prefix packages/demo run typecheck` | Passed |
| `npm --prefix packages/demo run build` | Passed; Vite warned about a chunk over 500 kB |
| `git diff --check` | Passed |

The real GLTFLoader/GLTFExporter suite covers required `materialType`, ordinary
core material properties and supported physical/unlit `KHR_materials_*` values,
dynamic `materialColor`, repeated round trips, shared nodes/materials,
primitive-specific clones, texture bindings/transforms, custom node/material
mappings, resource references and atomic fallback. Loader validation still
requires version `2.0`; exporter output is still version `2.0`. Both old-encoding
fallback cases (v1.0 with and without `materialType`) pass. No Draft v1.0
compatibility path or revision-based migration was added.

## Peer dependency review

Both libraries retain the existing `three >=0.182.0` peer range. The prior
implementation targeted r182, and this upgrade does not provide evidence to
raise the lower bound or declare earlier releases unsupported. This report
validates r186 only; it does not certify every release allowed by the peer
range. Package READMEs distinguish the declared range from the tested versions.

## Separate dependency audit and optional checks

The loader and exporter clean installs reported zero vulnerabilities. The demo's
`npm audit --json` reported ten affected build/test dependency packages:

| Severity | Packages |
| --- | --- |
| Moderate (3) | `@vitest/mocker`, `esbuild`, `vite-node` |
| High (5) | `nanoid`, `postcss`, `rollup`, `source-map-js`, `vite` |
| Critical (2) | `tinypool`, `vitest` |

These packages retain their previous locked versions. No finding names `three`
or `@types/three`. Findings include development-server file access, build-tool
path traversal, source-map handling and worker prototype pollution. npm's
suggested full remediation includes major Vite/Vitest upgrades, which are
outside this focused Three.js compatibility change. No audit fixes were applied.

The optional browser/WebGPU visual smoke test was not performed: validation
used the Node integration environment and did not exercise a browser or GPU.
Passing integration tests and builds does not establish GPU pixel output.

No npm publication, push, PR, merge or GitHub comment was performed. npm
publication remains a separate manual operation after review; no post-merge
verification is required by this issue.
