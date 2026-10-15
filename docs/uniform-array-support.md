# Bounded uniform-array round trips (Issue #25)

## Upstream audit

Audited the installed **three@0.186.1** sources and bundled TSL stack. On
2026-10-16, the npm registry's [stable `latest` release](https://registry.npmjs.org/three/latest)
was also 0.186.1. This is an r186 audit, not a compatibility claim for every
version admitted by the existing peer range. Package versions, locks and Draft
v2.0 remain unchanged.

| Native source | Constructor data and behavior | Serialization / runtime state |
| --- | --- | --- |
| [UniformArrayNode and UniformArrayElementNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/UniformArrayNode.js) | Parent takes an ordinary array and nullable element type; null immediately resolves from the first value. `element()` creates a real UniformArrayElementNode with `node` and `indexNode` links. | Neither class adds a serialize/deserialize override. Parent `array`, `elementType` and padded metadata are absent from inherited serialization. Element inherits ordinary child traversal. Its constructor is not publicly exported; import uses the bundled parent's native `element()` factory. |
| [BufferNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/BufferNode.js) | Extends UniformNode with buffer type/count and update ranges; input type is `buffer`. | Arbitrary BufferNode constructor layouts and update ranges are not reconstructed by generic serialization. UniformArrayNode derives its own layout instead. |
| [ArrayElementNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/utils/ArrayElementNode.js) | Holds parent/index; type comes from the parent's element type. | Native generation builds the array and scalar integer index (other index types are formatted to uint). UniformArrayElementNode additionally formats the padded read to its logical type, selecting `.x`, `.xy`, `.xyz` or the full vector. |
| [InputNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/InputNode.js) | Holds `value`, nullable `nodeType`, precision. | Saves the current value/valueType/nodeType/precision, not UniformArrayNode's source array. An unbuilt uniform array has `value: null`; a built one has a generated typed buffer. Neither value is its constructor data. |
| [UniformNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/UniformNode.js) and [Node](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/Node.js) | Default object group; Node base naming/global/parents state. | `getSerializeChildren()` discovers parent/index/group links; Node serialization only stores children. App callbacks become own methods. The existing writer owns graph traversal, IDs, sharing and cycles; the existing loader hydrates links and validates every definition before publishing a material. |
| [GLSLNodeBuilder](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/nodes/GLSLNodeBuilder.js) and [WGSLNodeBuilder](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/nodes/WGSLNodeBuilder.js) | Native uniform-buffer declarations and index expressions. | GLSL emits padded buffer blocks; WGSL emits uniform structs with a fixed-length array. GLSL replaces `node.name` with `NodeBuffer_<id>` and uses `buffer<id>` for the uniform. These generated identifiers are runtime cache, not portable source data. |

`UniformArrayNode.setup(builder)` chooses a typed array, computes padded length,
sets `value`, `bufferCount` and `bufferType`, and calls `updateBuffer()` initially.
Its native `updateType` is **render**, including before setup; `update()` calls
`updateBuffer()` on each native render update. The adapters never implement or
copy this packing/upload logic. Buffer values, generated names, node IDs, UUIDs,
build caches and renderer bindings are not serialized.

## Exact default subset

Only ordinary built-in UniformArrayNode and UniformArrayElementNode instances
are accepted (bundled instances and the ordinary source-module class on export).
Subclasses are rejected even if they declare the same static built-in type.
Values are ordinary numbers or exact Color/Vector instances from `three`.

| Effective element type | Source values | Native padded type | Native buffer |
| --- | --- | --- | --- |
| `float` | Numbers | `vec4` | Float32Array |
| `int` | Integral numbers in [-2147483648, 2147483647] | `ivec4` | Int32Array |
| `uint` | Integral numbers in [0, 4294967295] | `uvec4` | Uint32Array |
| `color` | Color, components r/g/b | `vec4` | Float32Array |
| `vec2` | Vector2, components x/y | `vec4` | Float32Array |
| `vec3` | Vector3, components x/y/z | `vec4` | Float32Array |
| `vec4` | Vector4, components x/y/z/w | `vec4` | Float32Array |

