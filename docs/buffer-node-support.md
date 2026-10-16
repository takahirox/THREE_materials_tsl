# Bounded BufferNode round trips (Issue #29)

## Source audit

Audited installed **three@0.186.1** source and bundled classes on 2026-10-16.
The npm [stable latest metadata](https://registry.npmjs.org/three/latest) was
rechecked and also reports 0.186.1. This establishes the r186 subset below,
not compatibility with every revision in the unchanged peer dependency range.

| Native source | Constructor / mutable state | Serialization and renderer behavior |
| --- | --- | --- |
| [BufferNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/BufferNode.js) | `value`, `bufferType`, `bufferCount` (default 0), empty `updateRanges`; calls UniformNode with the explicit buffer type as `nodeType`. | No serialize/deserialize override. `getInputType()` is `buffer`; `getElementType()` returns the effective node type, not a scalar component type. Count is the number of vec4s or mat4s, not floats/bytes/columns. No automatic count inference, padding, conversion or updateBuffer method. |
| [UniformNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/UniformNode.js), [InputNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/InputNode.js), [NodeUtils](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/NodeUtils.js) | Value, type, precision; default `objectGroup`, empty name, false global/parents; all update types `none`. Null InputNode types infer from values, but a Float32Array has no inferred shader type. | InputNode saves value/valueType/nodeType/precision; Float32Array has null valueType and generic deserialization does not recreate it from portable numeric tuples. It also omits bufferType/count/ranges. These fields need the paired explicit adapter, not native generic deserialize. |
| [Node](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/Node.js), [ArrayElementNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/utils/ArrayElementNode.js), [TSLCore](https://github.com/mrdoob/three.js/blob/r186/src/nodes/tsl/TSLCore.js) | Default `element()` constructs ordinary ArrayElementNode with `node`/`indexNode`. Its nodeType is null; type comes from the parent's getElementType. Numeric property access caches equivalent elements in `_cache`. | Neither element nor BufferNode adds child serialization overrides. getSerializeChildren discovers parent/index/group; private fields and self links can be skipped, so existing explicit link inspection and cycle handling remain necessary. Node serialize/deserialize save/restore child links, not buffer constructor data. ArrayElementNode generates a native subscript; integer scalar indices keep their type, other inputs format to uint. |
| [GLSLNodeBuilder](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/nodes/GLSLNodeBuilder.js) | Declaration reads bufferType and bufferCount. | Native uniform block contains `vec4 buffer<id>[count]` or `mat4 buffer<id>[count]`. The std140-compatible strides are 16 and 64 bytes. Native generation changes parent name to `NodeBuffer_<id>` and uses ID-based uniform names; generated names are normalized away at export. |
| [WGSLNodeBuilder](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/nodes/WGSLNodeBuilder.js) | Declaration reads effective getNodeType and bufferCount. | Native uniform struct has `value: array<vec4<f32>, count>` or `array<mat4x4<f32>, count>`; reads use `.value[index]`. These shapes have the same 16/64-byte element strides. Requiring nodeType === bufferType prevents backend disagreement. |
| [NodeUniformBuffer](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/nodes/NodeUniformBuffer.js), [Buffer](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Buffer.js), [BufferUtils](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/BufferUtils.js) | Binding reads the current node.value directly and delegates updateRanges. | byteLength is aligned from the typed view's byteLength; Buffer.update returns true. There is no UniformArrayNode packing, padded source array or per-render node update callback to restore. |
| [Bindings](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Bindings.js), [NodeBuilderState](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/nodes/NodeBuilderState.js) | objectGroup is nonshared and updated per object; bindings clone while retaining the BufferNode reference. | Both native builders allocate NodeUniformBuffer bindings. Existing renderer group scheduling/buffer uploads remain authoritative. Tests establish object ownership and live values before/after import; renderGroup/frameGroup are deliberately not expanded for BufferNode. |
| [WebGLBackend](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/WebGLBackend.js), [WebGPUBindingUtils](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/utils/WebGPUBindingUtils.js) | Full uploads use the typed view directly; nonempty ranges request native partial uploads. | WebGL uses bufferData; WebGPU uses queue.writeBuffer. The plugins neither perform uploads nor reproduce shader/layout calculations. Pending partial ranges cannot be silently discarded by a snapshot and fail export. |

## Exact default contract

Only exact built-in BufferNode instances are supported: bundled `three/webgpu`
and source-module instances on export; import constructs the bundled native class.
It never constructs UniformArrayNode instead. Existing UniformArrayNode support
and its distinct padding/update behavior remain unchanged.

| bufferType | Native source value | Count bound | Exact length / maximum native bytes |
| --- | --- | --- | --- |
| `vec4` | Ordinary Float32Array, flat x/y/z/w tuples | 1–4096 | count × 4 components; 65,536 bytes |
| `mat4` | Ordinary Float32Array, flat consecutive matrices in column-major order (Matrix4.elements ordering) | 1–1024 | count × 16 components; 65,536 bytes |

These bounds are exercised at 1, 3 and the maximum count through two JSON glTF
and GLB round trips and both native shader builders. They cap each adapter's
payload at 64 KiB; applications must still respect actual device limits, total
bindings, shader stages and geometry/instance/draw bounds. This is not a promise
that every device can bind every permitted graph.

Values must be finite Float32 components. NaN, infinities and negative zero are
rejected; JSON cannot preserve negative zero's sign. Export accepts exact
Float32Array views (including nonzero offsets) backed by an ordinary ArrayBuffer,
without own decorations/symbols. Subclasses, shared-memory views, Float64Array,
integer/other typed arrays, DataView, raw ArrayBuffer, plain number arrays and
arrays of Vector4/Matrix4 objects are excluded. The native upload interface needs
byte data; other representations cannot simply be substituted without specifying
conversion and layout. Both Float32 extremes and positive subnormal values are
tested. Import requires numeric JSON components exactly representable as Float32,
so it cannot introduce hidden rounding or negative zero underflow.

BufferNode `args` contain **exactly** `value` (flat JSON numeric array),
`bufferType` and `bufferCount`. No links are accepted on that definition.
The constructor restores nodeType equal to bufferType, null precision, default
objectGroup, empty label, false global/parents, empty updateRanges and native
`none` lifecycle types. Only those default states are supported. The exact
source-module default objectGroup and bundled objectGroup are accepted on export
with their native singleton configuration validated. Custom labels, precision,
global/parents settings and every other group require adapters. An already built
node's exact native `NodeBuffer_<own id>` label normalizes to the empty default.
IDs, UUIDs, versions, stack traces and known native build caches are runtime state
and are not serialized. Unknown own state/links, callbacks, before attachments,
method overrides, getters and masquerading subclasses fail explicitly.

Ordinary ArrayElementNode keeps its existing data adapter and parent/index
references. Validation now checks its native state and hydrated parent/index
before publication, reusing the existing uniform-array index validator. Buffer
parents use bufferCount; expression ArrayNode parents, existing UniformArrayNode buffers and vector/matrix
component access keep their native element domains. A scalar or unrelated parent is invalid.
An element's nodeType must remain null. Shared parents, indices and repeated
material entrypoints use existing graph IDs, hydration and cycle detection.

Indices must infer scalar float/int/uint without renderer-dependent inference.
Direct constants, including constants under Var/Convert/SubBuild wrappers, must
be integral, nonnegative and less than bufferCount. Scalar expression indices
retain native conversion; the application must keep runtime values in bounds.
The adapter does not evaluate expressions or add shader bounds checks. Input leaf
values/shapes are validated even when projected through scalar expressions.
Attribute indices obey the existing [canonical-name restriction](uniform-array-support.md)
so native glTF renaming cannot silently disconnect geometry. Tests cover shared
uniform indices/wrappers, populated canonical attributes, instance/vertex IndexNode
forms in vertex context, and the native GLSL drawIndex path. r186 WGSL has no
drawIndex implementation. Fragment index use needs valid native stage linkage;
fragment instance/vertex-index rendering is not established here.

## Snapshot and runtime updates

Export copies the current Float32Array view to JSON; import allocates a fresh
Float32Array starting at byte offset zero. Only the view's values are included,
not unused backing memory. Array identity, backing-memory aliases, application
bindings and BufferNode identity across distinct material graphs are not an
external resource contract. Within each graph, shared references remain shared;
repeated material instances share their reconstructed graph. Distinct materials
get separate snapshots, matching the existing material-local graph encoding.

In-place component updates and replacement with another Float32Array of the same
type/length retain native full-upload semantics. NodeUniformBuffer reads live
node.value; it does not pack or copy via UniformArrayNode.updateBuffer. Tests
check binding contents/byteLength, object-group binding cloning, and actual native
backend update methods with mocked GPU endpoints receiving the expected view.
Changing type/count/length needs native rebuild/allocation and application-owned
renderer invalidation. The plugins do not manage resizing or GPU lifetime.
An application may use native ranges after import, but a subsequent export with
pending ranges fails until they are cleared; no partial-upload history is saved.

## Failure behavior and deferred adapters

All definitions, including unreachable ones, are resolved and validated privately
by the existing loader before any entrypoint is published. Invalid args, bounds,
shapes, unknown fields/ops, links, reference kinds, missing nodes, cycles and invalid
parent/index types reject the **entire** material graph. The complete ordinary
glTF material, supported other extensions, primitive clones and dependency caches
remain ordinary materials. Tests compare the plugin-disabled fallback's full
material properties, including physical extensions and extras.

| Deferred case | Source reason and proposed paired adapter path |
| --- | --- |
| Plain arrays, Vector4/Matrix4 arrays, Float64 or integer typed values | Native bindings upload bytes, not abstract numeric components; plain arrays lack byteLength and other typed arrays have different interpretation/width. Paired adapters must specify conversion, native byte layout and snapshot rules, with backend tests. Callers can explicitly create a Float32Array before using these defaults. |
| Other types, vec3/mat3 padding, integer/bool/struct layouts | Both renderer declarations and actual host bytes must agree on padding, stride and shader element type. A separate paired bounded adapter must verify both backends rather than reuse UniformArrayNode's different packing. |
| renderGroup/frameGroup, independent/custom groups, labels or nondefault base/input state | Additional scheduling, cache-sharing and backend naming semantics have not been established for these BufferNode variants. Paired adapters need exact identity/ownership/lifecycle and cross-material renderer tests. Ordinary UniformNode's existing three-group subset is unchanged. |
| Pending partial update ranges | Native backend upload ranges carry component offsets/counts and live upload state; a portable full snapshot cannot preserve pending renderer history. A consumer adapter needs resource identity and an explicit initial/full/partial synchronization contract. |
| Callbacks, external live data, custom methods/subclasses | Executable behavior and application lifetimes cannot be inferred from numeric snapshots. Consumer-installed paired adapters may use validated external binding IDs and explicit lifecycle ownership; files must not contain code. |
| GPU/storage/compute buffers, attributes, interleaving, renderer resources | Allocation, geometry association, usage/access, dispatch and synchronization are absent from this data-only contract. Separate paired resource/accessor adapters are required. |

No shader source, executable callbacks, renderer objects or GPU buffers enter the
file. There are no new extension fields, schema/version/materialType changes,
Three.js core patches, package version bumps or publication actions. Draft v2.0
and removal of v1.0 remain unchanged.

## Validation

The [BufferNode suite](../packages/demo/test/buffers.test.js) exercises repeated
real GLTFExporter → GLTFLoader → GLTFExporter → GLTFLoader calls for both supported
types, including JSON glTF and GLB at minimum/representative/maximum sizes. It
checks exact native Float32 contents/order, real BufferNode class, element links,
sharing, ordinary physical material values, mutable snapshots and built exports.
Native GLSL/WGSL setup/analyze/generate flows and buffer declarations are compared
in both vertex and fragment stages, using vec4 reads and mat4 × local-position
expressions. Only generated buffer identifiers are normalized. Index forms,
canonical geometry bindings, object-group native bindings, full upload calls,
Float32 boundaries and strict negative exporter/import cases are covered.

Node-side shader generation and mocked upload endpoints do **not** establish GPU
compilation, device validation, actual GPU upload success or rendered pixels.
Optional browser WebGL/WebGPU visual smoke tests were not run. No tests were
skipped. Required post-merge verification: none.

### Check results (2026-10-16)

| Command from repository root | Final result |
| --- | --- |
| `npm --prefix packages/loader ci` | Passed; 0 reported vulnerabilities. |
| `npm --prefix packages/exporter ci` | Passed; 0 reported vulnerabilities. |
| `npm --prefix packages/demo ci` | Passed; 10 dependency advisories reported (3 moderate, 5 high, 2 critical). No dependency/lock changes made. |
| `npm --prefix packages/demo test` | Passed: 9 files, **1382 tests**, including **225 BufferNode tests**; no skips. Native texture-packing tests emit exporter merge/UV-channel warnings. |
| `npm --prefix packages/loader run build` | Passed. |
| `npm --prefix packages/exporter run build` | Passed. |
| `npm --prefix packages/demo run typecheck` | Passed. |
| `npm --prefix packages/demo run build` | Passed; Vite warned about a minified chunk exceeding 500 kB (1,729.75 kB). |
| `git diff --check` / `git diff --cached --check` | Passed. |
| Browser WebGL/WebGPU visual smoke tests | Not run (optional); GPU compilation, actual upload success and pixels remain unverified. |

An initial focused test run failed due to test-harness assumptions about the draw
extension stub and native material dependency clones. Those fixtures were corrected;
final checks above have no failures. Final review also added regression coverage
for sparse pending range arrays and existing ordinary ArrayElementNode access to
UniformArrayNode buffers. No push, PR, merge, comment, release or publication was
performed.
