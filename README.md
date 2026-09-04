# Server-Side IoT Plugin

This reusable NestJS module validates, normalizes, and processes data from
different IoT device models. Device-specific behavior belongs to JSON Schema
and mapping documents, while the plugin remains independent of the host
application's database and MQTT or CoAP implementation.

## Responsibilities

- load device profiles through host-provided callbacks;
- cache device profiles temporarily in Redis;
- validate device identity, status, model, and version;
- validate telemetry with Ajv and JSON Schema 2020;
- validate complete device attribute snapshots separately from telemetry;
- normalize telemetry through mapping paths;
- process `array`, `min`, and `max` operations and historical samples;
- return processed data through host callbacks;
- validate commands and command payloads against the active model;
- serialize commands per device and reject redundant state changes;
- propagate the host correlation ID to the transport boundary;
- validate schema, mapping, and dashboard compatibility during model upload.

## Installation and build

```bash
npm install
npm run build
```

The backend consumes the package as a local dependency:

```json
{
  "dependencies": {
    "serverplugin": "file:../plugin"
  }
}
```

Rebuild the plugin after changing its source, then refresh the backend's local
dependency when necessary.

## NestJS host integration

The host registers the plugin asynchronously and supplies its concrete
database, cache, telemetry, status, and command operations:

```ts
import { DeviceDashboardModule } from 'serverplugin';

DeviceDashboardModule.registerAsync({
  imports: [DeviceModule],
  inject: [DeviceService, DeviceTelemetryService, MqttTransportService],
  useFactory: (devices, telemetry, transport) => ({
    findDeviceById: (deviceId) => devices.findPluginDevice(deviceId),
    onTelemetry: (message) => telemetry.save(message),
    onAttributes: (deviceId, attributes) =>
      devices.updateAttributes(deviceId, attributes),
    onStatusChange: (deviceId, status, context) =>
      devices.updateStatus(deviceId, status, context),
    sendCommand: (deviceId, command, payload, context) =>
      transport.sendCommand(deviceId, command, payload, context),
    getLatestTelemetry: (deviceId) =>
      telemetry.getLatestTelemetry(deviceId),
    redis: redisClient,
  }),
});
```

These callbacks are the boundary between generic plugin logic and the host's
database, transport, and domain services.

The optional status callback context can contain `{ heartbeat: true }`. A
heartbeat refreshes device presence without clearing confirmed command state.
A real `online` or `offline` lifecycle transition invalidates the redundancy
cache.

## Registered device contract

`findDeviceById` returns a profile with the following shape:

```ts
type RegisteredDevice = {
  id: string;
  serialNumber: string;
  name?: string | null;
  type?: string | null;
  model?: string | null;
  version?: string | null;
  schema?: unknown;
  mapping?: unknown;
  status?: unknown;
};
```

Model, version, schema, and mapping are required for processing. Devices in
`OFFLINE` or `UNINITIALIZED` state cannot execute commands.

## JSON Schema metadata

The plugin supports standard JSON Schema rules and these project-specific
metadata fields:

- `properties.schemaId.const` identifies the device model;
- `x-reporting` defines reporting intervals by telemetry state;
- `x-buffering.interval` defines historical sample grouping;
- `commands` defines allowed commands and payload schemas;
- `properties.attributes` defines static device attributes.

Command example:

```json
{
  "commands": {
    "SET_FLOW_TARGET": {
      "payload": {
        "type": "object",
        "required": ["target"],
        "properties": {
          "target": {
            "type": "number",
            "minimum": 0,
            "maximum": 500
          }
        }
      }
    }
  }
}
```

## Mapping and normalization

```json
{
  "fields": {
    "flowRate": {
      "path": "metrics.flowRate",
      "historyPath": "historicalTelemetry.flowRate",
      "operation": "min"
    }
  }
}
```

