# Shading and bit/packing node support

[Issue #19](https://github.com/takahirox/THREE_materials_tsl/issues/19) adds paired
default adapters for the **11 concrete classes named in its seven groups** (the
issue heading counts 12). This is implementation coverage within the existing
Draft v2.0 `op`/`args`/`links` encoding; the normative schema is unchanged.

## Three.js reference

Rechecked on **2026-10-15**: the [latest stable GitHub release](https://github.com/mrdoob/three.js/releases/tag/r186)
is r186. The installed locked reference remains `three@0.186.1` with
`@types/three@0.186.0`. The audit reads the actual constructors, child discovery,
serialize/deserialize and shader setup/generation in
[r186 src/nodes](https://github.com/mrdoob/three.js/tree/r186/src/nodes), including
[NormalMapNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/display/NormalMapNode.js),
[ColorSpaceNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/display/ColorSpaceNode.js),
[RenderOutputNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/display/RenderOutputNode.js),
and [StandardNodeLibrary](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/nodes/StandardNodeLibrary.js).
No dependency or peer-range changes are needed. Other Three.js revisions are not
established by these checks.

## Supported variants and exact boundaries

| Group/classes | Preserved data and links | Deferred variants and reason |
| --- | --- | --- |
| `NormalMapNode` | `node`, optional `scaleNode`, `normalMapType`, `unpackNormalMode`. Tangent-space maps accept `NoNormalPacking`, `NormalRGPacking`, `NormalGAPacking`; object-space maps accept `NoNormalPacking`. Ordinary 2D texture inputs reuse #17 resources. | Object-space RG/GA unpacking is incompatible in Three.js. Unknown normal-map spaces/packing modes fail explicitly. |
| `BumpMapNode` | `textureNode`, optional `scaleNode`. Three.js handles derivative sampling, scaling and its wireframe bypass. | Texture inputs retain the [existing 2D subset](texture-node-support.md); unsupported texture modes/resources still fail. |
| `VertexColorNode` | Index 0 (`color` / `COLOR_0`), including the constructor's omitted index. Three.js retains interpolation and white fallback when no attribute exists; geometry data stays native glTF. | Higher indices require paired geometry adapters: native GLTFExporter writes `color1` as `_COLOR1`, and GLTFLoader restores `_color1`, while the node looks up `color1`. Default export rejects nonzero indices instead of silently changing behavior. Negative/fractional indices are invalid. |
| `ColorSpaceNode` | `colorNode`, `source`, `target`. Supports `''`/`NoColorSpace`, `srgb`, `srgb-linear`, `WorkingColorSpace`, `OutputColorSpace`, and null/omitted no-op values. Working/output sentinels remain dynamic; ColorManagement and builder/renderer resolve them at shader setup. | Custom registered spaces need paired consumer setup; their primaries/transfer functions are not file data. Defaults do not serialize registrations or freeze renderer context. |
| `ToneMappingNode` | Tone selection, required `exposureNode` (including the shared dynamic `toneMappingExposure`), optional `colorNode` (otherwise builder context). Supports No, Linear, Reinhard, Cineon, ACESFilmic, AgX and Neutral tone mapping. | `CustomToneMapping`, unknown selections and consumer-specific tone-library registrations require adapters: their executable functions cannot be reconstructed from an enum. Three.js's renderer library supplies supported execution. |
| `RenderOutputNode` | Optional `colorNode`, tone selection and output space. Tone selections are those above; output space is `''`, `srgb` or `srgb-linear`. **Null inherits builder context; omitted/undefined settings do not** in r186. That distinction survives repeated export/import. | Custom tone mappings/output spaces require consumer configuration/adapters as above. Renderer/pass ownership and automatic output-transform settings are outside graph data. See the output contract below. |
| `BitcastNode` | `valueNode`, `conversionType`, nullable `inputType`. 32-bit float/int/uint scalars and vec2/3/4 with equal component counts; Three.js's scalar `inputType` aliases preserve the input vector width. | Bool/matrix/other widths and mismatched counts fail. Float-to-float identity bitcasts are rejected because r186 GLSL has no intrinsic mapping (WGSL alone can express them). Use the input directly. Explicit alias input/conversion types must be scalar float/int/uint. |
| `BitcountNode` | `method`, `aNode`; countLeadingZeros, countTrailingZeros, countOneBits on signed/unsigned integer scalars/vectors. | Unknown methods/noninteger inputs fail. Three.js selects WGSL builtins or its GLSL emulation; the plugins do not implement counting. |
| `PackFloatNode`, `UnpackFloatNode` | Encoding, layout and `vectorNode` / `uintNode`. snorm/unorm with 2x16 or 4x8; float16 with 2x16. Packing requires vec2/vec4 matching layout; unpacking requires uint. | float16/4x8, unknown encodings/layouts and incompatible input types fail; r186 supplies no such packing operation. |
| `Packed4x8IntegerNode` | Method, `aNode`, binary `bNode` only for dot products. All eight methods: dot4I8Packed, dot4U8Packed, pack4xI8/U8, pack4xI8Clamp/U8Clamp, unpack4xI8/U8. Signedness/clamping are encoded by the method. | Unknown methods and wrong arity fail. Native WGSL feature selection and fallback integer emulation remain Three.js-owned; no GPU feature is required merely to import data. |

All adapters preserve base name, global and parents flags and the class's fixed
or inferred nodeType. They reuse upstream serialization and child discovery;
missing upstream fields are explicit constructor data. The resolver uses actual
Three.js classes and upstream deserialization for vertex-color indices and
packed-integer methods. The graph writer retains shared identity and detects
cycles. Type inference for bit/float-packing inputs uses Three.js's NodeBuilder
without a renderer; inputs that require unavailable context cannot be validated
by these defaults and need an explicit paired adapter.

All reconstructed nodes use `three/webgpu`, matching `three/tsl`. Mixing source
node modules with bundled nodes can create separate TSL stack/cache state and
break derivative/function-backed shader setup. This change also aligns existing
texture, uniform, attribute, math and operator reconstruction with that runtime.

## Output transform contract

The plugins reconstruct authored ColorSpace/ToneMapping/RenderOutput nodes.
They neither insert another output node nor alter renderer exposure, tone mapping,
ColorManagement, render passes or output transforms. A consumer using an explicit
final RenderOutputNode must arrange **one** final output transform, following
Three.js's pipeline contract. For example, a RenderPipeline using manually
transformed output sets `outputColorTransform = false`. An arbitrary mesh material
graph cannot configure a consumer's rendering pipeline through glTF data.
Null/context-dependent output values deliberately use the importing context;
this is not a promise of identical pixels under different renderer settings.

## Failure behavior

Unknown fields, invalid enum/type/layout/arity, wrong resource-reference kinds,
missing/dangling inputs, cycles, extra meaningful links, inherited built-in IDs
and app callbacks fail export. Loader validation checks encoded arguments and
links before construction, then validates typed inputs privately after hydration.
A failure in any definition, including an unreachable node, leaves the entire
ordinary glTF material and its textures/extensions intact. Custom overrides
continue to own their own contracts. No shader source, executable closures or
arbitrary constructors are read from the file.

## Validation

The [shading integration suite](../packages/demo/test/shading.test.js) uses real
GLTFExporter → GLTFLoader → GLTFExporter → GLTFLoader cycles, embedded PNG textures,
shared inputs/entrypoints, optional/default values, dynamic references and graph
equality after shader setup. It compares Three.js GLSL shader flow for each
supported group, WGSL bit/packing flow, and both native-feature and emulated
packed-integer paths. It tests color-management/context behavior, vertex-color
attributes/white fallback, invalid export variants and atomic textured fallback.

Results on 2026-10-15:

| Command (from repository root) | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` in loader, exporter and demo | Passed for all three locked installs. |
| `(cd packages/demo && npm test)` | Passed: **440 tests in 4 files**, including **260 shading tests**. |
| `(cd packages/loader && npm run build)` | Passed. |
| `(cd packages/exporter && npm run build)` | Passed. |
| `(cd packages/demo && npm run typecheck)` | Passed. |
| `(cd packages/demo && npm run build)` | Passed; Vite reports its large-chunk warning. |
| `git diff --check` | Passed. |

Optional
browser/WebGPU visual smoke tests are **not run**; Node-side shader generation
does not compile GPU programs or prove GPU pixel correctness. No publishing or
post-merge verification is part of this issue.
