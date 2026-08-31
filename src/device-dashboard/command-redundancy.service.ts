import { Injectable } from '@nestjs/common';
import type {
  CommandExecutionResult,
  DeviceCommandResponse,
  RegisteredDevice,
} from '../device-registry.interface';
import { PluginLogger } from './plugin-logger';

type LatestTelemetry = {
  data: any;
  timestamp?: string | Date;
} | null;

@Injectable()
export class CommandRedundancyService {
  private readonly logger = new PluginLogger(
    CommandRedundancyService.name,
  );
  private readonly confirmedCommandState = new Map<
    string,
    { value: unknown; observedAt: string; maxAgeMs: number }
  >();

  getResult(
    device: RegisteredDevice,
    latest: LatestTelemetry,
    command: string,
    payload: any,
  ): CommandExecutionResult | null {
    if (command === 'SET_STATE') {
      if (
        device.telemetryStateUpdatedAt &&
        device.telemetryState === payload.state &&
        this.isFresh(device.telemetryStateUpdatedAt, 15_000)
      ) {
        return {
          status: 'NOOP',
          reason: 'ALREADY_APPLIED',
          observedAt: new Date(
            device.telemetryStateUpdatedAt as any,
          ).toISOString(),
        };
      }

      return null;
    }

    const commandDefinition = device.schema?.commands?.[command];

    if (!commandDefinition) {
      return null;
    }

    const idempotency = commandDefinition['x-idempotency'];
    let stateBinding = idempotency?.stateBinding;
    const payloadPath =
      idempotency?.payloadPath ?? commandDefinition['x-payload-field'];
    const maxAgeMs = idempotency?.maxAgeMs ?? 15_000;
    const epsilon = idempotency?.epsilon;

    if (!stateBinding && commandDefinition['x-state-path']) {
      stateBinding = this.findTelemetryField(
        device.mapping,
        commandDefinition['x-state-path'],
      );
    }

    if (!stateBinding || !payloadPath) {
      return null;
    }

    const requestedValue = this.getValueByPath(payload, payloadPath);

    if (requestedValue === undefined) {
      return null;
    }

    const confirmedKey = `${device.serialNumber ?? device.id}:${stateBinding}`;
    const confirmedState = this.confirmedCommandState.get(confirmedKey);

    if (confirmedState) {
      if (
        this.isFresh(confirmedState.observedAt, confirmedState.maxAgeMs) &&
        this.valuesEqual(confirmedState.value, requestedValue, epsilon)
      ) {
        return {
          status: 'NOOP',
          reason: 'ALREADY_APPLIED',
          observedAt: confirmedState.observedAt,
        };
      }

      if (!this.isFresh(confirmedState.observedAt, confirmedState.maxAgeMs)) {
        this.confirmedCommandState.delete(confirmedKey);
      }
    }

    if (!latest?.data) {
      return null;
    }

    const latestValue = this.getLatestValue(latest.data, stateBinding);
    const observedAt = latestValue?.observedAt ?? latest.timestamp;

    if (!latestValue || !this.isFresh(observedAt, maxAgeMs)) {
      return null;
    }

    this.logger.debug(
      `[REDUNDANCY] command=${command} current=${latestValue.value} requested=${requestedValue}`,
    );

    if (!this.valuesEqual(latestValue.value, requestedValue, epsilon)) {
      return null;
    }

    this.logger.warn(`[REDUNDANT] ${command} ignored`);

    return {
      status: 'NOOP',
      reason: 'ALREADY_APPLIED',
      ...(observedAt
        ? { observedAt: new Date(observedAt as any).toISOString() }
        : {}),
    };
  }

  rememberConfirmedState(
    device: RegisteredDevice,
    command: string,
    payload: any,
    response?: DeviceCommandResponse,
  ): void {
    if (!response?.success) {
      return;
    }

    const idempotency =
      device.schema?.commands?.[command]?.['x-idempotency'];
    const stateBinding = idempotency?.stateBinding;
    const payloadPath = idempotency?.payloadPath;

    if (!stateBinding || !payloadPath) {
      return;
    }

    const value = this.getValueByPath(payload, payloadPath);

    if (value === undefined) {
      return;
    }

    this.confirmedCommandState.set(
      `${device.serialNumber ?? device.id}:${stateBinding}`,
      {
        value,
        observedAt: response.timestamp ?? new Date().toISOString(),
        maxAgeMs: idempotency.maxAgeMs ?? 15_000,
      },
    );
  }

  clearDevice(deviceId: string): void {
    const prefix = `${deviceId}:`;

    for (const key of this.confirmedCommandState.keys()) {
      if (key.startsWith(prefix)) {
        this.confirmedCommandState.delete(key);
      }
    }
  }

  isFresh(observedAt: unknown, maxAgeMs: number): boolean {
    const timestamp = new Date(observedAt as any).getTime();
    const age = Date.now() - timestamp;

    return Number.isFinite(timestamp) && age >= 0 && age <= maxAgeMs;
  }

  private findTelemetryField(mapping: any, statePath: string): string | null {
    for (const [field, config] of Object.entries<any>(
      mapping?.fields ?? {},
    )) {
      if (config.path === statePath) {
        return field;
      }
    }

    return null;
  }

  private getLatestValue(
    latestData: any,
    field: string,
  ): { value: unknown; observedAt?: string } | null {
    const history = latestData?.[field];

    if (!Array.isArray(history) || history.length === 0) {
      return null;
    }

    const latest = history[history.length - 1];

    if (Array.isArray(latest)) {
      return {
        value: latest[0],
        observedAt: typeof latest[1] === 'string' ? latest[1] : undefined,
      };
    }

    if (
      latest &&
      typeof latest === 'object' &&
      Object.prototype.hasOwnProperty.call(latest, 'value')
    ) {
      return {
        value: latest.value,
        observedAt:
          typeof latest.timestamp === 'string'
            ? latest.timestamp
            : undefined,
      };
    }

    return { value: latest };
  }

  private getValueByPath(value: unknown, dottedPath: string): unknown {
    if (!value || typeof value !== 'object' || !dottedPath.trim()) {
      return undefined;
    }

    let current: any = value;

    for (const segment of dottedPath.split('.').filter(Boolean)) {
      if (
        segment === '__proto__' ||
        segment === 'prototype' ||
        segment === 'constructor' ||
        current === null ||
        current === undefined
      ) {
        return undefined;
      }

      current = current[segment];
    }

    return current;
  }

  private valuesEqual(
    currentValue: unknown,
    requestedValue: unknown,
    epsilon?: number,
  ): boolean {
    if (
      typeof currentValue === 'number' &&
      typeof requestedValue === 'number' &&
      typeof epsilon === 'number'
    ) {
      return Math.abs(currentValue - requestedValue) <= epsilon;
    }

    return Object.is(currentValue, requestedValue);
  }
}
