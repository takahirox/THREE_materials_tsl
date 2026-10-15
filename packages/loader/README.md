# @takahirox/gltf-three-materials-tsl-loader

GLTFLoader plugin for [THREE_materials_tsl Draft v2.0](../../README.md).
Version 0.4.1 is v2.0-only. Earlier encodings use the ordinary glTF fallback.

## Install

```sh
npm install three @takahirox/gltf-three-materials-tsl-loader
```

## Usage

```ts
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { THREEMaterialsTSLLoaderPlugin, createDefaultNodeResolver } from '@takahirox/gltf-three-materials-tsl-loader';

const loader = new GLTFLoader();
loader.register((parser) => new THREEMaterialsTSLLoaderPlugin(parser, {
  nodeResolver: createDefaultNodeResolver(),
  onError: (error) => console.warn('TSL material uses ordinary glTF fallback:', error)
}));
```

`nodeResolver` is required. Each material's required `materialType` selects its
own class; built-in mappings are `MeshBasicNodeMaterial`,
`MeshStandardNodeMaterial`, and `MeshPhysicalNodeMaterial`. There is no inferred
material type. Extend or override the mapping with subclasses of these families:

```ts
class CustomMaterial extends MeshPhysicalNodeMaterial {
  static get type() { return 'CustomMaterial'; }
}

loader.register((parser) => new THREEMaterialsTSLLoaderPlugin(parser, {
  materialTypes: { CustomMaterial },
  nodeResolver: createDefaultNodeResolver({
    overrides: { MyCustomNode: (args) => new MyCustomNode(args) }
  })
}));
```

Import `MeshPhysicalNodeMaterial` from `three/webgpu` in this example. The mapping
constructors take no arguments and must produce a NodeMaterial whose `type`
exactly matches the identifier. The removed `materialType` and
`supportedVersions` options have no replacement defaults.

## Supported scope

The reference implementation is tested with Three.js **r186** (`three@0.186.1`,
`@types/three@0.186.0`) and mesh materials. The existing peer dependency range
`three >=0.182.0` is retained; this validation does not establish compatibility
with every release in that range.
It preserves GLTFLoader's core PBR/alpha/texture values and its supported ordinary
material extensions, including physical clearcoat, transmission, volume, IOR,
specular, sheen, iridescence, anisotropy, dispersion and emissive strength.
`KHR_materials_unlit` uses `MeshBasicNodeMaterial`. A physical ordinary material
requires a physical NodeMaterial; incompatible pairings use fallback. New
material families or custom ordinary material extensions may need a property
transfer adapter in the plugin. Lines and points remain ordinary Three.js
materials, as created by GLTFLoader.

The plugin lets GLTFLoader construct ordinary materials and primitive-specific
clones first. In `afterRoot`, it prepares the graph and all replacements for each
material privately, then updates scene references, associations and dependency
caches. Shared materials stay shared, while clone-specific values such as vertex
colors, flat shading and normal scales stay distinct. Failed validation, type
resolution, or graph reconstruction leaves the original ordinary material and
its supported extensions intact. `onError` receives the failure; `onApplied`
receives each prepared NodeMaterial and its extension before publication. A
throwing `onApplied` also causes fallback for that material.

The default node resolver supports:

- Shared node objects exported by `three/tsl`, including `materialColor`, `time`
  and position/normal accessors. Their runtime identity and dynamic references
  are retained; file data cannot mutate their links.
- `ConstNode` and `UniformNode` with numeric, boolean, color, vector or matrix
  literals, using Three.js's deserialization (including precision).
- `AttributeNode`, `MathNode`, and `OperatorNode` with serialized inputs.
- `SplitNode`, `JoinNode`, `ConvertNode`, `SetNode`, and `FlipNode` for components,
  vector construction and conversion.
- `ArrayNode`, `ArrayElementNode`, and `ConditionalNode` for arrays and selection.
- `VarNode`, `VaryingNode`, `SubBuildNode` (op `SubBuild`), and `RotateNode`,
  including declaration flags, interpolation settings and Euler order.

See the [coverage matrix](../../docs/tsl-node-coverage.md) for the complete audited
class/family and shared-object inventories, tested boundaries, deferred cases,
reasons and adapter paths. New defaults validate argument fields and required
link shapes before reconstruction; malformed inputs use whole-material fallback.

Entrypoints must name existing material properties ending in `Node`. All graph
nodes are checked, including unreachable definitions. Nested array/object links,
node references, texture references and accessor references are supported.
Custom resolvers receive `(op, args, links)` and return a node instance, a constructor,
or a factory. The optional third argument is the encoded link dictionary before
hydration; existing two-argument resolvers remain compatible. Wrappers delegating
to the default resolver should forward all three arguments. Return fresh instances
for nodes with links; links are assigned
after construction. Factories/constructors receive array arguments positionally
and other arguments as one value. Custom code is consumer-supplied, never read
from the glTF file.

Advanced texture variants, buffer node classes, closures, code-backed nodes and
renderer resources are outside the default allowlist. Some can use paired
exporter/resolver adapters; others need resource or control-flow design work (see the matrix). Custom code
must remain consumer-supplied; the file cannot carry executable code.
Runtime rendering still depends on Three.js's own node
semantics and renderer support. `three.revision` is optional diagnostic metadata;
it does not select a migration or gate loading.

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
filters at export. Native r186 packing uses metalnessMap's sampling for both
maps; the loader cannot recover separate settings lost during packing.
Incompatible combinations require paired consumer adapters.
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
cd packages/loader
npm ci
npm pack --dry-run
# Review the file list for dist/index.js, the plugin/resolver .js and .d.ts files.
npm publish
# After publication, verify the registry version:
npm view @takahirox/gltf-three-materials-tsl-loader version
npm view @takahirox/gltf-three-materials-tsl-loader@0.4.1 version
```

Do **not** use `--ignore-scripts` for packing or publishing, or disable scripts
in npm configuration: that bypasses the clean build. Install development
dependencies with `npm ci` (without `--omit=dev`) so TypeScript is available.
The manifest configures public access for this scoped package.

The maintainer must verify both registry queries return `0.4.1`, inspect the
published 0.4.1 tarball for the expected Draft v2.0 compiled files, and record the
result. Publication, post-publication verification, and any optional deprecation
of a confirmed broken 0.4.0 release remain manual maintainer actions. Publish the
[exporter](../exporter/README.md#manual-publishing-maintainer-only) separately
from its package directory.