`path` selects the current value. `historyPath` selects buffered historical
samples. For partial telemetry, the plugin keeps the known aggregate state and
adds new samples in the normalized format expected by the host.

Paths containing `prototype`, `constructor`, or `__proto__` are rejected.

## Attributes

An attribute message is a complete snapshot validated against
`schema.properties.attributes`. The plugin also verifies that its
`serialNumber` matches the device identity supplied by the transport context.
Only then does it call `onAttributes(deviceId, attributes)`.

Attributes do not need a separate schema or mapping file. The attribute
subschema belongs to the same model version, and `attributes.*` mapping paths
may expose those values to the dashboard.

## Command redundancy

`DeviceCommandService` places each device's command work in a per-device queue.
This prevents two concurrent requests for the same device from both passing the
redundancy check before either response is confirmed.

Within that queue the service:

1. loads and validates the active device profile;
2. verifies that the command exists in `schema.commands`;
3. validates the payload against the command payload schema;
4. asks `CommandRedundancyService` whether the requested state already matches
   the latest confirmed state or fresh telemetry;
5. returns `NOOP` when sending is unnecessary;
6. otherwise calls the host's `sendCommand` callback;
7. remembers the new state only after a successful device response.

The plugin does not write command audit records itself. The backend owns the
audit transaction and passes its correlation ID through the plugin.

## Dashboard definition validation

`validateModelDefinition(schema, mapping)` checks:

- at least one dashboard section;
- unique section and item identifiers;
- positive `columns` and valid `colSpan` values;
- `bind` and `visibleWhen.bind` references in `mapping.fields`;
- commands declared by `schema.commands`;
- `commandField` references in command payload properties;
- numeric `min`, `max`, and `step` constraints;
- mapping paths against the JSON Schema document.

A component type may be built in or host-defined. Server validation checks the
shared structural contract. The client renderer registry checks whether an
actual renderer exists for the requested type.

## Error handling

Typed plugin exceptions cover these cases:

- missing, offline, or uninitialized device;
- missing schema, mapping, or version;
- mismatch between `schemaId` and assigned model;
- schema compilation or payload validation failure;
- normalization failure;
- failure in a host callback or persistence operation;
- unknown command or invalid command payload.

The host converts these exceptions to the appropriate HTTP or transport
response.

## Public API

`src/index.ts` exports:

- `DeviceDashboardModule` and `DeviceDashboardService`;
- `MqttDevicePlugin`;
- registry, telemetry, attribute, and command context types;
- `validateModelDefinition`;
- plugin exception classes and error codes.

## Tests

All unit and integration tests:

```bash
npm test
```

Focused model-definition validator suite:

```bash
npm test -- --runTestsByPath src/tests/model-definition.validator.spec.ts
```

MQTT E2E tests require Mosquitto on `localhost:1883`:

```bash
npm run test:e2e -- --runTestsByPath test/device-plugin.e2e-spec.ts
```

The E2E scenario uses a real MQTT broker and the plugin's real message handling.
Host callbacks are controlled test functions, and no PostgreSQL database is
used. It verifies known-device telemetry, unknown-device rejection, and safe
handling of malformed JSON.

Build the package and TypeScript declarations:

```bash
npm run build
```

## Directory structure

```text
src/device-dashboard/device-dashboard.service.ts   public plugin facade
src/device-dashboard/device-profile.service.ts     profile loading and Redis cache
src/device-dashboard/device-ingestion.service.ts   telemetry, attributes, and status
src/device-dashboard/device-command.service.ts     queue, validation, and dispatch
src/device-dashboard/command-redundancy.service.ts idempotency and NOOP decisions
src/model-definition/                              schema, mapping, and dashboard checks
src/mapping-normalizer.ts                          telemetry normalization
src/newvalidator.ts                                Ajv telemetry, attribute, and command validation
src/exceptions/                                    typed error classes
src/tests/                                         unit and integration tests
test/                                              MQTT E2E tests
```
