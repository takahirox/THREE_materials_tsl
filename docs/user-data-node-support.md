# Bounded current-object UserDataNode support

[Issue #31](https://github.com/takahirox/THREE_materials_tsl/issues/31) adds paired,
data-only default adapters for ordinary current-object `UserDataNode` instances.
The existing Draft v2.0 schema, required `materialType`, ordinary glTF fallback,
shared TSL singleton identities and v2.0-only handling are unchanged. There is no
new binding registry, resource type, shader source, callback payload or value map.

## Source audit

Rechecked **2026-10-17**: [npm's current stable Three.js](https://registry.npmjs.org/three/latest)
is **0.186.1**. The implementation was audited against the installed, locked
`three@0.186.1` (revision 186), with `@types/three@0.186.0`. No dependency or
version changes are included; the existing peer range does not establish support
for every Three.js revision.

| Native source | Audited behavior and consequence |
| --- | --- |
| [UserDataNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/UserDataNode.js) | `new UserDataNode(property, inputType, userData = null)` delegates to ReferenceNode and stores `userData`. `updateReference(state)` chooses explicit userData or **`state.object.userData`**. It does not search parents. There are no class-specific serialize/deserialize methods. |
| [ReferenceNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/ReferenceNode.js) | Stores property, uniformType, object, count, split properties, reference, node, group and name. Update frequency is `object`. `getValueFromReference()` reads the property path; `updateValue()` lazily constructs the native uniform and assigns its current value. Other branches create buffers, uniform arrays and texture references; those branches are outside this subset. `generateNodeType()` and `setup()` also perform native initialization. |
| [Node](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/Node.js) | Inherited serialization/deserialization handles discovered child links, omitting the reference constructor fields and object identity. `getSerializeChildren()` discovers the lazy internal uniform and any attached graph inputs. Private fields and self links can evade native discovery, so the adapter also validates own state and existing node-link rules. |
| [NodeFrame](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/NodeFrame.js) | `updateNode()` calls `updateReference(frame)` before the object-frequency update. Each rendered object therefore selects its own dictionary, including when a material and reference node are shared. No application update hook is installed by these plugins. |
| [GLTFExporter](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/exporters/GLTFExporter.js) | `serializeUserData()` JSON-stringifies Object3D.userData into node extras **before** processing its mesh/material. `writeMaterialAsync(material, materialDef)` runs after ordinary material serialization. `writeMesh(mesh, meshDef)` runs after primitive construction, but is skipped for the geometry/material mesh-cache hit. `afterParse(input)` runs after all nodes/resources, before returning JSON/GLB. The writer's runtime `nodeMap` identifies every emitted source object. |
| [GLTFLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GLTFLoader.js) | `loadMesh()` builds a rendering object per primitive. One primitive returns its Mesh; multiple primitives return a Group. Mesh-level extras go to each primitive Mesh; primitive extras go to geometry. `_loadNodeShallow()` assigns **node extras to the returned node**, which may be a Group, Bone or attachment wrapper. `afterRoot(result)` sees completed scenes/materials/clones. |

`assignFinalMaterial()` caches primitive-specific material clones for derivative
tangents, vertex colors and flat shading, retaining material-index associations.
`_getNodeRef()` clones reused mesh objects and copies their associations; node
extras are then applied to the particular returned object. This works for distinct
single-primitive nodes sharing a native mesh definition, with different values.

`loadScene()` prunes object associations per scene. The loader validates ownership
against the parser's **cached node dependency identity**, checking associations
as well when present. Distinct nodes in multiple scenes work. When one node is
reused as a scene root, native scene loading may clone its object without a
corresponding cached node identity. Those scene clones are deferred. The loader
never infers an owner from a matching value, name, geometry, parent or material.

## Exact default contract

The supported selector is one ASCII identifier matching
`^[A-Za-z_][A-Za-z0-9_]*$`, excluding these reserved/native metadata names:

```text
__proto__ prototype constructor __defineGetter__ __defineSetter__
__lookupGetter__ __lookupSetter__ hasOwnProperty isPrototypeOf
propertyIsEnumerable toString toLocaleString valueOf name gltfExtensions toJSON
```

Only `uniformType: 'float'` is supported. Every mesh using the material must have
an **own, enumerable data property** with a finite JavaScript number, excluding
negative zero (JSON changes it to positive zero). Missing, inherited, accessor,
null, boolean, string, nonfinite, array, buffer, texture, object-reference,
Color and vector values are rejected. Integer-valued numbers with float type
are fine; `int`/`uint` types remain deferred because their full native update,
shader and repeated transport contract has not been established here.

The node must have the exact bundled Three.js `UserDataNode` prototype and native
default state: `userData`, `object`, `count`, `group`, `name` and `nodeType` are
null; `global` and `parents` are false; `updateType` is `object`; before/after
update types are `none`; `_beforeNodes` is null. `properties` must be exactly the
one-element selector array. Subclasses, symbols, accessors, own callbacks,
nondefault labels/groups/scheduling, extra scalar fields and unknown links fail.
The known native ID/version/UUID/build/stack-trace caches are runtime-only.

A previously initialized `reference` cache may contain the last passive JSON
dictionary. A previously initialized `node` cache must be an ordinary native
float UniformNode with default name, precision, base flags, scheduling and exact
objectGroup. Existing uniform-group validation also checks singleton state.
Caches are inspected for unsupported customization and recreated by Three.js;
their values and resolved dictionary identities are never exported.

The source dictionary must be a plain object (Object.prototype or null), with
passive JSON contents. Plain objects/arrays, null, strings, booleans and finite
numbers excluding negative zero may occur in **unrelated extras**. Accessors,
functions, symbols, undefined, custom prototypes/objects, serialization callbacks
and cycles are rejected before native JSON serialization. This prevents unrelated
extras from running callbacks or causing the writer to omit the whole dictionary.
These allowances do not expand the referenced property's scalar-float domain.

The supported source render shape is an exact ordinary `Mesh` with one scalar
material, triangles, no wireframe, pivot, skinning, instancing or morph targets.
A scalar material ignores BufferGeometry.groups in native export (including
BoxGeometry's default groups); these inert groups are safe. Material arrays,
including a one-element array, and groups producing multiple primitives are
deferred. Mesh children are allowed when each rendering mesh independently
satisfies the contract. Standard/basic/physical NodeMaterial families retain their
existing ordinary glTF support.

Import requires one triangle primitive per mesh definition (mode 4 or omitted),
node-level extras with the declared value, an exact ordinary Mesh returned for
the corresponding cached node, and equal values on that **actual rendering Mesh**.
Nodes with skins, camera attachments or node extensions are deferred. Morphs,
instanced/skinned/subclass objects, wrappers and material arrays are rejected.
Every mesh/node definition using the material is checked, and every such node
must have an actual loaded render object; orphan or uninstantiated definitions
cannot establish ownership. All loaded scenes are checked, including scenes
other than the default scene. Mesh/primitive/parent extras cannot replace missing
node extras, even if they happen to produce an equal value on a child.

## Encoding, updates and atomicity

The default emits only:

```json
{ "op": "UserDataNode", "args": { "property": "tint", "uniformType": "float" } }
```

There are no graph links (an empty links object is harmless). The resolver requires
exactly these two arguments, rejects other fields/links and constructs a real
`UserDataNode`. Native defaults reconstruct the omitted native state. Ordinary
node extras carry the per-object number; it is never frozen into the graph.

Exporter `beforeParse()` checks selected graph inputs and source meshes before
extras serialization. `afterParse()` checks final node extras, primitive shape and
source association for every exported object, covering native mesh-cache hits.
Any failure rejects export before a JSON glTF or GLB result is returned.
Custom operations remain consumer-owned and need paired overrides.

Importer checks run inside the existing private graph/material preparation in
`afterRoot()`. Every node definition is resolved and validated, including
unreachable definitions. Unsupported state, fields, link shapes, cycles, dangling
references, selectors, extras or owners keep the **entire ordinary glTF material**
and all its primitive clones, preserving other supported material extensions.
No graph slots, replacement materials or material dependency-cache replacements are
published on failure. Other independently valid materials retain existing behavior.

A single imported graph shares one UserDataNode between entrypoints and material
clones, with exact shared TSL identities such as `time` retained. Re-exporting
separate material clones can emit separate material definitions; the next import
has one graph per definition. Cross-material graph identity is not a glTF resource
binding. Native per-object reads remain correct in both rounds.

After import, normal Three.js object updates read later changes to the scalar or
to the mesh's userData dictionary. Applications must continue to provide valid
values; the plugins add no per-frame validation or alternate update system.

## Deferrals and paired adapter ownership

- Multi-primitive/Group expansion needs a paired geometry/node adapter that maps
  each glTF node and primitive to its exact rendering Mesh and explicitly owns
  value transport to **each** child, including primitive/material clones,
  repeated exports, shared meshes and later updates. A parent search or an
  initial one-time copy alone does not define live ownership.
- Scene-root clones, pivots, attachments, morphs, skinning and instancing need
  similarly explicit source/target render-object provenance and lifecycle tests.
  Node extensions require a proven producer/consumer ownership contract.
- Explicit userData dictionaries or foreign objects need consumer-owned binding
  IDs, exact target lookup, sharing, lifetime and failure rules in paired overrides.
  The resolver must fail for absent/wrong owners. A foreign binding must never
  silently become the current object. General ReferenceNode, ReferenceBaseNode,
  ReferenceElementNode, renderer/material/object references and scene state are
  not enabled by this feature.
- Nested paths, inherited/accessor properties, unsafe names, object/Color/vector/
  array/buffer/texture values and other numeric types need a typed native glTF
  transport/update contract with repeated-round-trip evidence. Passive unrelated
  extras do not supply that contract.
- Independent uniform groups, labels, alternate update frequencies and app
  callbacks need consumer-owned scheduling/identity/lifetime bindings. Executable
  JavaScript, GLSL, WGSL and callback bodies must never be embedded in glTF.

## Validation

The [UserDataNode integration suite](../packages/demo/test/userData.test.js)
uses real GLTFExporter → GLTFLoader → GLTFExporter → GLTFLoader paths for JSON
glTF and GLB. It validates actual mesh extras, cached shared geometry, different
per-mesh values, single meshes, multiple scenes, primitive-specific material
clones, node identity/entrypoints, ordinary material values and physical extensions.
Native NodeFrame updates run before and after import and scalar/dictionary
mutations, with one frame reused across distinct objects. Native GLSL/WGSL
vertex/fragment shader flow and uniforms are compared across both imports.

Negative tests cover missing/wrong/nonfinite extras, JSON negative zero, inherited
and accessor properties, serialization callbacks, nested/external bindings,
unsupported types/groups/schedules/state, initialized uniform customization,
unknown/bad links, cycles/dangling references, invalid unreachable definitions,
late invalid entrypoints and unsupported render layouts. A no-op named TSL loader
plugin is used as the ordinary-material control, preventing the disabled adapter
alone from introducing unknown-TSL metadata. Complete material.toJSON data
(excluding per-load UUID) and graph-slot absence are compared with that control,
including physical extensions and primitive clones.

Browser WebGL/WebGPU visual checks were **not run**. Node-side updates and shader
flow establish neither GPU compilation nor rendered pixels. No post-merge
verification, publication or version bump is required by this issue.

Final checks on **2026-10-17**:

| Command | Result |
| --- | --- |
| `npm --prefix packages/demo ci` | Passed; 55 packages installed. npm reported 10 dependency vulnerabilities: 3 moderate, 5 high, 2 critical. No dependency upgrades or audit fixes were performed. |
| `npm --prefix packages/exporter ci` | Passed; 9 packages installed; 0 vulnerabilities reported. |
| `npm --prefix packages/loader ci` | Passed; 9 packages installed; 0 vulnerabilities reported. |
| `npm --prefix packages/demo test` | Passed: **1,511 tests in 10 files**, including **129 UserDataNode cases**; no failed or skipped tests in the final run. Existing reference tests emitted native metalness/roughness map merge and UV-channel warnings. |
| `npm --prefix packages/exporter run build` | Passed. |
| `npm --prefix packages/loader run build` | Passed. |
| `npm --prefix packages/demo run typecheck` | Passed. |
| `npm --prefix packages/demo run build` | Passed; 288 modules transformed. Vite warned that the minified JS chunk (1,736.06 kB; 484.87 kB gzip) exceeds 500 kB. |
| `git diff --check` and `git diff --cached --check` | Passed. |

No unresolved check failures remain. The optional browser/GPU checks described
above were unperformed; no GPU rendering claim follows from the passing tests.
