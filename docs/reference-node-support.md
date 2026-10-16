# Dynamic material and model reference nodes

[Issue #21](https://github.com/takahirox/THREE_materials_tsl/issues/21) adds paired
exporter/loader defaults for ordinary `MaterialNode`, `ModelNode` and
`MaterialReferenceNode` instances. Ordinary `Object3DNode` instances remain
explicitly rejected. This uses the existing Draft v2.0 encoding; the specification
and dependency ranges are unchanged. The later [UserDataNode audit](user-data-node-support.md)
defines a separate bounded current-object scalar-float subset; arbitrary reference
and user-data bindings remain deferred.

## Audit baseline

Rechecked on **2026-10-15**: [npm's current stable Three.js package](https://registry.npmjs.org/three/latest)
is **0.186.1**. The audit uses the locked `three@0.186.1` source (revision 186),
with `@types/three@0.186.0`, and these r186 implementations:

| Class | Constructor, serialization and runtime behavior | Default decision |
| --- | --- | --- |
| [MaterialNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/MaterialNode.js) | `scope`; inherited Node serialization omits scope. `setup()` selects native compositions, texture slots and cached material references from `builder.context.material`. | Preserve an explicit scope allowlist below; let Three.js construct and update the composition. |
| [ModelNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/ModelNode.js) | `scope`; inherited Object3DNode serialization/deserialization preserves scope and discovers its internal uniform. Each object update sets `object3d = frame.object` before the native transform update. | All six implemented scopes below. The object and uniform value are runtime caches, never serialized transforms or external bindings. |
| [MaterialReferenceNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/MaterialReferenceNode.js) | `property`, `uniformType`, optional `material = null`; inherited ReferenceNode serialization omits these constructor fields. `updateReference()` chooses explicit material or `state.material`; native object updates read the current property into an internal uniform. | Explicit property/type allowlist below, only `material === null`, `object === null`, `count === null`, `group === null`. Preserve a null/empty/identifier uniform name and base flags. |
| [Object3DNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/Object3DNode.js) | `scope`, optional `object3d = null`, internal uniform, object update frequency. `update()` dereferences `this.object3d`; it **does not** substitute `frame.object` when null. Radius additionally uses the current frame object's geometry. Serialization omits object identity. | Defer every ordinary instance: null is unbound, and explicit objects lack a portable binding in the current graph resource types. Never silently replace one with ModelNode. |

The adapters preserve base `name`, `global`, `parents` and `nodeType: null`.
Null/empty names remain distinct; nonempty names must be identifiers. ModelNode's
scope uses native serialize/deserialize; constructor fields omitted upstream are
explicit data. Native child discovery validates the graph boundary. Internal
uniforms and resolved reference/object caches are recreated by Three.js; they are
not extra graph inputs. Customized internal uniform precision, groups, update
callbacks, types, names or graph attachments require adapters. App callbacks,
changed update frequencies and inherited built-in operation IDs fail export.

## MaterialNode scopes

The exact supported scope strings are:

```text
color opacity alphaTest roughness metalness emissive normal ao
clearcoat clearcoatRoughness clearcoatNormal sheen sheenRoughness anisotropy
iridescence iridescenceIOR iridescenceThickness ior transmission thickness
attenuationDistance attenuationColor dispersion specularIntensity specularColor
```

Three.js owns each scope's ordinary texture modulation, channel selection,
normal-map setup and runtime reference updates. Values come from the imported
ordinary glTF material, including supported `KHR_materials_*` extensions. A scope
requiring physical or standard properties fails binding on a material lacking
those properties. Color, normal and opacity retain native fallback behavior.
Only ordinary state supported by native glTF export/import is transported;
non-glTF properties, extra texture variants and renderer resources are not added
by this feature. MaterialNode normal scopes using bump-only, object-space or
packed RG normals are rejected because native glTF does not reconstruct that
setup state. A separate alphaMap for MaterialNode opacity is also rejected;
glTF merges alpha into base-color textures rather than restoring that reference.
MaterialNode export reuses the existing ordinary-map transform check and rejects
transforms native glTF/KHR processing cannot preserve. Export rejects native glTF
normalization that would change values read by the graph; see the restrictions below.

Deferred scope strings include `shininess`, `specular`, `specularStrength`,
`reflectivity`, `rotation`, `scale`, `dashSize`, `gapSize`, `linewidth`,
`dashOffset`, `size`, `retroreflectivity` and `light`. These depend on material
families or ordinary values/resources outside the supported glTF mesh-material
transfer, or need a separate portability contract. Arbitrary scopes/property
paths, including declaration-only `refractionRatio`, are rejected. Exact shared
TSL objects keep their existing identity-based support; that does not transport
additional ordinary material properties.

Native setup-dependent behavior remains setup-dependent: changing texture
presence requires the normal Three.js material rebuild. For
`iridescenceThickness`, r186 captures the material's range array at shader setup;
mutating its elements remains live, while replacing the array requires rebuilding.
The importer does not replace Three.js's reference cache or shader semantics.

## MaterialReferenceNode allowlist

Every property has exactly one accepted uniform type:

| Type | Property strings |
| --- | --- |
| `color` | `color`, `emissive`, `sheenColor`, `attenuationColor`, `specularColor` |
| `vec2` | `normalScale`, `clearcoatNormalScale` |
| `float` | `opacity`, `alphaTest`, `roughness`, `metalness`, `emissiveIntensity`, `aoMapIntensity`, `clearcoat`, `clearcoatRoughness`, `sheen`, `sheenRoughness`, `anisotropy`, `anisotropyRotation`, `iridescence`, `iridescenceIOR`, `ior`, `transmission`, `thickness`, `attenuationDistance`, `dispersion`, `specularIntensity` |

Bindings are checked against the exporting material and **every prepared imported
material clone** before publication: numbers, Three.js Colors and Vector2s must
match the declared type. Numbers/components must be finite, with native positive
Infinity allowed for `attenuationDistance`. The native two-number iridescence
range is also checked when required by MaterialNode. There are no texture,
array/buffer, nested property, arbitrary object or foreign-material references.
In particular `map`, `userData.*`, `color.r`, `constructor`, `prototype` and
`__proto__` cannot be property selectors. Ordinary properties must actually exist
on the chosen material family. A custom application's later property assignments
must continue to satisfy Three.js's runtime type contract.

Each graph belongs to a source glTF material and its GLTFLoader-generated
primitive clones. Repeated meshes using the same ordinary material retain that
sharing. Clone-specific flags, vectors and texture signs remain distinct. Graph
nodes can be shared across these clones because MaterialReferenceNode selects
**the material currently being rendered** on each native NodeFrame update; it
does not capture the first imported material. MaterialNode likewise uses the
current builder material. Re-export may produce separate glTF material entries
for distinct clones, with an independent graph per entry on the next import;
current-material semantics remain the same. Cross-material graph identity is
not a glTF resource binding.

## Value transport restrictions

A matching runtime type alone does not make a reference portable. The exporter
rejects initial state that native r186 glTF export/import would omit or change.
The graph still reads the current material after import; no initial values are
encoded as node literals, and no snapshot overrides runtime updates.
These restrictions apply to MaterialReferenceNode and the properties actually
used by each MaterialNode setup branch:

| Referenced property | Required transport state |
| --- | --- |
| `alphaTest` | Zero, or positive with `transparent === false`. BLEND discards alpha cutoff. |
| `aoMapIntensity` | Without `aoMap`, must be the default 1. |
| `clearcoatRoughness` | With clearcoat disabled, must be the default 0. |
| `sheen` | Must be 0 or 1; native import sets enabled sheen to 1. |
| `sheenColor`, `sheenRoughness` | With sheen disabled, must be black and 1 respectively. |
| `anisotropyRotation` | With anisotropy disabled, must be 0. |
| `iridescenceIOR`, `iridescenceThicknessRange` | With iridescence disabled, must be 1.3 and `[100, 400]`. |
| `thickness`, `attenuationDistance`, `attenuationColor` | With transmission disabled, must be 0, Infinity and white. Attenuation distance 0 is always rejected because the loader replaces it with Infinity. |
| `emissive` | Must have a positive component or be exactly black; native export omits nonblack colors with no positive component. |
| `normalScale` | With a normal map, X must be nonnegative; without a map X must be 1. Y must equal X for explicit tangents, or -X without tangents. |
| `clearcoatNormalScale` | With enabled clearcoat and its normal map, native transport uses X as the scalar. Otherwise X must be 1. Y must equal X for explicit tangents, or -X without tangents. |

Normal scales are checked for every exported mesh using the material, including
material arrays and shared materials with different tangent layouts. This also
covers GLTFLoader's Y-sign changes when no normal map exists. A shared reference
that cannot preserve its value on all those meshes fails export. MaterialNode's
`normal` and `clearcoatNormal` scopes depend on scales only when their maps exist.
MaterialNode also rejects maps used by the selected scope when their enabling
clearcoat/sheen/anisotropy/iridescence/transmission value is zero, because native
glTF would omit the texture dependency.
MaterialNode's `anisotropy` scope also requires `anisotropyMap.channel === 0`
when a map exists: native r186 export omits this texture's `texCoord`, so another
UV channel would silently become channel 0 on import. Other channels need paired
consumer adapters with a transport path that preserves the selector.

For MaterialNode's `roughness` scope, when both `roughnessMap` and `metalnessMap`
exist, they must match `channel`, `offset`, `repeat`, `rotation`, `wrapS`, `wrapT`,
`minFilter` and `magFilter`. Native r186 packing copies metalnessMap's transform,
UV channel and sampler to the combined texture. Individually representable maps
with different sampling therefore fail export instead of silently changing the
roughness lookup. Shared textures and distinct textures with matching settings
are supported. A lone roughness map keeps its own sampling; the `metalness` scope
already uses the packing source's sampling and needs no extra restriction.
Separate roughness/metalness sampling requires paired consumer adapters with a
transport path preserving both lookups; the loader cannot infer settings lost
in a packed glTF texture.

Unrelated material properties are not subject to these reference checks. For
example a roughness reference does not constrain sheen strength. For state
outside this subset, use paired consumer adapters with an explicit material-state
transport/binding contract. Imported graph validation still checks every prepared
material clone atomically; the importer cannot infer initial state absent from a
file and does not invent it.

## ModelNode scopes and object bindings

Supported strings are `position`, `viewPosition`, `direction`, `scale`,
`worldMatrix` and `radius`. Their native outputs are respectively world position,
camera-space position, world direction, world scale, world matrix and transformed
bounding-sphere radius. Three.js owns type inference (`vec3`, `mat4`, `float`),
camera lookup, geometry bounds and object update timing. A shared graph follows
each current rendered object as its transforms change, including parent/world
transforms. No original object identity or transform snapshot is stored.

`Object3DNode(scope, null)` cannot be interpreted as an authored current-mesh
binding: it throws when updated, whereas ModelNode expressly supplies that
binding. Adding a default hook would change the original meaning. Explicit
Object3DNode targets also cannot be resolved from node/texture/accessor links;
retargeting to the mesh owning a material would lose the intended object. The
radius scope's mixed object/geometry semantics further require an explicit
consumer contract. All these ordinary Object3DNode variants fail export/import.

For a current-mesh reference, author **ModelNode** directly. For an explicit
external object/material, supply a serializer override and matching consumer
resolver for a distinct operation such as `BoundObjectPosition`. The exporter
must map the intended target to an application-owned stable binding ID. The
resolver validates that ID against an allowlisted binding map, then constructs
`new Object3DNode('position', resolvedObject)` (or a specific explicit material
reference) from consumer code. Populate the map with the intended imported or
external object before resolving the graph, using a companion loader plugin if
needed. Reject missing bindings; define ownership, cloning and lifetime yourself.
The defaults cannot discover this correspondence or serialize JavaScript object
graphs. See the [exporter override contract](../packages/exporter/README.md#supported-scope)
and [loader resolver contract](../packages/loader/README.md#supported-scope).

## Failure and validation

Unknown arguments, invalid scopes/types/names, extra or broken links, unsupported
object bindings and invalid graphs fail the entire material. Export throws;
import retains the complete ordinary material and all primitive clones, textures
and physical extensions. Every definition is checked, including unreachable
nodes. No partial entrypoint application, arbitrary constructor lookup or
file-provided code evaluation is introduced. Shared TSL singleton objects still
resolve by identity and reject file-supplied links.

The [reference integration suite](../packages/demo/test/references.test.js)
exercises every supported scope and property through two real
GLTFExporter → GLTFLoader round trips, including JSON and GLB, graph sharing,
material clones, ordinary textures, names/flags, actual GLSL builder flow and
native NodeFrame property/transform updates. Source and imported initial values
are compared on both round trips before applying runtime edits; negative probes
also demonstrate actual native value loss before asserting export rejection.
Invalid exports and malformed files cover unsafe selectors, external bindings, unsupported scopes, wrong types,
custom callbacks/groups, private graph attachments, broken references and
whole-material fallback. Regression cases use distinct UV sets to detect
anisotropy-map retargeting and malformed `normalTexture.scale` values to verify
atomic fallback across shared materials, primitive clones and the material cache,
before any `onApplied` callback. Metal/rough packing regressions demonstrate native
loss for differing UV channels, offsets, repeats, rotation and all four wrap/filter
settings before requiring export rejection; shared and distinct textures with
matching nondefault sampling survive two round trips. These are CPU tests;
browser/WebGPU visual checks are optional and were not run. Shader generation does not compile GPU programs or
establish pixel correctness.

Executed on 2026-10-15:

| Check | Result |
| --- | --- |
| `npm --prefix packages/loader ci` | Passed |
| `npm --prefix packages/exporter ci` | Passed |
| `npm --prefix packages/demo ci` | Passed |
| `npm --prefix packages/demo test` | Passed: 613 tests in 5 files, including 173 reference-node cases |
| `npm --prefix packages/loader run build` | Passed |
| `npm --prefix packages/exporter run build` | Passed |
| `npm --prefix packages/demo run typecheck` | Passed |
| `npm --prefix packages/demo run build` | Passed; Vite reports its bundle-size advisory |
| `git diff --check` | Passed |

Browser/WebGPU visual validation was skipped because this work used the Node integration environment.
No npm packages were published. Required post-merge verification: none.
