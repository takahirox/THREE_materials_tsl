import { IndexNode, FrontFacingNode, ScreenNode, ViewportDepthNode, NodeBuilder } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import type { JsonValue } from './THREEMaterialsTSLLoaderPlugin.js';

// Keep scope/field validation paired with exporter/geometryNodes.ts.
const scopes: Record<string, string[]> = {
  IndexNode: ['vertex', 'instance', 'draw'],
  ScreenNode: ['coordinate', 'viewport', 'size', 'uv'],
  ViewportDepthNode: ['depth', 'linearDepth'],
  FrontFacingNode: []
};
export const isGeometryNodeOp = (op: string) => Object.prototype.hasOwnProperty.call(scopes, op);
const check = (valid: unknown, message = 'Invalid or unsupported geometry/screen node arguments or links; supply paired adapters') => {
  if (!valid) throw new Error(message);
};

function validateArgs(op: string, args: Record<string, unknown>) {
  const fields = ['nodeType', 'name', 'global', 'parents', ...(op === 'FrontFacingNode' ? [] : ['scope'])];
  check(Object.keys(args).every((key) => fields.includes(key)));
  check(op === 'FrontFacingNode' || scopes[op].includes(args.scope as string),
    `Unsupported ${op} scope "${String(args.scope)}"; see the geometry-node audit or supply paired adapters`);
  check(args.nodeType === (op === 'IndexNode' ? 'uint' : op === 'FrontFacingNode' ? 'bool' : op === 'ViewportDepthNode' ? 'float' : null));
  check(args.name === null || args.name === '' || (typeof args.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(args.name)));
  check(typeof args.global === 'boolean' && typeof args.parents === 'boolean');
}

const pending = new WeakSet<object>();
export function resolveGeometryNode(op: string, raw: JsonValue | undefined, links: Record<string, unknown> = {}) {
  check(raw && typeof raw === 'object' && !Array.isArray(raw));
  const args = raw as Record<string, unknown>;
  validateArgs(op, args);
  for (const [key, link] of Object.entries(links)) {
    check(op === 'ViewportDepthNode' && args.scope === 'linearDepth' && key === 'valueNode');
    check(link && typeof link === 'object' && !Array.isArray(link) && Object.keys(link).length === 1 && typeof (link as { $ref?: unknown }).$ref === 'string');
  }
  let node;
  switch (op) {
    case 'IndexNode': node = new IndexNode(args.scope as never); break;
    case 'FrontFacingNode': node = new FrontFacingNode(); break;
    case 'ScreenNode': node = new ScreenNode(args.scope as never); break;
    case 'ViewportDepthNode': node = new ViewportDepthNode(args.scope as never); break;
    default: return null;
  }
  // These classes have no upstream scope deserialize override. Constructors
  // restore the scope; the graph loader hydrates validated native child slots.
  node.name = args.name as string;
  node.global = args.global as boolean;
  node.parents = args.parents as boolean;
  pending.add(node);
  return node;
}

export function finishGeometryNode(node: object) {
  if (!pending.has(node)) return;
  validateDepthInput(node);
  pending.delete(node);
}

// This conversion expects scalar ordinary depth, not a renderer resource or a
// vector silently truncated by shader formatting. Context-dependent inference
// needs an explicit consumer adapter, as with the other typed default adapters.
function validateDepthInput(value: object) {
  const node = value as Node & { valueNode?: Node | null };
  if (node.type !== 'ViewportDepthNode' || node.valueNode === null) return;
  check(node.valueNode?.isNode === true);
  const TypeBuilder = NodeBuilder as unknown as new () => NodeBuilder;
  check(node.valueNode!.getNodeType(new TypeBuilder()) === 'float');
}
