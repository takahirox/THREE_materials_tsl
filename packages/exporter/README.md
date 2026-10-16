# @takahirox/gltf-three-materials-tsl-exporter

GLTFExporter plugin for [THREE_materials_tsl Draft v2.0](../../README.md).
Version 0.4.1 emits only v2.0, including the actual NodeMaterial's required
`materialType`. The former `version` option is removed.

## Install

```sh
npm install three @takahirox/gltf-three-materials-tsl-exporter
```

## Usage

```ts
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  THREEMaterialsTSLExporterPlugin,
  createDefaultNodeSerializer
} from '@takahirox/gltf-three-materials-tsl-exporter';

const exporter = new GLTFExporter();
exporter.register((writer) => new THREEMaterialsTSLExporterPlugin(writer, {
  nodeSerializer: createDefaultNodeSerializer(),
  includeThreeRevision: true
}));
```

By default, all populated node properties ending in `Node` are exported as
entrypoints. An optional `entrypoints: ['emissiveNode', 'positionNode']` selects
only those graph slots. A material with no selected graph emits only ordinary
glTF material data. Missing/invalid concrete material types, unsupported nodes,
cycles and unrepresentable links throw instead of silently losing graph data.
`threeRevision` can supply an informational revision string; neither revision
option changes the encoding or triggers migration.

## Supported scope

Tested with Three.js **r186** (`three@0.186.1`, `@types/three@0.186.0`): `MeshBasicNodeMaterial`,
`MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`, and custom subclasses
retaining these ordinary material families. GLTFExporter uses their ordinary
material flags to export core color/metalness/roughness/emissive/alpha/texture
properties and its supported `KHR_materials_*` extensions. This includes unlit,
clearcoat, transmission, volume, IOR, specular, sheen, iridescence, anisotropy,
dispersion and emissive strength. The plugin does not replace these values with
TSL graph results. Author meaningful ordinary properties so viewers without TSL
support have a usable fallback; arbitrary graphs cannot be baked automatically.

The default serializer supports shared node objects from `three/tsl` (including
dynamic `materialColor` and `time`), `ConstNode`/`UniformNode` numeric, boolean,
color, vector and matrix literals, `AttributeNode`, `MathNode`, and `OperatorNode`.
It also supports `SplitNode`, `JoinNode`, `ConvertNode`, `SetNode`, `FlipNode`,
`ArrayNode`, `ArrayElementNode`, `ConditionalNode`, `VarNode`, `VaryingNode`,
`SubBuildNode` (op `SubBuild`), and `RotateNode`. It reuses Three.js serialization
and child discovery, with explicit fields for state omitted by upstream
serialization. Shared inputs, array elements, types, variable flags, interpolation
and Euler order survive repeated round trips.

See the [coverage matrix](../../docs/tsl-node-coverage.md) for the complete audited
class/family and shared-object inventories, tested boundaries, deferred cases,
reasons and adapter paths. Advanced texture variants, buffer layouts beyond the bounded subset,
closures, code-backed nodes and renderer resources are outside the default
allowlist. Some can use paired adapters; others need additional resource/control-flow design. Ordinary
nodes with app-installed callbacks, uniforms with unsupported groups, subclasses
inheriting built-in operation IDs, and unrepresentable inputs fail explicitly.
Custom code stays consumer-supplied; the file cannot carry executable code.
The existing peer dependency range `three >=0.182.0` is retained;
this validation does not establish compatibility with every release in that
range. Support across Three.js revisions is not guaranteed.

### Surface, color/output and bit/packing nodes

The paired defaults also support `NormalMapNode`, `BumpMapNode`, `VertexColorNode`,
`ColorSpaceNode`, `ToneMappingNode`, `RenderOutputNode`, `BitcastNode`, `BitcountNode`,
`PackFloatNode`, `UnpackFloatNode` and `Packed4x8IntegerNode`. This includes tangent
and object-space normals, optional scales, tangent RG/GA unpacking, vertex color
index 0 (or omitted), built-in color spaces/context sentinels, seven standard tone
selections, dynamic exposure, numeric bitcasts/bitcounts, float packing layouts
and all eight signed/unsigned packed-integer methods.

See the [shading-node audit](../../docs/shading-node-support.md) for exact fields,
type/layout domains, tests and deferred variants. Higher vertex-color indices
need geometry adapters because native glTF tools rename their attributes. Custom
color-space/tone-library registrations, object-space packed normals, float16/4x8
packing and float-to-float bitcasts are unsupported by default and fail export.
Malformed imports retain the complete ordinary material. Renderer-dependent type
inference outside these defaults needs paired adapters.

