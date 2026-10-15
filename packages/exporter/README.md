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
reasons and adapter paths. Texture/buffer node classes, closures, code-backed
nodes and renderer resources are outside the default allowlist. Some can use
paired adapters; others need additional resource/control-flow design. Ordinary
nodes with app-installed callbacks, uniforms with non-default groups, subclasses
inheriting built-in operation IDs, and unrepresentable inputs fail explicitly.
Custom code stays consumer-supplied; the file cannot carry executable code.
The existing peer dependency range `three >=0.182.0` is retained;
this validation does not establish compatibility with every release in that
range. Support across Three.js revisions is not guaranteed.

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
