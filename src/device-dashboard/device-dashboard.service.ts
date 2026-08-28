import fs from "fs";
import path from "path";

import { Inject, Injectable, Logger, NotFoundException, ForbiddenException, HttpException} from "@nestjs/common";
import {
  DEVICE_DASHBOARD_OPTIONS,
  type CommandExecutionResult,
  type CommandDispatchContext,
  type DeviceAttributes,
  type DeviceCommandResponse,
  type DeviceDashboardModuleOptions,
  type DeviceTelemetry,
} from "../device-registry.interface";

import {
  validateAttributesPayload,
  validateTelemetryPayload,
  validateDeviceCommand,
} from "../newvalidator";

import { LazyModuleLoader } from "@nestjs/core";
import { normalizeWithMapping } from "../mapping-normalizer";
import { MappingDefinition } from "../mapping-normalizer";
import { PluginErrorCode } from "../device-registry.interface";
import {
  DeviceNotFoundException,
  DeviceOfflineException,
  DeviceUninitializedException,
  ConfigMissingException,
  ConfigMismatchException,
  NormalizationFailedException,
  HookFailedException,
  InvalidTimestampException,
  SchemaCompileException,
  DeviceSchemaMissingException, 
  DatabaseFailureException, 
  CommandValidationException
} from '../exceptions/plugin.exceptions';

export type TelemetryContext = {
  deviceId: string;
  topic?: string;
  transport?: "mqtt" | "http" | "coap" | string;
};

export type DeviceStatus = {
  deviceId?: string;
  timestamp?: string;
  status: string;
};

class PluginLogger extends Logger {
  override debug(message: string) {
    if (process.env.LOG_LEVEL === 'debug') {
      super.debug(message);
    }
  }
}

@Injectable()
export class DeviceDashboardService  {
  constructor(
    @Inject(DEVICE_DASHBOARD_OPTIONS)
    private readonly options: DeviceDashboardModuleOptions,
  ) {
  //  this.startOfflineMonitor();
  }
  
  private readonly logger = new PluginLogger(DeviceDashboardService.name);
  private readonly DEVICE_TTL = 60 * 1000;
  private readonly CACHE_TTL = 60;
  private readonly confirmedCommandState = new Map<
    string,
    { value: unknown; observedAt: string; maxAgeMs: number }
  >();

  private validateDevice(device: any, deviceId: string) {
    if (!device) {
      throw new DeviceNotFoundException(deviceId);
    }

    if (device.status === "OFFLINE") {
      throw new DeviceOfflineException(deviceId);
    }

    if (device.status === "UNINITIALIZED") {
      throw new DeviceUninitializedException(deviceId);
    }
  }

  private async loadDevice(deviceId: string) {
    let device;
    const redisClient = this.options.redis;

    if (redisClient) {
      try { 
        const cachedData = await redisClient.get( `cache:device:${deviceId}`);

        if (cachedData) {
            this.logger.debug(`[REDIS CACHE] HIT -> Device ${deviceId} profile loaded from Redis RAM.`);
            device = JSON.parse(cachedData);
        }
      } catch (err: any) {
        this.logger.error(`[REDIS CACHE] Error reading from Redis: ${err.message}`);
      }
    }

    if (!device) {
      this.logger.debug(`[REDIS CACHE] MISS -> Fetching device ${deviceId} from database.` );
      try {
        device = await this.options.findDeviceById(deviceId);
      } catch (err: any) {
        this.logger.error(`[DATABASE] Failed loading device ${deviceId}: ${err.message}`);
        throw new DatabaseFailureException(err.message);
      }
      if (device && redisClient) {
        try {
          this.logger.log(`[REDIS CACHE] Saving device ${deviceId} to Redis for ${this.CACHE_TTL}s.`);
          await redisClient.set(`cache:device:${deviceId}`, JSON.stringify(device), 'EX', this.CACHE_TTL );
        } catch (err: any) {
          this.logger.error(`[REDIS CACHE] Error saving to Redis: ${err.message}` );
        }
      }
    }
    return device;
  }

  private validateDeviceConfiguration(device: any, deviceId:string) {
    if (!device.mapping) {
      this.logger.warn(`[DENIED] Missing mapping definitions for version: ${device.model}`);
      throw new ConfigMissingException();
    }

    if (!device.schema){
      this.logger.warn(`[DENIED] Missing JSON schema for version: ${device.model}`);
      throw new ConfigMissingException();
    }
    
    if (!device.version) {
      this.logger.warn(`[DENIED] Missing model version for device ${deviceId}` );
      throw new ConfigMissingException();
    }

    if (device.schema.properties?.schemaId?.const !==  device.model) {
      this.logger.error( `[CONFIG MISMATCH] Device ${deviceId} is assigned to model '${device.model}', ` +  `but its schema expects '${device.schema.properties?.schemaId?.const}'.`);
      throw new ConfigMismatchException();
    }
  }