Color/output nodes preserve context-dependent values; they do not serialize or
change renderer/pipeline settings. Null RenderOutput settings inherit context;
omitted settings retain r186's distinct behavior. Consumers using explicit final
output conversion must arrange one final transform (for a manually transformed
RenderPipeline, set `outputColorTransform = false`). The plugins add no output
transform. Execution remains entirely Three.js-owned.

### Uniform groups

Ordinary `UniformNode` instances may select the exact `three/tsl` `objectGroup`,
`renderGroup` or `frameGroup`. An unchanged default object group still emits no
link. Render/frame selections emit a `groupNode` graph reference to the shared
operation, preserving exact singleton identity and native buffer scheduling.
Group versions, upload buffers and renderer caches are never serialized.

Independently constructed `UniformGroupNode` instances, lookalikes, altered
singleton configuration, subclasses, callbacks and unexpected uniform state fail
export. Independent groups need consumer-owned naming, ordering, identity and
lifecycle bindings through paired overrides. Uniform labels/global/parents must
remain native defaults. UniformArrayNode keeps its existing object-group-only
subset. See the [source audit, exact contract, deferrals and adapter path](../../docs/uniform-group-support.md).

### Bounded BufferNode arrays

The paired defaults also support exact ordinary `BufferNode` with `bufferType`
`vec4` (1–4096 elements) or `mat4` (1–1024 column-major matrices), explicit positive
count, and a matching flat **Float32Array** (4 or 16 components per element).
Only finite values excluding negative zero, exact default objectGroup/lifecycle/
base/input state and empty update ranges are supported. Ordinary arrays, other
typed arrays, custom groups/labels/callbacks, storage/compute/attribute buffers and
other layouts require paired adapters. The bound is 64 KiB per buffer; actual
device limits remain the application's responsibility.

JSON stores a value snapshot, type and count; import creates a fresh native
BufferNode/Float32Array. Existing ArrayElementNode parent/index links and graph
sharing remain intact. Native Three.js owns declarations, bindings and full
uploads, including in-place updates or same-length value replacement. Scalar
indices must use valid native stages and remain within bounds; direct/wrapped
constant indices are checked. Unsupported exports fail; malformed graphs,
including invalid unreachable nodes, retain the entire ordinary material.
See the [exact data/state contract, r186 audit, tests and deferrals](../../docs/buffer-node-support.md).

### Bounded uniform arrays

The paired defaults support ordinary `UniformArrayNode` and
`UniformArrayElementNode` instances. This is separate from expression `ArrayNode`.
Arrays contain 1–4096 numbers (`float`, `int`, `uint`), Color (`color`), or
Vector2/3/4 (`vec2`/`vec3`/`vec4`) values, with matching types and finite components.
Signed/unsigned integers must fit 32 bits; Float32-backed components must not
overflow. Negative zero is excluded because JSON loses its sign. Inferred types
are stored as their effective native type; `int`/`uint` require explicit types.

The array is a snapshot at export time, with fresh values on import. Shared
parent/index nodes and material entrypoints retain graph identity. Imported
arrays remain mutable through Three.js's native setup, padding, `updateBuffer()`
and per-render updates. The plugins do not store generated buffers or shader
code. Scalar index nodes (including native `instanceIndex` in valid stages) use
native semantics; constants must be integral and in range, and the application
must keep dynamic indices within bounds and obey device uniform limits.
Attribute indices, including those nested in expressions, require canonical
geometry names: `position`, `normal`, `tangent`, `uv`, `uv1`, `uv2`, `uv3`,
`color`, `skinWeight`, `skinIndex`, or custom names matching `^_[a-z0-9_]*$`.
Other names fail export because native glTF may rename or omit the geometry
attribute (for example, `customIndex` becomes `_customindex`), breaking its graph
binding. Use a canonical name on both the geometry and graph, or paired adapters.

Custom callbacks, external live array bindings, custom groups/buffer labels,
partial update ranges, matrices/other element types and arbitrary buffer,
attribute/storage/compute layouts need separate adapters. Generated GLSL buffer
names are omitted. Unsupported exports fail; malformed imports retain the entire
ordinary material without partial entrypoints. See the
[exact allowlist, constructor/runtime audit, snapshot contract and validation](../../docs/uniform-array-support.md).

### Geometry, screen and viewport depth

The paired defaults support ordinary `IndexNode` (`vertex`, `instance`, `draw`),
`FrontFacingNode`, `ScreenNode` (`coordinate`, `uv`, `size`, `viewport`) and
`ViewportDepthNode` (`depth` without an input; `linearDepth` with an optional
scalar-float `valueNode`). Index/screen/depth constructors require explicit valid
scopes. Ordinary instances keep distinct identity; shared exported TSL objects
keep their existing singleton identity and protections.

