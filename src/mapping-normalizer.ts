export type MappingDefinition = {
  fields: Record<string,{path: string;}>;
};


function getValueByPath(obj: any, path: string) {
  return path.split(".").reduce((acc, key) => {
    if (acc === undefined || acc === null) {
      return undefined;
    }
    return acc[key];
  }, obj);
}


export function normalizeWithMapping(
  message: unknown,
  deviceId: string,
  mapping: MappingDefinition
) {
  if (!message || typeof message !== "object") {
    return null;
  }

  const data: Record<string, unknown> = {};

  for (const targetKey of Object.keys(mapping.fields)) {
    const { path } = mapping.fields[targetKey];

    const value = getValueByPath(message, path);

    if (value !== undefined) {
      data[targetKey] = value;
    }
  }

  return {
    deviceId,
    timestamp: new Date().toISOString(),
    data,
    raw: message
  };
}