Each element occupies four 32-bit components (16 bytes). Unused components are
native zero padding. Color values are numeric working-space components, with no
color-space conversion or [0,1] clamp. All numeric components must be finite;
Float32-backed values must also remain finite under `Math.fround`. Ordinary
Float32 rounding/underflow remains native. Negative zero is excluded because
JSON stringification loses its sign. Scalar arrays must be dense ordinary
arrays; decorated arrays/objects, accessors and custom value classes are rejected.

Arrays contain **1–4096 elements**, at most 64 KiB of generated buffer data. This
is a data-adapter bound, not a promise that every renderer/device can bind that
size. The application must obey its actual uniform limits and shader-stage rules.
Empty arrays cannot infer a useful native type. Typed source arrays are excluded.

Inference is supported for numbers (`float`), Color and Vector2/3/4; these types
also accept explicit matching types. `int` and `uint` require explicit types.
The file stores the **effective type**: r186 discards the inferred/explicit
provenance in its constructor, so there is no distinct inference flag to restore.
Mismatched explicit types fail rather than relying on coercion or truncation.

The parent operation's `args` are exactly `array` (numbers or component tuples),
`elementType`, `precision` (null/low/medium/high), `nodeType: null`, `name: ''`,
`global` and `parents`. Length is the source array length, not an independent
count. Parent links are empty: the default native object group is reconstructed
by the constructor. The element operation has only `nodeType: null`, `name`,
`global`, `parents` and exactly two node-reference links, `node` and `indexNode`.
Element names may be empty/null or shader identifiers. Parent custom buffer
labels are deferred: GLSL overwrites them, so full name fidelity is unavailable.
The exact native `NodeBuffer_<own id>` name on built parents is recognized and
normalized to `''`; no generated shader identifier enters the file.

An element's parent must be a UniformArrayNode. Index nodes must infer scalar
`float`, `int` or `uint` without renderer-dependent inference. Constants must be
integral, nonnegative and smaller than the array length, including constants
inside native Var/Convert/SubBuild wrappers. Dynamic scalar index expressions,
including shared `instanceIndex`, retain native semantics; the application must
keep their runtime values in bounds. No expression evaluator or extra shader
bounds logic is added. The parent/index references use existing traversal and
hydration, preserving shared parents, shared indices, repeated elements and
TSL singleton identity. Expression ArrayNode remains a separate operation.

## Snapshot and update semantics

The file contains **material data at export time**. Export reads `array`, even if
a previously built upload buffer is stale. Import creates a new array and new
Color/Vector objects; it never reconnects the application's original array or
object identities, including aliases between value objects. Node identity and
sharing remain graph references, while array element objects are value snapshots.

Imported nodes start unbuilt (`value: null`, `bufferCount: 0`) and keep the native
default object group and per-render updates. After native setup, mutating/replacing
values at the existing length updates the buffer through native `NodeFrame`
render updates or `updateBuffer()`. Changing length/type needs native rebuild/
allocation; the plugins do not arrange runtime resizing or renderer invalidation.
Export accepts both native unbuilt and built states, checking the latter's buffer
class/length/type/count against its source. It saves no padded buffer contents.

## Failure behavior and deferrals

Unknown fields/links, malformed arrays, invalid scalar ranges/shapes, nonfinite
values, custom groups, nonempty update ranges, overridden update methods,
callbacks, before attachments and masquerading subclasses fail **export**.
Import validates exact argument/link shapes before construction and validates the
hydrated parent/index privately. Basic literal/index operations also reject
unknown argument fields and arbitrary links instead of silently ignoring them.
Dangling or wrong-kind references, cycles, unknown operations, malformed args and
invalid unreachable definitions fail the **entire material extension** through
the existing atomic loader. Ordinary glTF material values, supported physical
extensions, material sharing and dependency caches remain intact. Successful
entrypoints are never published before a later failure. Existing NodeMaterial
coexistence, concrete materialType restoration and singleton protections remain.