Screen size/viewport uniforms update from the current renderer, DPR and render
target through native Three.js render updates; dimensions are never frozen in
file data. Coordinate/UV and depth expressions require fragment context. Depth
uses the active render camera and live near/far uniforms; linked depth must
belong to that camera and use native ordinary perspective/orthographic depth
semantics. The plugins do not bind a foreign camera or configure depth modes.
`draw` requires native WebGL draw-index support (multi-draw or the renderer's
uniform fallback); r186 WebGPU does not implement it.

Compute index scopes `invocationLocal`, `invocationSubgroup`, `subgroup` and
viewport `depthBase` reads/writes are deferred pending dispatch/ordered-output
adapters. Ordinary FrontFacingNode on BackSide materials fails export because
native glTF drops that side setting; FrontSide/DoubleSide work. Ignored depth
inputs, custom renderer/camera bindings, callbacks, invalid scopes and extra or
broken links fail export; import failures retain the entire ordinary material.
Framebuffer-depth textures, foreign-camera and logarithmic/reversed-depth
conversion need explicit resource/encoding bindings. See the
[exact four-class audit, stage/backend limitations and adapter paths](../../docs/geometry-node-support.md).

### Bounded current-object user data

The paired defaults support ordinary `UserDataNode` / `userData('tint', 'float')`
with null userData/object bindings, native default groups/scheduling/base state,
and a safe single-level identifier. Each rendering Mesh using the material must
have its own enumerable finite numeric `userData.tint` (excluding negative zero).
The graph carries only the selector and float type; native glTF node extras carry
the per-object value. Imported real UserDataNode instances keep native live reads
of the currently rendered Mesh, including different values on shared materials.

Support is bounded to ordinary single-primitive triangle Meshes with scalar
materials and proven node-extras ownership. Material arrays, multi-primitive
Groups, pivots, instancing/skinning/morphs, attachments, unproven scene clones,
external/nested bindings, accessors/callbacks and other referenced value types are
deferred. Export rejects unsupported contexts, including cached mesh uses;
malformed imports retain the complete ordinary material and other supported
extensions with no partially installed graph. See the [exact property/state/layout
contract, source audit, tests and paired adapter ownership paths](../../docs/user-data-node-support.md).

### Dynamic material and model references

The paired defaults support ordinary `MaterialNode`, `ModelNode` and
`MaterialReferenceNode` instances as live Three.js references. The exact
MaterialNode scopes are:

```text
color opacity alphaTest roughness metalness emissive normal ao
clearcoat clearcoatRoughness clearcoatNormal sheen sheenRoughness anisotropy
iridescence iridescenceIOR iridescenceThickness ior transmission thickness
attenuationDistance attenuationColor dispersion specularIntensity specularColor
```

ModelNode supports `position`, `viewPosition`, `direction`, `scale`, `worldMatrix`
and `radius`, always following Three.js's current rendered object. Material
references use only the current rendered material (`material: null`), with this
property/type allowlist:

| Type | Properties |
| --- | --- |
| `color` | `color`, `emissive`, `sheenColor`, `attenuationColor`, `specularColor` |
| `vec2` | `normalScale`, `clearcoatNormalScale` |
| `float` | `opacity`, `alphaTest`, `roughness`, `metalness`, `emissiveIntensity`, `aoMapIntensity`, `clearcoat`, `clearcoatRoughness`, `sheen`, `sheenRoughness`, `anisotropy`, `anisotropyRotation`, `iridescence`, `iridescenceIOR`, `ior`, `transmission`, `thickness`, `attenuationDistance`, `dispersion`, `specularIntensity` |

