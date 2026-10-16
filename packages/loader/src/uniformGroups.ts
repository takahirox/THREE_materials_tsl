import { objectGroup, renderGroup, frameGroup } from 'three/tsl';
import type { Node, UniformGroupNode } from 'three/webgpu';

// Paired with exporter/uniformGroups.ts. Independent groups require an
// application-owned naming, identity and lifecycle binding contract.
const groups = { objectGroup, renderGroup, frameGroup };
export const isSharedUniformGroupOp = (op: string) => Object.prototype.hasOwnProperty.call(groups, op);
export const resolveSharedUniformGroup = (op: string) => groups[op as keyof typeof groups];
type GroupedNode = Node & { groupNode: UniformGroupNode };
const pending = new WeakSet<GroupedNode>();
export function prepareUniformNode(node: GroupedNode) {
  pending.add(node);
}
export function finishUniformNode(value: object) {
  const node = value as GroupedNode;
  if (!pending.has(node)) return;
  if (!Object.values(groups).includes(node.groupNode)) {
    throw new Error('UniformNode groupNode must reference an exact shared uniform group');
  }
  pending.delete(node);
}
