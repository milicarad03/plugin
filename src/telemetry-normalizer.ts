import type { DeviceTelemetry } from './device-registry.interface';

function findValueByPossibleKeys(
  obj: unknown,
  possibleKeys: string[],
): unknown {
  if (typeof obj !== 'object' || obj === null) {
    return undefined;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findValueByPossibleKeys(item, possibleKeys);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  const record = obj as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (possibleKeys.includes(key)) {
      return record[key];
    }
  }

  for (const value of Object.values(record)) {
    const found = findValueByPossibleKeys(value, possibleKeys);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

export function normalizeUnknownDeviceModel(
  message: unknown,
  deviceId: string,
): DeviceTelemetry | null {

  if (!deviceId) {
    return null;
  }

  const timestampValue = findValueByPossibleKeys(message, [
    'timestamp',
    'time',
    'createdAt',
  ]);

  const data: Record<string, unknown> = {};


  const temperature = findValueByPossibleKeys(message, [
    'temperature',
    'temp',
  ]);

  if (temperature !== undefined) {
    data.temperature = temperature;
  }

  
  const humidity = findValueByPossibleKeys(message, [
    'humidity',
    'hum',
  ]);

  if (humidity !== undefined) {
    data.humidity = humidity;
  }

 
  const pressure = findValueByPossibleKeys(message, [
    'pressure',
    'airPressure',
    'press', 
  ]);

  if (pressure !== undefined) {
    data.pressure = pressure;
  }


  const led = findValueByPossibleKeys(message, [
    'led',
    'ledState',
  ]);

  if (led !== undefined) {
    data.led = led;
  }

  
  const power = findValueByPossibleKeys(message, [
    'power',
    'isOn',
    'on',
  ]);

  if (power !== undefined) {
    data.power = power;
  }

  const brightness = findValueByPossibleKeys(message, [
    'brightness',
    'level',
  ]);

  if (brightness !== undefined) {
    data.brightness = brightness;
  }

  const mode = findValueByPossibleKeys(message, [
    'mode',
    'operatingMode',
  ]);

  if (mode !== undefined) {
    data.mode = mode;
  }

  const location = findValueByPossibleKeys(message, [
    'location',
    'room',
  ]);

  if (location !== undefined) {
    data.location = location;
  }

  return {
    deviceId,
    timestamp:
      typeof timestampValue === 'string'
        ? timestampValue
        : new Date().toISOString(),
    data,
  };
}