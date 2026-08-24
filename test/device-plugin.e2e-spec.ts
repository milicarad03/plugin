import mqtt, { type MqttClient } from 'mqtt';
import { MqttDevicePlugin } from '../src/MqttDevicePlugin';

const BROKER_URL =
  process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883';
const RUN_ID = `${process.pid}-${Date.now()}`;
const KNOWN_DEVICE_ID = `known-device-${RUN_ID}`;
const UNKNOWN_DEVICE_ID = `unknown-device-${RUN_ID}`;
const PROBE_DEVICE_ID = `probe-device-${RUN_ID}`;

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

describe('MqttDevicePlugin (e2e)', () => {
  let plugin: MqttDevicePlugin;
  let publisher: MqttClient;
  let findByDeviceId: jest.Mock;
  let onTelemetry: jest.Mock;

  const topicFor = (deviceId: string) =>
    `iot/devices/${deviceId}/telemetry`;

  const publish = (topic: string, payload: string) =>
    new Promise<void>((resolve, reject) => {
      publisher.publish(topic, payload, { qos: 1 }, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

  const publishUntil = async (
    topic: string,
    payload: string,
    wasHandled: () => boolean,
  ) => {
    const deadline = Date.now() + 5_000;

    while (Date.now() < deadline) {
      await publish(topic, payload);

      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (wasHandled()) {
          return;
        }

        await delay(25);
      }
    }

    throw new Error(
      `The plugin did not handle an MQTT message on ${topic}.`,
    );
  };

  const waitForPublisherConnection = () =>
    new Promise<void>((resolve, reject) => {
      if (publisher.connected) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `MQTT broker is not available at ${BROKER_URL}. Start Mosquitto before running this test.`,
          ),
        );
      }, 5_000);

      const cleanup = () => {
        clearTimeout(timeout);
        publisher.off('connect', handleConnect);
        publisher.off('error', handleError);
      };

      const handleConnect = () => {
        cleanup();
        resolve();
      };

      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };

      publisher.once('connect', handleConnect);
      publisher.once('error', handleError);
    });

  const closeClient = (client: MqttClient) =>
    new Promise<void>((resolve) => {
      if (!client.connected) {
        client.end(true);
        resolve();
        return;
      }

      client.end(false, {}, () => resolve());
    });

  beforeAll(async () => {
    findByDeviceId = jest.fn(async (deviceId: string) => {
      if (deviceId === UNKNOWN_DEVICE_ID) {
        return null;
      }

      return {
        id: `database-${deviceId}`,
        serialNumber: deviceId,
        status: 'ONLINE',
      };
    });

    onTelemetry = jest.fn(async () => undefined);

    plugin = new MqttDevicePlugin(
      BROKER_URL,
      findByDeviceId,
      onTelemetry,
    );
    plugin.connect();

    publisher = mqtt.connect(BROKER_URL, {
      clientId: `server-plugin-e2e-publisher-${RUN_ID}`,
      connectTimeout: 3_000,
      reconnectPeriod: 0,
    });

    await waitForPublisherConnection();

    const probeTelemetry = {
      deviceId: PROBE_DEVICE_ID,
      timestamp: new Date().toISOString(),
      data: { probe: true },
    };

    await publishUntil(
      topicFor(PROBE_DEVICE_ID),
      JSON.stringify(probeTelemetry),
      () => onTelemetry.mock.calls.length > 0,
    );

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    plugin.disconnect();
    await closeClient(publisher);
  });

  it('forwards telemetry received from a registered device', async () => {
    const telemetry = {
      deviceId: KNOWN_DEVICE_ID,
      timestamp: new Date().toISOString(),
      data: {
        temperature: 23.5,
        pressure: 1.2,
      },
    };

    await publishUntil(
      topicFor(KNOWN_DEVICE_ID),
      JSON.stringify(telemetry),
      () => onTelemetry.mock.calls.length > 0,
    );

    expect(findByDeviceId).toHaveBeenCalledWith(
      KNOWN_DEVICE_ID,
    );
    expect(onTelemetry).toHaveBeenCalledWith(telemetry);
  });

  it('ignores telemetry received from an unknown device', async () => {
    const telemetry = {
      deviceId: UNKNOWN_DEVICE_ID,
      timestamp: new Date().toISOString(),
      data: { temperature: 99 },
    };

    await publishUntil(
      topicFor(UNKNOWN_DEVICE_ID),
      JSON.stringify(telemetry),
      () =>
        findByDeviceId.mock.calls.some(
          ([deviceId]) => deviceId === UNKNOWN_DEVICE_ID,
        ),
    );

    expect(findByDeviceId).toHaveBeenCalledWith(
      UNKNOWN_DEVICE_ID,
    );
    expect(onTelemetry).not.toHaveBeenCalled();
  });

  it('handles malformed JSON without forwarding telemetry', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await publishUntil(
      topicFor(KNOWN_DEVICE_ID),
      '{"deviceId":',
      () =>
        consoleError.mock.calls.some(([message]) =>
          String(message).includes('Invalid JSON payload'),
        ),
    );

    expect(findByDeviceId).not.toHaveBeenCalled();
    expect(onTelemetry).not.toHaveBeenCalled();
  });
});
