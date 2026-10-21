# Bounded current-object local position references

[Issue #37](https://github.com/takahirox/THREE_materials_tsl/issues/37) adds paired
default adapters for exact ordinary native `ReferenceNode('position', 'vec3')`
instances. This reads the **current rendered Mesh's local position**. It remains
independent of ModelNode's world-position scope, explicit foreign objects,
UserDataNode and RendererReferenceNode. The Draft v2.0 schema, required
`materialType`, ordinary material extensions and exact shared TSL singletons are
unchanged. No Three.js core edits, binding registry or package version changes
are needed.

## Installed source audit

Audited on **2026-10-21**, before implementation, against the installed lockfile
version **three@0.186.1 / revision 186**, with **@types/three@0.186.0**. This is an
installed-source audit, not a claim of compatibility with all versions in the
existing peer range. It builds on the [material/model reference audit](reference-node-support.md),
[UserDataNode ownership audit](user-data-node-support.md) and
[renderer-reference lifecycle audit](renderer-reference-node-support.md).

| Native r186 implementation | Behavior and consequence |
| --- | --- |
| [ReferenceNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/ReferenceNode.js) | Constructor stores property/type, `object = null`, `count = null`, split properties, reference, lazy node, null group/name, object update frequency. `updateReference(state)` selects explicit object or `state.object`. `getValueFromReference()` follows the split path. Count/array/texture branches are separate and deferred. Ordinary vec3 `updateValue()` creates `uniform(null, 'vec3')` lazily and assigns the **Vector3 itself** to its value; no position is copied. |
| [Node](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/Node.js) | Setup calls `updateReference(builder)` before the node's setup. ReferenceNode's `generateNodeType()` also initializes its uniform when necessary. Inherited `getSerializeChildren()` / serialize discover the internal uniform, but omit selector/type and object ownership. Inherited deserialize only restores links. The adapter validates exact state, uses native discovery/serialize with preseeded child identities, omits caches, and supplies the two constructor args explicitly. |
| [NodeFrame](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/NodeFrame.js) | `updateNode()` calls `updateReference(frame)` first, then object-frequency `update()` on every call. Shared materials therefore select each Mesh's position, including same-frame mutations and switches. No plugin update callback is installed. |
| [UniformNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/UniformNode.js), [GLSLNodeBuilder](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/nodes/GLSLNodeBuilder.js), [WGSLNodeBuilder](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/nodes/WGSLNodeBuilder.js) | Native vec3 type inference, setup/analyze/generate, uniform declarations and object-group binding remain renderer-owned. Repeated links reuse one uniform. Native CPU binding packing reads the selected Vector3's current components. |
| [GLTFExporter](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/exporters/GLTFExporter.js) | `processNodeAsync()` writes position/quaternion/scale directly with `trs`, omitting defaults. Otherwise it updates the matrix when `matrixAutoUpdate`, and writes a nonidentity matrix. Fixed matrices can disagree with position. Pivots take a separate container path. `writeMesh` is skipped on geometry/material cache hits, while final `nodeMap` includes every emitted source object. `afterParse` runs before JSON/GLB returns. Mesh cache keys use geometry/material UUIDs; material keys additionally include tangent presence when normalMap exists. |
| [GLTFLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GLTFLoader.js) | `loadMesh()` returns the single primitive's Mesh directly; multiple primitives produce a Group. `_loadNodeShallow()` can add a Group/Bone for attachments, then restores matrix with `applyMatrix4()` (decomposition) or direct TRS arrays. Pivot metadata later rewrites container/child positions. `_getNodeRef()` clones reused meshes and copies associations; final material assignment can cache primitive-specific clones. `afterRoot` exposes completed scenes and cached node dependencies, before the last world-matrix update. |

The cache index checks depend on the audited r186 implementation. An incompatible
writer fails explicitly instead of guessing association from names or values.

## Exact initial transform and ownership contract

The initial subset deliberately requires all of these conditions:

- An exact ordinary `Mesh`, scalar material, triangle primitive, position geometry,
  full draw range, no indirect/instanced geometry or morph attributes. Native
  geometry groups with a scalar material are fine because they emit one primitive.
- A finite local position with **at least one nonzero component**, excluding
  negative zero. Local scale is exactly `(1,1,1)` and quaternion `(0,0,0,1)`.
- With automatic matrices, native export composes that translation. With fixed
  matrices, the entire finite matrix must exactly equal that translation matrix.
  Import accepts either an explicit pure translation matrix or translation TRS
  with omitted/identity rotation and scale; simultaneous matrix and TRS is invalid.
- No pivot or pivot metadata on the source Mesh or its ancestors. Imported owners
  must retain null pivots and matching finite local transform components. Skins,
  cameras, node/mesh extensions, morph targets and mesh weights on these owners
  are deferred. Supported **material** extensions remain supported.
- Every emitted node must refer to the native geometry/material mesh-cache entry
  and the expected material index, with exactly one triangle primitive. Final
  exported translation must exactly equal the corresponding source Mesh position.

Nonzero translation is an intentional initial restriction: native export omits
an identity transform entirely. Without storing a forbidden position snapshot,
an absent transform cannot distinguish a legitimate zero position from removed
nonzero transform data. This subset requires explicit transport evidence instead.
Native runtime reads may still move to zero or arbitrary finite positions after
import; re-export requires the initial transport contract again.

Transformed parents are supported and tested: parent translation, rotation and
nonuniform scale affect world position without changing this reference's local
position. The plugin does not change native glTF's handling of parent transforms.
Mesh-local rotations/scales (including quaternion normalization/sign variants),
negative scale, general TRS/matrix decomposition, shear, projective/singular
matrices, identity/implicit transforms and signed zero remain explicitly deferred.
This avoids tolerance-based acceptance or normalization changing the binding.

Export preflight checks **every exported Mesh using a selected graph**, including
cached geometry/material uses that skip writeMesh. Final checks inspect actual
node definitions. Hidden objects follow native `onlyVisible`; unselected graph
slots do not impose reference checks. These checks do not constrain unrelated
materials or transform-only parent objects beyond pivot deferral.

Import checks every definition/primitive using the glTF material, then requires
its cached `getDependency('node', index)` to be the exact rendering Mesh in the
loaded scenes. Where retained, associations must agree on node, mesh and primitive
index zero. Position must equal that node definition's translation, with finite
identity local rotation/scale. Ownership never comes from names, equal positions,
shared geometry, shared material or matching parent values. Shared native mesh
resources, distinct geometries, primitive-specific material clones and distinct
nodes in multiple scenes are tested. Native loaded scenes are Groups; repeated
multi-scene tests wrap each in a Scene to preserve scene partitioning during
native re-export without changing Mesh-local transforms. Reused scene roots whose clones lack exact
cached-node ownership, wrappers, attachments and multi-primitive expansion are
deferred, even if their child positions happen to match.

## Exact node state and portable encoding

Only the exact bundled native ReferenceNode prototype is supported. Property is
`position`, type is `vec3`, and the selector cache is an ordinary one-element
`['position']` array without extra properties, symbols or accessors. Object,
count, group, name, nodeType and before-node attachment are null; global/parents
are false; updateType is `object`; before/after update types are `none`. Remaining
native constructor fields must retain defaults. Own callbacks, accessors,
unknown scalar/child state and subclasses (including inherited built-in type
masquerades) fail. Known native ID/version/UUID/build/swizzle/stack caches are
runtime-only; version must be a nonnegative safe integer.

Both unbuilt and legitimately native-built instances work. The resolved
`reference` is an **opaque runtime object**, cleared only on a temporary graph
view used for validation. It is never traversed, serialized, snapshotted or
queried through callbacks, and the source instance remains intact. A lazy internal
node must be the exact native UniformNode, vec3, default precision/name/base/update
state and exact default objectGroup; its value is null or a passive finite native
Vector3. The group's native configuration is validated, including for unbuilt
references. Extra uniform inputs/customization fail. The uniform and Vector3 are
never portable graph inputs or values. Native UUID cache keys are checked without
object coercion. Math/operator expression parents preseed child identities too,
so they cannot recursively snapshot these runtime caches. Import creates fresh
empty native caches.

The entire encoded definition is:

```json
{ "op": "ReferenceNode", "args": { "property": "position", "uniformType": "vec3" } }
```

There are no node links, object IDs, position snapshots, generated shaders or
executable code. Shared entrypoints/inputs retain node identity within each
material graph. Distinct ordinary references stay distinct. ModelNode and shared
TSL singletons keep their existing independent paths.

## Failure and consumer adapters

Wrong/nested/arbitrary selectors, other types, foreign/non-null objects,
arrays/buffers/textures, callbacks, custom groups/names/scheduling, unknown state,
extra links and invalid object/transform ownership fail explicitly on export.
Malformed imports, invalid/unreachable definitions, dangling/malformed references,
cycles and failed native ownership/transform checks abandon the entire material's
TSL replacement. Existing loader preparation publishes no partial entrypoints and
retains the **complete ordinary glTF material**, supported other extensions,
primitive clones and native material dependency caches. Validation happens before
any successful `onApplied` callback. A native-invalid glTF that GLTFLoader itself
cannot parse is not made valid by this fallback.

A foreign object's local position needs a consumer-owned adapter with a distinct
operation, for example `ConsumerPosition` plus an allowlisted `bindingId`. The
consumer must populate a binding registry with the intended imported/external
object before graph resolution and construct the native ReferenceNode with that
resolved object. Reject unknown IDs and define clone ownership, lifetime and
scheduling explicitly. Files must carry only validated data IDs. No such registry
or adapter is silently installed by the defaults; existing override hooks suffice.
Broader matrices, zero-position transport and primitive/wrapper association need
separately proven transport rules before extending the default allowlist.

## Validation

The [focused integration suite](../packages/demo/test/positionReferences.test.js)
uses real GLTFExporter → GLTFLoader → GLTFExporter → GLTFLoader cycles for JSON
and GLB, matrix/TRS options, nonzero local positions under transformed parents,
shared materials with distinct positions, geometry caching/clones, material clones,
multiple scenes, graph sharing, independent references, singleton identity and
ordinary physical material values/extensions. It asserts actual render Mesh
positions and exact cached-node associations in both imports. Native controls
show stale fixed-matrix position loss and multi-primitive Group retargeting.

Real NodeFrame checks mutations, same-frame object switches and current Vector3
identity before/after import. Real GLSL/WGSL builders exercise vertex/fragment
setup, analyze and generate; native CPU object-group binding packing checks live
vec3 values and repeated-input uniform reuse. Negative probes exercise malformed
source state, opaque caches, getters without invocation, transform encodings,
wrappers/clones, primitive ownership, invalid graphs and whole-material fallback.

Executed on 2026-10-21:

| Command | Result |
| --- | --- |
| `npm --prefix packages/loader ci` | Passed; zero vulnerabilities reported |
| `npm --prefix packages/exporter ci` | Passed; zero vulnerabilities reported |
| `npm --prefix packages/demo ci` | Passed; npm reported 10 development-tool vulnerabilities (3 moderate, 5 high, 2 critical) |
| `npm --prefix packages/demo test` | Passed: 2,016 tests in 13 files, including 150 position-reference tests; no skips |
| `npm --prefix packages/loader run build` | Passed |
| `npm --prefix packages/exporter run build` | Passed |
| `npm --prefix packages/demo run typecheck` | Passed |
| `npm --prefix packages/demo run build` | Passed; Vite bundle-size advisory |
| `git diff --check` | Passed |

An initial exporter build exposed a TypeScript declaration mismatch; it was fixed.
Focused test failures corrected assumptions about fluent VarNode wrappers, native
post-hook world updates and loaded-scene Group re-export. A callback regression
probe exposed recursive MathNode/OperatorNode child serialization; those adapters
now preseed native child identities, preventing runtime reference traversal and
uniform value snapshots through expression parents. The final full suite and
builds passed after the implementation fixes. Existing reference tests print
native metalness/roughness packing and mismatched-UV warnings. No dependency
versions/lockfiles were changed, and no dependency remediation was attempted.

Browser WebGL/WebGPU visual smoke tests were not performed. Native NodeFrame,
GLSL/WGSL shader generation and CPU uniform packing do **not** establish hardware
shader compilation, successful GPU uploads or rendered pixels. No packages were
published or versions bumped. Required post-merge verification: none.