  private validateSchema(device: any, message: unknown) {
    const cacheKey = `${device.model}:${device.version}`;

    return validateTelemetryPayload(
      device.model,
      cacheKey,
      device.schema,
      message
    );
  }

  private async forwardTelemetry( telemetry: DeviceTelemetry, deviceId: string) {
    try {
      await this.options.onTelemetry?.(telemetry);
    } catch (err: any) {
      this.logger.error(`[HOOK] onTelemetry failed for ${deviceId}: ${err.message}`);

      if (
        err instanceof NotFoundException ||
        err instanceof ForbiddenException ||
        err instanceof InvalidTimestampException
      ) {
        throw err;
      }
      throw new HookFailedException();
    }
  }

  private async forwardAttributes(
    deviceId: string,
    attributes: DeviceAttributes,
  ) {
    if (!this.options.onAttributes) {
      this.logger.error(
        `[HOOK] onAttributes is not configured for device ${deviceId}`,
      );
      throw new HookFailedException();
    }

    try {
      await this.options.onAttributes(deviceId, attributes);
    } catch (err: any) {
      this.logger.error(
        `[HOOK] onAttributes failed for ${deviceId}: ${err.message}`,
      );
      throw new HookFailedException();
    }
  }

  private normalizeTelemetry(  message: unknown, deviceId: string, mapping: MappingDefinition) {
    try {
      const telemetry = normalizeWithMapping( message, deviceId, mapping);

      if (!telemetry) {
        throw new NormalizationFailedException();
      }
      return telemetry;
    } catch (err: any) {
      this.logger.error(`[NORMALIZATION] Mapping normalization failed for ${deviceId}: ${err.message}`);
      throw new NormalizationFailedException();
    }
  }

  private findTelemetryField(mapping: any, statePath: string): string | null {
    for (const [field, config] of Object.entries<any>(mapping?.fields ?? {})) {
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
        observedAt:
          typeof latest[1] === 'string' ? latest[1] : undefined,
      };
    }

