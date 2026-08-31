export type CommandMetadataField = {
  name: string;
  path: string;
  type?: string;
  required: boolean;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
  description?: string;
};

export function extractCommandFields(
  schema: any,
  prefix = '',
  required: string[] = [],
): CommandMetadataField[] {
  if (!schema?.properties) {
    return [];
  }

  const result: CommandMetadataField[] = [];

  for (const [key, value] of Object.entries<any>(schema.properties)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;

    if (value.type === 'object' && value.properties) {
      result.push(
        ...extractCommandFields(
          value,
          fieldPath,
          value.required ?? [],
        ),
      );
      continue;
    }

    result.push({
      name: key,
      path: fieldPath,
      type: value.type,
      required: required.includes(key),
      enum: value.enum,
      minimum: value.minimum,
      maximum: value.maximum,
      default: value.default,
      description: value.description,
    });
  }

  return result;
}