| Excluded variant | Reason / possible adapter path |
| --- | --- |
| App callbacks, custom update scheduling or methods, before attachments | Executable behavior cannot be represented as data. Consumer-supplied paired adapters can select an explicitly installed behavior by a validated binding ID. |
| Persistent external array/object identity | A glTF snapshot cannot restore application lifetimes or live bindings. Paired consumer adapters need external binding IDs, lookup and lifetime ownership. |
| Custom uniform groups, custom buffer labels and update ranges | Group scheduling, backend naming and partial-upload contracts require explicit consumer adapters and backend validation. |
| Matrices, bools, integer/boolean vectors, structs and other element types | r186 contains matrix-specific packing and other padded paths, but this issue does not establish full matrix layout/read fidelity on both backends. Future paired adapters must validate their native layout, typed values, shader reads and repeated round trips. |
| BufferNode / BufferAttributeNode, interleaving, attributes and arbitrary layouts | This subset does not establish buffer layout, stride/offset, normalization, geometry association, usage or instancing transport. Separate accessor/layout adapters and tests are needed. |
| Storage buffers, compute resources and dispatch | Require allocation/access/synchronization/dispatch contracts beyond material snapshots. |
| Dynamic vector/bool indices, renderer-dependent type inference | Ambiguous native coercion or unavailable inference context. Use scalar native expressions or a paired typed adapter. |

No schema change, v1.0 compatibility, executable file data, eval, custom shader
implementation, package publication or version bump is included.

## Validation

The [uniform-array integration suite](../packages/demo/test/uniformArrays.test.js)
uses real GLTFExporter → GLTFLoader → GLTFExporter → GLTFLoader calls for all seven
types, both available inference forms, integer/Float32 boundaries, shared nodes/
materials/indices, native instanceIndex, GLB and ordinary material coexistence.
It checks unbuilt and built exports, exact native padded buffers/zeros, new value
instances, stale-buffer snapshots, mutable imports, explicit updateBuffer calls
and per-render NodeFrame caching/updates. Native GLSL and WGSL flow/declarations
are compared in both vertex and fragment stages with constant indices. Native
instanceIndex is compared in the vertex stage, where its linkage is valid.
Only generated ID-based buffer identifiers are normalized in code comparisons.

Negative tests cover arrays/types/ranges/shapes, callbacks/groups/classes/buffers,
invalid index references/types/constants, unexpected state, cycles, unreachable
nodes and atomic fallback. Fallback compares the complete plugin-disabled ordinary
material, excluding IDs and extension bookkeeping, and checks material dependency
cache state. An older dependency-failure fixture now uses an explicit custom
resource resolver, since arbitrary links on default literal nodes are invalid.

Node-side generation does **not** prove GPU compilation or pixel correctness.
Browser WebGPU/WebGL visual smoke tests were not run (optional). Fragment use of
instanceIndex and hardware uniform-buffer limits were not GPU-tested. Required
post-merge verification: none. Final command results are recorded below.

### Check results (2026-10-16)

| Command from repository root | Actual result |
| --- | --- |
| `npm --prefix packages/loader ci` | Passed; 0 reported vulnerabilities. |
| `npm --prefix packages/exporter ci` | Passed; 0 reported vulnerabilities. |
| `npm --prefix packages/demo ci` | Passed; npm reported 10 existing dependency advisories (3 moderate, 5 high, 2 critical). No dependency changes were made. |
| `npm --prefix packages/demo test` | Passed: 7 files, **850 tests**, including **120 uniform-array tests**; no skips. Existing texture-packing tests emit native exporter warnings. |
| `npm --prefix packages/loader run build` | Passed. |
| `npm --prefix packages/exporter run build` | Passed. |
| `npm --prefix packages/demo run typecheck` | Passed. |
| `npm --prefix packages/demo run build` | Passed; Vite warned about the minified chunk exceeding 500 kB. |
| `git diff --check` / `git diff --cached --check` | Passed. |
| Browser WebGPU/WebGL visual smoke tests | Not run (optional); CPU generation/update checks do not prove GPU compilation or rendered pixels. |

No push, PR, merge, comment, npm publication or post-merge action was performed.