    if (
      latest &&
      typeof latest === 'object' &&
      Object.prototype.hasOwnProperty.call(latest, 'value')
    ) {
      return {
        value: (latest as any).value,
        observedAt:
          typeof (latest as any).timestamp === 'string'
            ? (latest as any).timestamp
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

  private isFresh(observedAt: unknown, maxAgeMs: number): boolean {
    const timestamp = new Date(observedAt as any).getTime();

    return (
      Number.isFinite(timestamp) &&
      Date.now() - timestamp >= 0 &&
      Date.now() - timestamp <= maxAgeMs
    );
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

  private getRedundancyResult(
    device: any,
    latest: { data: any; timestamp?: string | Date } | null,
    command: string,
    payload: any,
  ): CommandExecutionResult | null {
    if (command === "SET_STATE") {
      const currentState = device.telemetryState;
      const requestedState = payload.state;

      if (
        device.telemetryStateUpdatedAt &&
        currentState === requestedState &&
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

    const commandDef = device.schema?.commands?.[command];

    if (!commandDef) {
      return null;
    }

    const idempotency = commandDef['x-idempotency'];
    let stateBinding = idempotency?.stateBinding;
    const payloadPath =
      idempotency?.payloadPath ?? commandDef['x-payload-field'];
    const maxAgeMs = idempotency?.maxAgeMs ?? 15_000;
    const epsilon = idempotency?.epsilon;

    if (!stateBinding && commandDef['x-state-path']) {
      stateBinding = this.findTelemetryField(
        device.mapping,
        commandDef['x-state-path'],
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
        this.isFresh(
          confirmedState.observedAt,
          confirmedState.maxAgeMs,
        ) &&
        this.valuesEqual(
          confirmedState.value,
          requestedValue,
          epsilon,
        )
      ) {
        return {
          status: 'NOOP',
          reason: 'ALREADY_APPLIED',
          observedAt: confirmedState.observedAt,
        };
      }

      if (
        !this.isFresh(
          confirmedState.observedAt,
          confirmedState.maxAgeMs,
        )
      ) {
        this.confirmedCommandState.delete(confirmedKey);
      }
    }

    if (!latest?.data) {
      return null;
    }

    const latestValue = this.getLatestValue(
      latest.data,
      stateBinding,
    );
    const observedAt = latestValue?.observedAt ?? latest.timestamp;

    if (
      !latestValue ||
      requestedValue === undefined ||
      !this.isFresh(observedAt, maxAgeMs)
    ) {
      return null;
    }

    this.logger.debug(
      `[REDUNDANCY] command=${command} current=${latestValue.value} requested=${requestedValue}`,
    );

    if (
      this.valuesEqual(
        latestValue.value,
        requestedValue,
        epsilon,
      )
    ) {
      this.logger.warn(`[REDUNDANT] ${command} ignored`);
      return {
        status: 'NOOP',
        reason: 'ALREADY_APPLIED',
        ...(observedAt
          ? { observedAt: new Date(observedAt as any).toISOString() }
          : {}),
      };
    }

    return null;
  }

  private rememberConfirmedCommandState(
    device: any,
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

  private clearConfirmedCommandState(deviceId: string): void {
    const prefix = `${deviceId}:`;

    for (const key of this.confirmedCommandState.keys()) {
      if (key.startsWith(prefix)) {
        this.confirmedCommandState.delete(key);
      }
    }
  }
  
  async processTelemetry( message: unknown, context: TelemetryContext): Promise<{ approved: boolean; reason?: string }> {

    if ( typeof message !== "object" || message === null ||  Array.isArray(message)) {
      return {
        approved: false,
        reason: "INVALID_PAYLOAD_FORMAT",
      };
    }

    const deviceId = context.deviceId;
    this.logger.debug(`[START] Received telemetry for device : ${deviceId || "UNKNOWN"}`);
    
    if (!deviceId) {
      return { approved: false, reason: "MISSING_DEVICE_IDENTIFIER"};
    }

    try {
      const device = await this.loadDevice(deviceId);

      if (!device) {
        return { approved: false, reason: "DEVICE_NOT_FOUND"};
      }

      if (!device.model) {
        this.logger.warn(`[DENIED] Device ${deviceId} has no assigned model version.`);
        return { approved: false, reason: "MISSING_MODEL_VERSION"};
      }

      this.validateDeviceConfiguration(device, deviceId);
      this.logger.debug(`[VALIDATION] Running AJV structure check for model version: ${device.model}:${device.version}`);

      const validation = this.validateSchema( device, message);

      if (!validation.valid) {
        this.logger.warn(`[DENIED] Payload for device ${deviceId} failed JSON schema validation.`);
        this.logger.warn(`[VALIDATION ERRORS]: ${JSON.stringify(validation.errors)}`);
        return {approved: false, reason: "INVALID_TELEMETRY_SCHEMA"};
      }
      
      this.logger.log(`[VALIDATION] Success! Payload structure is valid.`);
      this.logger.debug(`[NORMALIZATION] Transforming device data using defined mapping rules.`);

      const telemetry = this.normalizeTelemetry( message, deviceId, device.mapping );
      this.logger.debug(`[NORMALIZATION] Transformation result: ${JSON.stringify(telemetry.data)}`);

      this.logger.debug(`[SUCCESS] Forwarding normalized data to host application via onTelemetry hook...`);
      await this.forwardTelemetry( telemetry, deviceId);
      return {
        approved: true,
      };
    } catch (error: any) {
      this.logger.error(`[ERROR] processTelemetry failed for device ${deviceId}: ${error.message}`);

      if (error instanceof DeviceNotFoundException) {
        this.logger.warn(`[NOT_FOUND] Device ${deviceId} does not exist.`);
        return { approved: false, reason: "DEVICE_NOT_FOUND" };
      }

      if (error instanceof DeviceOfflineException) {
        this.logger.warn(`[OFFLINE] Device ${deviceId} is offline.`);
        return { approved: false, reason: "DEVICE_OFFLINE" };
      }

      if (error instanceof DeviceUninitializedException) {
        this.logger.warn(`[UNINITIALIZED] Device ${deviceId} is not initialized.`);
        return { approved: false, reason: "DEVICE_UNINITIALIZED" };
      }

      if (error instanceof ConfigMissingException) {
        this.logger.warn(`[CONFIG] Device ${deviceId} is missing configuration.`);
        return { approved: false, reason: "CONFIG_MISSING" };
      }

      if (error instanceof ConfigMismatchException) {
        this.logger.warn(`[CONFIG] Device ${deviceId} has config mismatch.`);
        return { approved: false, reason: "CONFIG_MISMATCH" };
      }

      if (error instanceof NormalizationFailedException) {
        this.logger.warn(`[NORMALIZATION] Device ${deviceId} normalization failed.`);
        return { approved: false, reason: "NORMALIZATION_FAILED" };
      }

      if (error instanceof InvalidTimestampException) {
        this.logger.warn(`[TIMESTAMP] Device ${deviceId} sent invalid timestamp.`);
        throw error;
      }

      if (error instanceof SchemaCompileException) {
        this.logger.error(`[SCHEMA] Device ${deviceId} schema compilation failed.`);
        return { approved: false, reason: "SCHEMA_COMPILE_ERROR" };
      }

      if (error instanceof DatabaseFailureException) {
        this.logger.error(`[DATABASE] Database failure for device ${deviceId}.`);
        return { approved: false, reason: "DATABASE_FAILURE" };
      }

      if (error instanceof HookFailedException) {
        this.logger.error(`[HOOK] onTelemetry hook failed for device ${deviceId}.`);
        return { approved: false, reason: "HOOK_FAILED" };
      }

      this.logger.error(`[UNHANDLED] Unexpected error for device ${deviceId}: ${error.message}`);
      return { approved: false, reason: "INTERNAL_ERROR" };
    }
  }

  async processAttributes(
    message: unknown,
    context: TelemetryContext,
  ): Promise<{ approved: boolean; reason?: string }> {
    const attributes = this.asRecord(message);

    if (!attributes) {
      return { approved: false, reason: 'INVALID_ATTRIBUTES_FORMAT' };
    }

    const deviceId = context.deviceId?.trim();

    if (!deviceId) {
      return { approved: false, reason: 'MISSING_DEVICE_IDENTIFIER' };
    }

    try {
      const device = await this.loadDevice(deviceId);

      if (!device) {
        return { approved: false, reason: 'DEVICE_NOT_FOUND' };
      }

      if (!device.model) {
        return { approved: false, reason: 'MISSING_MODEL_VERSION' };
      }

      this.validateDeviceConfiguration(device, deviceId);

      const attributesSchema =
        device.schema?.properties?.attributes;

      if (!this.asRecord(attributesSchema)) {
        return { approved: false, reason: 'ATTRIBUTES_SCHEMA_MISSING' };
      }

      const validation = validateAttributesPayload(
        `${device.model}:${device.version}`,
        attributesSchema,
        attributes,
      );

      if (!validation.valid) {
        this.logger.warn(
          `[ATTRIBUTES] Invalid payload for ${deviceId}: ${JSON.stringify(validation.errors)}`,
        );
        return { approved: false, reason: 'INVALID_ATTRIBUTES_SCHEMA' };
      }

      if (
        attributes.serialNumber !== deviceId ||
        attributes.serialNumber !== device.serialNumber
      ) {
        this.logger.warn(
          `[ATTRIBUTES] Serial number mismatch for topic device ${deviceId}`,
        );
        return { approved: false, reason: 'ATTRIBUTES_ID_MISMATCH' };
      }

      const attributeFields = Object.fromEntries(
        Object.entries<any>(device.mapping?.fields ?? {}).filter(
          ([, definition]) =>
            typeof definition?.path === 'string' &&
            definition.path.startsWith('attributes.'),
        ),
      );

      if (Object.keys(attributeFields).length === 0) {
        return { approved: false, reason: 'ATTRIBUTES_MAPPING_MISSING' };
      }

      const normalized = this.normalizeTelemetry(
        { attributes },
        deviceId,
        { fields: attributeFields },
      );

      if (Object.keys(normalized.data).length === 0) {
        return { approved: false, reason: 'NORMALIZATION_FAILED' };
      }

      await this.forwardAttributes(deviceId, normalized.data);

      return { approved: true };
    } catch (error: any) {
      this.logger.error(
        `[ATTRIBUTES] Processing failed for ${deviceId}: ${error.message}`,
      );

      if (error instanceof ConfigMissingException) {
        return { approved: false, reason: 'CONFIG_MISSING' };
      }

      if (error instanceof ConfigMismatchException) {
        return { approved: false, reason: 'CONFIG_MISMATCH' };
      }

      if (error instanceof SchemaCompileException) {
        return { approved: false, reason: 'SCHEMA_COMPILE_ERROR' };
      }

      if (error instanceof DatabaseFailureException) {
        return { approved: false, reason: 'DATABASE_FAILURE' };
      }

      if (error instanceof NormalizationFailedException) {
        return { approved: false, reason: 'NORMALIZATION_FAILED' };
      }

      if (error instanceof HookFailedException) {
        return { approved: false, reason: 'HOOK_FAILED' };
      }

      return { approved: false, reason: 'INTERNAL_ERROR' };
    }
  }

  async processStatus(statusPayload: unknown, context: TelemetryContext): Promise<void> {
    const deviceId = context.deviceId;

    if (!deviceId) {
     this.logger.warn("[STATUS] Device status rejected. Missing deviceId.");
      return;
    }

    const statusObject = this.asRecord(statusPayload);

    if (!statusObject) {
      this.logger.warn(`[STATUS] Device ${deviceId} sent an invalid status object.`);
      return;
    }

    const status = String(statusObject.status ?? "unknown");
    const timestamp =
      typeof statusObject.timestamp === "string"
        ? statusObject.timestamp
        : new Date().toISOString();
    
    const normalizedStatus=status.toUpperCase();
    this.clearConfirmedCommandState(deviceId);

    this.logger.log(`[STATUS LOG] Device: ${deviceId} changed state -> ${status.toUpperCase()}`);

    if (this.options.onStatusChange) {
      try {
        await this.options.onStatusChange(deviceId, normalizedStatus);
        this.logger.debug(`[STATUS] Status hook successfully executed for device: ${deviceId}`);
      } catch (err: any) {
        this.logger.error(`[STATUS] Error executing status hook: ${err.message}`);

        if (err instanceof NotFoundException || err instanceof ForbiddenException) {
          throw err;
        }
        throw new HookFailedException();
      }
    }
  }

  private readonly commandQueue = new Map<string, Promise<void>>();

  private async serializeDeviceCommand<T>(
    deviceId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous =
      this.commandQueue.get(deviceId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queueTail = previous
      .catch(() => undefined)
      .then(() => gate);

    this.commandQueue.set(deviceId, queueTail);
    await previous.catch(() => undefined);

    try {
      return await action();
    } finally {
      release();

      if (this.commandQueue.get(deviceId) === queueTail) {
        this.commandQueue.delete(deviceId);
      }
    }
  }

  private async dispatchCommand(
    deviceId: string,
    command: string,
    payload: any,
    context?: CommandDispatchContext,
  ): Promise<DeviceCommandResponse | void> {
    if (context?.correlationId) {
      return this.options.sendCommand(
        deviceId,
        command,
        payload,
        context,
      );
    }

    return this.options.sendCommand(deviceId, command, payload);
  }
  
  async triggerDeviceTelemetry(
    deviceId: string,
    state: 'ACTIVE' | 'IDLE',
    context?: CommandDispatchContext,
  ): Promise<CommandExecutionResult> {

    this.logger.warn(
        `[TRIGGER] device=${deviceId} requestedState=${state}`
      );

    try{

      const device = await this.options.findDeviceById(deviceId);
      
      if (!device) {
        this.logger.error(`[ORCHESTRATION] Device ${deviceId} not found.`);
        throw new DeviceNotFoundException(deviceId);
      }
    
      this.validateDevice(device, deviceId);
      if (
        device.telemetryStateUpdatedAt &&
        device.telemetryState === state &&
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
      const supportsSetMode = !!device.schema?.commands?.SET_MODE;

      this.logger.log(`[CONTROL] Sending state change to ${state} for device ${deviceId}`);
      if (state === 'ACTIVE') {
        if(supportsSetMode){
          const modeResponse = await this.dispatchCommand(
            deviceId,
            'SET_MODE',
            { value: 'RUNNING' },
            context,
          );

          if (modeResponse && !modeResponse.success) {
            throw new Error(
              modeResponse.error ?? 'DEVICE_REJECTED_SET_MODE',
            );
          }

          await new Promise(resolve => setTimeout(resolve, 500));
        }
        const response = await this.dispatchCommand(
          deviceId,
          'SET_STATE',
          { state: 'ACTIVE' },
          context,
        );

        if (response && !response.success) {
          throw new Error(response.error ?? 'DEVICE_REJECTED_COMMAND');
        }

        return { status: 'DISPATCHED', response: response ?? undefined };
      } else {
        const response = await this.dispatchCommand(
          deviceId,
          'SET_STATE',
          { state: 'IDLE' },
          context,
        );

        if (response && !response.success) {
          throw new Error(response.error ?? 'DEVICE_REJECTED_COMMAND');
        }

        return { status: 'DISPATCHED', response: response ?? undefined };
      }
    }catch (err:any) {

      this.logger.warn(
        `Command failed for ${deviceId}: ${err.message}`
      );

      throw err;
    }
  }

  async executeCommand(
    deviceId: string,
    command: string,
    payload: any,
    context?: CommandDispatchContext,
  ): Promise<CommandExecutionResult> {
    return this.serializeDeviceCommand(deviceId, async () => {
      const device = await this.options.findDeviceById(deviceId);

      this.validateDevice(device, deviceId);

      if (!device) {
        throw new DeviceNotFoundException(deviceId);
      }

      if (!device.schema) {
        throw new DeviceSchemaMissingException(deviceId);
      }

      const validation = validateDeviceCommand(
        device.schema,
        command,
        payload,
        `${device.model}:${device.version}`,
      );

      if (!validation.valid) {
        throw new CommandValidationException(validation.errors);
      }

      const latest = await this.options.getLatestTelemetry(deviceId);
      const redundancy = this.getRedundancyResult(
        device,
        latest,
        command,
        payload,
      );

      if (redundancy) {
        return redundancy;
      }

      if (command === "SET_STATE") {
        return this.triggerDeviceTelemetry(
          deviceId,
          payload.state,
          context,
        );
      }

      const response = await this.dispatchCommand(
        deviceId,
        command,
        payload,
        context,
      );

      if (response && !response.success) {
        throw new Error(response.error ?? 'DEVICE_REJECTED_COMMAND');
      }

      this.rememberConfirmedCommandState(
        device,
        command,
        payload,
        response ?? undefined,
      );

      return {
        status: 'DISPATCHED',
        response: response ?? undefined,
      };
    });
  }

  private extractFields( schema: any, prefix = "", required: string[] = []): any[] {

    const result: any[] = [];

    if (!schema?.properties) {
      return result;
    }

    for (const [key, value] of Object.entries<any>(schema.properties)) {

      const path = prefix ? `${prefix}.${key}`: key;

      if (value.type === "object" && value.properties) {

        result.push(
          ...this.extractFields(value, path, value.required ?? [])
        );

        continue;
      }

     result.push({
      name: key,
      path,
      type: value.type,
      required: required.includes(key),
      enum: value.enum,
      minimum: value.minimum,
      maximum: value.maximum,
      default: value.default,
      description: value.description
    });
    }

    return result;
  }

  async getCommandMetadata(deviceId: string) {

    const device = await this.options.findDeviceById(deviceId);
    if (!device) {
       throw new DeviceNotFoundException(deviceId);
    }

    const commands = device.schema?.commands ?? {};

    return Object.entries(commands).map(
      ([commandName, commandDef]: any) => ({

        command: commandName,

        fields: this.extractFields(
          commandDef.payload,
          "",
          commandDef.payload?.required ?? []
        )
      })
    );
  }

  async invalidateDeviceCache(
    deviceId: string,
  ): Promise<void> {
    this.clearConfirmedCommandState(deviceId);
    const redisClient = this.options.redis;

    if (!redisClient) {
      this.logger.debug(
        `[REDIS CACHE] Redis not configured. Nothing to invalidate for ${deviceId}`,
      );
      return;
    }

    try {
      await redisClient.del(
        `cache:device:${deviceId}`,
      );

      this.logger.log(
        `[REDIS CACHE] Invalidated device profile for ${deviceId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `[REDIS CACHE] Failed to invalidate device ${deviceId}: ${error.message}`,
      );

      throw error;
    }
  }

  async checkDevice(deviceId: string) {
    const device = await this.options.findDeviceById(deviceId);

    if (!device) {
      return null;
    }

    return device;
  }

  getPluginStatus(deviceId: string) {
    return {
      id: deviceId,
      pluginName: "DeviceDashboard",
      active: true,
      version: "1.0.0",
    };
  }

  getDashboardConfig() {
    return {
      theme: "cyberpunk",
      widgets: ["battery", "signal", "uptime"],
    };
  }

  getDevices() {
    return [
      { id: 1, name: "Termostat - Dnevna", status: "online" },
      { id: 2, name: "Pametna sijalica", status: "offline" },
      { id: 3, name: "IP Kamera", status: "online" },
    ];
  }

  getSubscriptionTopics(): string[] {
    return [
      "iot/devices/+/telemetry",
      "iot/devices/+/status",
      "iot/devices/+/attributes",
    ];
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      return value as Record<string, unknown>;
    }

    return null;
  }
}
