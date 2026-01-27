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

export type NodeDefinition = {
  op: string;
  args?: JsonValue;
  links?: Record<string, LinkDefinition>;
};

export type NodeExport = {
  op: string;
  args?: JsonValue;
  links?: Record<string, unknown>;
};
