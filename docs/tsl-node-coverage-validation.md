# Issue #15 validation

Validated in the assigned worktree on 2026-10-15 against `three@0.186.1`
and `@types/three@0.186.0` (r186). GitHub's latest stable release and npm's
latest package were rechecked; r186 / 0.186.1 remained current. No dependency
versions, extension schema or package versions were changed.

The [coverage matrix](tsl-node-coverage.md) classifies every class declared under
`src/nodes`, records every shared TSL node export, and distinguishes factories,
closures and supporting APIs. Its inventory test checks 152 source classes,
179 shared export names (178 distinct objects), and the public export counts.

| Command, from repository root | Result |
| --- | --- |
| `npm --prefix packages/loader ci` | Passed; 0 audit findings. |
| `npm --prefix packages/exporter ci` | Passed; 0 audit findings. |
| `npm --prefix packages/demo ci` | Passed; reported 10 existing dependency audit findings (3 moderate, 5 high, 2 critical); dependencies were not changed. |
| `npm --prefix packages/demo test` | Passed: 103 tests across 2 files, including the full existing integration suite. |
| `npm --prefix packages/loader run build` | Passed. |
| `npm --prefix packages/exporter run build` | Passed. |
| `npm --prefix packages/demo run typecheck` | Passed. |
| `npm --prefix packages/demo run build` | Passed; Vite reports its large-chunk warning. |
| `git diff --check` | Passed. |

The new integration cases cover all 12 new classes with real glTF export/import,
two repeated round trips, values/fields, shared inputs and material entrypoints.
They compare Three.js GLSLNodeBuilder output after setup/analyze/generate,
including vertex flow for varyings, against the original graphs. Additional
cases cover fluent TSL expressions with implicit VarNodes and dynamic shared
material/position/time references, optional/default settings, malformed graphs,
unsupported executable/resource nodes and callbacks, and whole-material fallback.
The existing nested node/texture/accessor adapter tests remain in the full suite.
All exported shared objects are checked by identity, and function-valued exports
are confirmed not to become default resolver operations.

Optional browser/WebGPU visual checks were skipped: this validation uses the
repository's Node integration infrastructure and Three.js shader builder without
a browser/GPU. It does not establish GPU shader compilation or pixel correctness.
No mandatory checks were skipped. Required post-merge verification: none.
Publishing packages is outside this issue.