Every default binding must exist with the expected type on the material and its
imported primitive clones. Shared nodes select the currently rendered material;
clone-specific values stay distinct. Unsupported bindings fail export or retain
the entire ordinary glTF material on import. Ordinary Object3DNode is deferred:
`object3d: null` is unbound in r186, and explicit object identities cannot be
reconstructed from the current graph resources. Author ModelNode for current-mesh
semantics. Explicit external materials/objects need paired serializer/resolver
overrides with consumer-owned binding IDs, target lookup and lifetime management;
unknown targets must fail. Arbitrary property paths, texture/array references,
custom groups/callbacks and unsupported scopes also require adapters.
MaterialNode bump-only/object-space/packed normals and separate opacity alphaMap
bindings are rejected because native glTF cannot restore their setup state;
ordinary map transforms must satisfy the existing glTF/KHR fallback constraints.
MaterialNode `roughness` requires `roughnessMap` and `metalnessMap`, when both
exist, to match UV channel, offset, repeat, rotation, wrapS/wrapT and min/mag
filters. Native r186 packing uses metalnessMap's sampling for both maps;
incompatible combinations fail export and require paired consumer adapters.
MaterialNode anisotropy maps must use UV channel 0 because native r186 export
omits their texture-coordinate selector; other channels require paired adapters.
Export also rejects references whose initial values native glTF would drop or
normalize: for example nonzero alphaTest with transparency, nondefault disabled
extension properties, and sheen strengths other than 0 or 1. Normal-scale
references must match the scalar magnitude and per-primitive tangent sign that
GLTFLoader reconstructs (including when no map exists); incompatible shared-mesh
layouts fail export. MaterialNode validates its actual property/texture
dependencies by the same rules. See the audit's
[value transport restrictions](../../docs/reference-node-support.md#value-transport-restrictions)
for exact limits; nonportable state requires paired consumer adapters.

See the [four-class audit and binding contract](../../docs/reference-node-support.md)
for native serialization fields, deferred scopes, runtime/rebuild behavior,
sharing/cloning semantics, adapter paths and validation limits.

### Default 2D textures

Ordinary `TextureNode` / `texture(myTexture)` works with the paired defaults,
including image resources, shared graph textures, UV channels/default or explicit
UVs, transform parameters and matrix-update behavior, color space, glTF samplers,
explicit mip-generation/anisotropy, level/bias, texel offsets and sample/fetch mode.
`TextureSizeNode` and `MaxMipLevelNode` are also supported. Resources are ordinary
image-backed RGBA8 `Texture` objects; image `flipY` is baked by the writer and
normalized to false on import. TSL textures share resources within the graph and
stay separate from ordinary material-slot clones to preserve fallback state.

See the [2D texture support and r186 audit](../../docs/texture-node-support.md)
for the exact encoding, tests and limitations. Ordinary fallback map transforms
must be representable by native glTF/KHR processing: use zero center and uniform
scale when rotating, or a matching fixed KHR matrix. Incompatible fallback map
transforms fail on export; TSL-only textures retain arbitrary matrices/centers.
Depth/comparison/gather/gradients, external live references, advanced texture
classes, renderer resources, manual mip chains, premultiplied uploads, custom
texture metadata and callbacks require paired adapters or separate resource
design. Failed graph reconstruction retains the entire ordinary material.

Provide paired serializer/resolver overrides for custom nodes:

```ts
const nodeSerializer = createDefaultNodeSerializer({
  overrides: {
    MyCustomNode: (node) => ({
      op: 'MyCustomNode',
      args: { strength: node.strength },
      links: {
        input: { node: node.input },
        resources: [{ texture: node.texture }, { accessor: node.attribute }]
      }
    })
  }
});
```

`args` must contain JSON literals. Links accept nodes (or `{ node }` wrappers),
`{ texture }`, `{ accessor }`, and nested arrays/objects of these targets.
Textures/accessors are exported through the glTF writer and resolved by the
loader. Explicit `{ $refTex: index }` and `{ $refAccessor: index }` links must
refer to resources in the final exported tables; dangling references throw
after scene processing, allowing references to resources emitted later.
Missing accessor support or invalid link targets throw. Custom nodes
still need a matching consumer resolver; exporting a custom op does not make it
universally supported.

## Development and tests

```sh
npm ci
npm run build
```

The shared integration suite lives in [the demo package](../demo/README.md#tests)
and tests both plugins with the real Three.js loader/exporter.

## 0.4.1 release note

This release adds a `prepack` hook that removes `dist/` and rebuilds the current
TypeScript sources before `npm pack` or `npm publish`. A failed clean or build
stops packing/publishing, preventing stale artifacts from being released. The
Draft v2.0-only implementation, required `materialType`, Three.js r186 validation
baseline, public package name and export paths are unchanged. The version bump
prepares a corrected release; it does not establish what the published 0.4.0
tarball contains.

See the [0.4.1 validation report](../../docs/npm-0.4.1-validation.md) for local
tarball inspection and lifecycle failure checks.

## Manual publishing (maintainer only)

After reviewing and merging, run from the repository root:

```sh
npm login
cd packages/exporter
npm ci
npm pack --dry-run
# Review the file list for dist/index.js, the plugin/serializer .js and .d.ts files.
npm publish
# After publication, verify the registry version:
npm view @takahirox/gltf-three-materials-tsl-exporter version
npm view @takahirox/gltf-three-materials-tsl-exporter@0.4.1 version
```

Do **not** use `--ignore-scripts` for packing or publishing, or disable scripts
in npm configuration: that bypasses the clean build. Install development
dependencies with `npm ci` (without `--omit=dev`) so TypeScript is available.
The manifest configures public access for this scoped package.

The maintainer must verify both registry queries return `0.4.1`, inspect the
published 0.4.1 tarball for the expected Draft v2.0 compiled files, and record the
result. Publication, post-publication verification, and any optional deprecation
of a confirmed broken 0.4.0 release remain manual maintainer actions. Publish the
[loader](../loader/README.md#manual-publishing-maintainer-only) separately
from its package directory.
