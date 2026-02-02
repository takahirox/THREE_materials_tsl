export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type LinkDefinition = {
  $ref?: string;
  $refTex?: number;
  $refAccessor?: number;
};

export type LinkValue = LinkDefinition | LinkValue[] | { [key: string]: LinkValue };

export type NodeDefinition = {
  op: string;
  args?: JsonValue;
  links?: Record<string, LinkValue>;
};

export type NodeExport = {
  op: string;
  args?: JsonValue;
  links?: Record<string, unknown>;
};
