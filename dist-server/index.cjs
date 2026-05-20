#!/usr/bin/env node
process.env.MAVMETA_SERVE_STATIC = "1";
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/server/app.ts
var import_node_crypto3 = require("node:crypto");
var import_node_fs2 = require("node:fs");
var import_node_path4 = require("node:path");
var import_static = __toESM(require("@fastify/static"), 1);
var import_fastify = __toESM(require("fastify"), 1);

// src/server/deploy-service.ts
var import_node_crypto = require("node:crypto");
var import_node_path = __toESM(require("node:path"), 1);
var import_jszip = __toESM(require("jszip"), 1);
var import_core = require("@salesforce/core");

// src/shared/destructive-compatibility.ts
var UNSUPPORTED_DESTRUCTIVE_METADATA_TYPES = /* @__PURE__ */ new Set([
  "StandardValueSetTranslation",
  "Translations"
]);
function getDestructiveCompatibilityIssue(metadataType) {
  const normalized = metadataType.trim();
  if (!normalized) {
    return "Missing metadata type.";
  }
  if (UNSUPPORTED_DESTRUCTIVE_METADATA_TYPES.has(normalized)) {
    return `Unsupported destructive metadata type: ${normalized}.`;
  }
  return void 0;
}

// src/server/api-error.ts
var ApiError = class extends Error {
  statusCode;
  code;
  constructor(statusCode, code, message) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
};

// src/server/metadata-name.ts
var METADATA_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,79}(\.[A-Za-z][A-Za-z0-9_]{0,79})?$/;
function validateMetadataName(name) {
  return METADATA_NAME_PATTERN.test(name);
}

// src/server/redact-secrets.ts
var STRING_SECRET_PATTERNS = [
  /\b00D[A-Za-z0-9!._]{10,200}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\bBearer\s+\S{20,}\b/gi,
  /\bAuthorization\s*:\s*["']?Bearer\s+\S{20,}["']?/gi
];
var SECRET_KEY_PATTERN = /(accesstoken|access_token|access-token|refreshtoken|refresh_token|refresh-token|sessionid|session_id|session-id|sessiontoken|session_token|session-token|clientsecret|client_secret|client-secret|consumersecret|consumer_secret|consumer-secret)/i;
function redactSecrets(input) {
  if (typeof input === "string") {
    return redactString(input);
  }
  if (Array.isArray(input)) {
    return input.map((entry) => redactSecrets(entry));
  }
  if (input && typeof input === "object") {
    const redactedRecord = {};
    for (const [key, value] of Object.entries(input)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        redactedRecord[key] = "[REDACTED]";
        continue;
      }
      redactedRecord[key] = redactSecrets(value);
    }
    return redactedRecord;
  }
  return input;
}
function redactString(input) {
  let redacted = input;
  for (const pattern of STRING_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  redacted = redacted.replace(
    /\b(access[_-]?token|refresh[_-]?token|session[_-]?token|sessionid|client[_-]?secret|consumer[_-]?secret)\s*[:=]\s*["']?([^"'\s]+)["']?/gi,
    "$1=[REDACTED]"
  );
  return redacted;
}

// src/server/deploy-service.ts
var DEFAULT_COMPLETED_OPERATION_TTL_MS = 10 * 60 * 1e3;
var DEFAULT_RETRIEVE_POLL_TIMEOUT_MS = 12e4;
var DEFAULT_RETRIEVE_POLL_INTERVAL_MS = 2e3;
var DEPLOY_STATUS_POLL_INTERVAL_MS = 3e3;
var RETRIEVE_COMPONENT_YIELD_MS = 500;
var DeployService = class {
  operations = /* @__PURE__ */ new Map();
  crossOrgOperations = /* @__PURE__ */ new Map();
  connectionFactory;
  sleep;
  uuidFactory;
  now;
  completedOperationTtlMs;
  constructor(options = {}) {
    this.connectionFactory = options.connectionFactory ?? createConnection;
    this.sleep = options.sleep ?? defaultSleep;
    this.uuidFactory = options.uuidFactory ?? import_node_crypto.randomUUID;
    this.now = options.now ?? Date.now;
    this.completedOperationTtlMs = options.completedOperationTtlMs ?? DEFAULT_COMPLETED_OPERATION_TTL_MS;
  }
  async startDestructiveDeploy(request) {
    this.pruneExpiredOperations();
    const normalized = normalizeComponents(request.components);
    const [supported, skipped] = partitionSupportedComponents(normalized);
    const operationId = this.uuidFactory();
    const environment = await this.resolveOrgEnvironment(request.target.username);
    const operation = {
      id: operationId,
      targetUsername: request.target.username,
      mode: request.mode,
      environment,
      skipped,
      status: "pending",
      percentComplete: 0,
      message: "Preparing destructive deployment request."
    };
    this.operations.set(operationId, operation);
    if (!supported.length) {
      operation.status = "failed";
      operation.percentComplete = 100;
      operation.message = "No deployable components were provided.";
      operation.completedAt = this.now();
      operation.result = {
        target: request.target,
        mode: request.mode,
        environment,
        success: false,
        state: "Failed",
        message: operation.message,
        skipped,
        failed: []
      };
      return { operationId };
    }
    void this.runDestructiveOperation(operationId, request, supported);
    return { operationId };
  }
  async getDestructiveDeployStatus(operationId) {
    this.pruneExpiredOperations();
    const operation = this.operations.get(operationId);
    if (!operation) {
      throw new ApiError(404, "DEPLOY_OPERATION_NOT_FOUND", "Deploy operation not found.");
    }
    return {
      operationId,
      status: operation.status,
      percentComplete: operation.percentComplete,
      message: operation.message,
      deployState: operation.deployState,
      componentsProcessed: operation.componentsProcessed,
      componentsTotal: operation.componentsTotal,
      result: operation.result
    };
  }
  async cancelDestructiveDeploy(operationId) {
    return this.cancelOperation(operationId, this.operations);
  }
  async startCrossOrgDeploy(request) {
    this.pruneExpiredOperations();
    if (request.source.username === request.target.username) {
      throw new ApiError(400, "INVALID_REQUEST", "Source and target orgs must be different.");
    }
    const normalized = normalizeComponents(request.components);
    const [supported, skipped] = partitionSupportedComponents(normalized);
    const operationId = this.uuidFactory();
    const environment = await this.resolveOrgEnvironment(request.target.username);
    const operation = {
      id: operationId,
      sourceUsername: request.source.username,
      targetUsername: request.target.username,
      mode: request.mode,
      environment,
      skipped,
      status: "pending",
      percentComplete: 0,
      message: "Preparing cross-org deployment request."
    };
    this.crossOrgOperations.set(operationId, operation);
    if (!supported.length) {
      operation.status = "failed";
      operation.percentComplete = 100;
      operation.message = "No deployable components were provided.";
      operation.completedAt = this.now();
      operation.result = {
        source: request.source,
        target: request.target,
        mode: request.mode,
        environment,
        success: false,
        state: "Failed",
        message: operation.message,
        skipped,
        failed: []
      };
      return { operationId };
    }
    void this.runCrossOrgOperation(operationId, request, supported);
    return { operationId };
  }
  async getCrossOrgDeployStatus(operationId) {
    this.pruneExpiredOperations();
    const operation = this.crossOrgOperations.get(operationId);
    if (!operation) {
      throw new ApiError(404, "DEPLOY_OPERATION_NOT_FOUND", "Deploy operation not found.");
    }
    return {
      operationId,
      status: operation.status,
      percentComplete: operation.percentComplete,
      message: operation.message,
      deployState: operation.deployState,
      componentsProcessed: operation.componentsProcessed,
      componentsTotal: operation.componentsTotal,
      result: operation.result
    };
  }
  async cancelCrossOrgDeploy(operationId) {
    return this.cancelOperation(operationId, this.crossOrgOperations);
  }
  async cancelOperation(operationId, operations) {
    this.pruneExpiredOperations();
    const operation = operations.get(operationId);
    if (!operation) {
      return { operationId, canceled: false, message: "Deploy operation not found." };
    }
    if (isCompletedStatus(operation.status)) {
      return { operationId, canceled: false, message: "Deploy operation already completed." };
    }
    operation.cancelRequested = true;
    operation.message = "Cancel requested. Stopping deploy.";
    if (operation.jobId) {
      try {
        const connection = await this.connectionFactory(operation.targetUsername);
        await connection.metadata.cancelDeploy?.(operation.jobId);
      } catch {
      }
    }
    return { operationId, canceled: true, message: "Deploy cancel request sent." };
  }
  async runDestructiveOperation(operationId, request, supported) {
    const operation = this.operations.get(operationId);
    if (!operation) return;
    operation.status = "running";
    operation.message = "Starting Metadata API deployment job.";
    try {
      const connection = await this.connectionFactory(request.target.username);
      const zipBuffer = await buildMetadataDeployZip(supported);
      const finalPayload = await this.runDeployPolling({
        connection,
        zipBuffer,
        checkOnly: request.mode === "validate",
        onProgress: (progress) => {
          operation.percentComplete = progress.percentComplete;
          operation.message = progress.message;
          operation.deployState = progress.state;
          operation.componentsProcessed = progress.processed;
          operation.componentsTotal = progress.total;
        },
        onJobId: (jobId) => {
          operation.jobId = jobId;
        },
        shouldCancel: () => operation.cancelRequested === true
      });
      if (!finalPayload) throw new Error("Missing deploy status payload.");
      const failed = extractFailedComponents(finalPayload);
      const outcome = resolveDeployOutcome(operation.deployState ?? "Failed", finalPayload, failed);
      operation.status = outcome.status;
      operation.percentComplete = 100;
      operation.completedAt = this.now();
      operation.result = {
        target: request.target,
        mode: request.mode,
        environment: operation.environment,
        success: outcome.success,
        state: outcome.resultState,
        message: outcome.success ? `${request.mode === "validate" ? "Validation" : "Deploy"} completed successfully for ${supported.length} component(s).` : outcome.message ?? operation.message,
        skipped: operation.skipped,
        failed,
        rawResult: finalPayload
      };
      operation.message = operation.result.message;
    } catch (error) {
      operation.status = operation.cancelRequested ? "canceled" : "failed";
      operation.percentComplete = 100;
      operation.completedAt = this.now();
      operation.message = operation.cancelRequested ? "Deploy canceled by user." : error instanceof Error ? redactSecrets(error.message) : "Destructive deploy failed.";
      operation.result = {
        target: request.target,
        mode: request.mode,
        environment: operation.environment,
        success: false,
        state: operation.cancelRequested ? "Canceled" : "Failed",
        message: operation.message,
        skipped: operation.skipped,
        failed: []
      };
    }
  }
  async runDeployPolling(options) {
    const startResponse = await options.connection.metadata.deploy(options.zipBuffer, {
      checkOnly: options.checkOnly,
      rollbackOnError: true,
      singlePackage: true
    });
    const startPayload = await readDeployStartPayload(startResponse);
    const jobId = readJobId(startPayload) ?? readJobId(startResponse);
    if (!jobId) {
      throw new Error(`Salesforce did not return a deploy job id. ${summarizeResultShape(startPayload ?? startResponse)}`);
    }
    options.onJobId(jobId);
    for (; ; ) {
      await this.sleep(DEPLOY_STATUS_POLL_INTERVAL_MS);
      const rawStatusResult = await options.connection.metadata.checkDeployStatus(jobId, true);
      const statusPayload = unwrapDeployResult(rawStatusResult);
      const progress = readProgress(statusPayload);
      options.onProgress(progress);
      if (options.shouldCancel()) {
        throw new Error("Deploy canceled by user.");
      }
      if (progress.isTerminal) return statusPayload;
    }
  }
  async runCrossOrgOperation(operationId, request, supported) {
    const operation = this.crossOrgOperations.get(operationId);
    if (!operation) return;
    operation.status = "running";
    operation.message = "Retrieving source metadata from source org.";
    try {
      const sourceConnection = await this.connectionFactory(request.source.username);
      const targetConnection = await this.connectionFactory(request.target.username);
      const zipBuffer = await buildCrossOrgDeployZip(sourceConnection, supported);
      operation.message = "Starting cross-org Metadata API deployment job.";
      const finalPayload = await this.runDeployPolling({
        connection: targetConnection,
        zipBuffer,
        checkOnly: request.mode === "validate",
        onProgress: (progress) => {
          operation.percentComplete = progress.percentComplete;
          operation.message = progress.message;
          operation.deployState = progress.state;
          operation.componentsProcessed = progress.processed;
          operation.componentsTotal = progress.total;
        },
        onJobId: (jobId) => {
          operation.jobId = jobId;
        },
        shouldCancel: () => operation.cancelRequested === true
      });
      if (!finalPayload) throw new Error("Missing deploy status payload.");
      const failed = extractFailedComponents(finalPayload);
      const outcome = resolveDeployOutcome(operation.deployState ?? "Failed", finalPayload, failed);
      operation.status = outcome.status;
      operation.percentComplete = 100;
      operation.completedAt = this.now();
      operation.result = {
        source: request.source,
        target: request.target,
        mode: request.mode,
        environment: operation.environment,
        success: outcome.success,
        state: outcome.resultState,
        message: outcome.success ? `${request.mode === "validate" ? "Validation" : "Deploy"} completed successfully for ${supported.length} component(s).` : outcome.message ?? operation.message,
        skipped: operation.skipped,
        failed,
        rawResult: finalPayload
      };
      operation.message = operation.result.message;
    } catch (error) {
      operation.status = operation.cancelRequested ? "canceled" : "failed";
      operation.percentComplete = 100;
      operation.completedAt = this.now();
      operation.message = operation.cancelRequested ? "Deploy canceled by user." : error instanceof Error ? redactSecrets(error.message) : "Cross-org deploy failed.";
      operation.result = {
        source: request.source,
        target: request.target,
        mode: request.mode,
        environment: operation.environment,
        success: false,
        state: operation.cancelRequested ? "Canceled" : "Failed",
        message: operation.message,
        skipped: operation.skipped,
        failed: []
      };
    }
  }
  async resolveOrgEnvironment(username) {
    try {
      const connection = await this.connectionFactory(username);
      const queryResult = await connection.query("SELECT Id, IsSandbox, TrialExpirationDate FROM Organization");
      const record = queryResult.records?.[0];
      if (!record) return "unknown";
      if (record.TrialExpirationDate) return "scratch";
      return record.IsSandbox ? "sandbox" : "production";
    } catch {
      return "unknown";
    }
  }
  pruneExpiredOperations() {
    const now = this.now();
    for (const [operationId, operation] of this.operations.entries()) {
      if (operation.completedAt && now - operation.completedAt > this.completedOperationTtlMs) {
        this.operations.delete(operationId);
      }
    }
    for (const [operationId, operation] of this.crossOrgOperations.entries()) {
      if (operation.completedAt && now - operation.completedAt > this.completedOperationTtlMs) {
        this.crossOrgOperations.delete(operationId);
      }
    }
  }
};
async function buildCrossOrgDeployZip(sourceConnection, components) {
  const outputZip = new import_jszip.default();
  const apiVersion = sourceConnection.getApiVersion();
  const byType = /* @__PURE__ */ new Map();
  configureRetrievePolling(sourceConnection);
  const componentYieldMs = resolveRetrieveComponentYieldMs();
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    const locator = sourceConnection.metadata.retrieve({
      apiVersion,
      unpackaged: {
        types: [{ name: component.metadataType, members: [component.fullName] }],
        version: apiVersion
      }
    });
    const result = await completeRetrieveLocator(locator, component);
    if (!result.zipFile) {
      throw new Error(
        `Could not retrieve ${component.metadataType}:${component.fullName} from source org. The component may not exist or may not be retrievable.`
      );
    }
    const componentZip = await import_jszip.default.loadAsync(Buffer.from(result.zipFile, "base64"));
    for (const [fileName, file] of Object.entries(componentZip.files)) {
      if (file.dir || fileName === "package.xml") continue;
      const normalizedFileName = normalizeRetrievedDeployPath(fileName);
      const nextSource = await file.async("nodebuffer");
      const existing = outputZip.file(normalizedFileName);
      if (!existing) {
        outputZip.file(normalizedFileName, nextSource);
        continue;
      }
      const existingSource = await existing.async("nodebuffer");
      if (shouldKeepExistingDeployFile(
        normalizedFileName,
        existingSource.toString("utf8"),
        nextSource.toString("utf8")
      )) {
        continue;
      }
      outputZip.file(normalizedFileName, nextSource);
    }
    const members = byType.get(component.metadataType) ?? [];
    members.push(component.fullName);
    byType.set(component.metadataType, members);
    if (componentYieldMs > 0 && index < components.length - 1) {
      await defaultSleep(componentYieldMs);
    }
  }
  outputZip.file("package.xml", buildPackageXmlFromTypes(byType, apiVersion));
  return outputZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
function configureRetrievePolling(sourceConnection) {
  const configuredTimeout = Number(process.env.MAVMETA_RETRIEVE_POLL_TIMEOUT_MS);
  const configuredInterval = Number(process.env.MAVMETA_RETRIEVE_POLL_INTERVAL_MS);
  sourceConnection.metadata.pollTimeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_RETRIEVE_POLL_TIMEOUT_MS;
  sourceConnection.metadata.pollInterval = Number.isFinite(configuredInterval) && configuredInterval > 0 ? configuredInterval : DEFAULT_RETRIEVE_POLL_INTERVAL_MS;
}
function resolveRetrieveComponentYieldMs() {
  const configured = Number(process.env.MAVMETA_RETRIEVE_COMPONENT_YIELD_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return process.env.NODE_ENV === "test" ? 0 : RETRIEVE_COMPONENT_YIELD_MS;
}
async function completeRetrieveLocator(locator, component) {
  let emittedError;
  const errorListener = (error) => {
    emittedError = error;
  };
  locator.on?.("error", errorListener);
  try {
    return await locator.complete();
  } catch (error) {
    const resolvedError = error instanceof Error ? error : emittedError ?? new Error(
      `Unknown retrieve failure for ${component.metadataType}:${component.fullName}.`
    );
    throw new Error(
      `Source retrieve failed for ${component.metadataType}:${component.fullName}: ${redactSecrets(resolvedError.message)}`
    );
  } finally {
    if (locator.off) {
      locator.off("error", errorListener);
    } else {
      locator.removeListener?.("error", errorListener);
    }
  }
}
async function createConnection(username) {
  const org = await import_core.Org.create({ aliasOrUsername: username });
  const connection = org.getConnection();
  return connection;
}
async function defaultSleep(milliseconds) {
  await new Promise((resolve2) => setTimeout(resolve2, milliseconds));
}
function normalizeComponents(components) {
  return components.map((component) => ({
    metadataType: component.metadataType.trim(),
    fullName: component.fullName.trim()
  }));
}
function partitionSupportedComponents(components) {
  const supported = [];
  const skipped = [];
  for (const component of components) {
    if (!component.metadataType || !component.fullName) {
      skipped.push({ metadataType: component.metadataType, fullName: component.fullName, reason: "Missing metadata type or full name." });
      continue;
    }
    if (!validateMetadataName(component.fullName)) {
      skipped.push({
        metadataType: component.metadataType,
        fullName: component.fullName,
        reason: "Invalid metadata full name."
      });
      continue;
    }
    const compatibilityIssue = getDestructiveCompatibilityIssue(component.metadataType);
    if (compatibilityIssue) {
      skipped.push({ metadataType: component.metadataType, fullName: component.fullName, reason: compatibilityIssue });
      continue;
    }
    supported.push(component);
  }
  return [supported, skipped];
}
async function buildMetadataDeployZip(components) {
  const zip = new import_jszip.default();
  zip.file("package.xml", buildPackageXml());
  zip.file("destructiveChanges.xml", buildDestructiveXml(components));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
function buildPackageXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
    "  <version>66.0</version>",
    "</Package>"
  ].join("\n");
}
function buildPackageXmlFromTypes(byType, apiVersion) {
  const typeBlocks = Array.from(byType.entries()).sort((left, right) => left[0].localeCompare(right[0])).map(([metadataType, members]) => {
    const lines = members.sort((left, right) => left.localeCompare(right)).map((member) => `    <members>${xmlEscape(member)}</members>`).join("\n");
    return `  <types>
${lines}
    <name>${xmlEscape(metadataType)}</name>
  </types>`;
  }).join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
    typeBlocks,
    `  <version>${xmlEscape(apiVersion)}</version>`,
    "</Package>"
  ].join("\n");
}
function buildDestructiveXml(components) {
  const byType = /* @__PURE__ */ new Map();
  for (const component of components) {
    const entries = byType.get(component.metadataType) ?? [];
    entries.push(component.fullName);
    byType.set(component.metadataType, entries);
  }
  const typeBlocks = Array.from(byType.entries()).sort((left, right) => left[0].localeCompare(right[0])).map(([metadataType, members]) => {
    const lines = members.sort((left, right) => left.localeCompare(right)).map((member) => `    <members>${xmlEscape(member)}</members>`).join("\n");
    return `  <types>
${lines}
    <name>${xmlEscape(metadataType)}</name>
  </types>`;
  }).join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
    typeBlocks,
    "  <version>66.0</version>",
    "</Package>"
  ].join("\n");
}
function xmlEscape(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function isCompletedStatus(status) {
  return status === "succeeded" || status === "failed" || status === "canceled";
}
function toObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  return value;
}
function unwrapDeployResult(value) {
  const objectValue = toObject(value);
  if (!objectValue) return {};
  const nestedResult = toObject(objectValue.result);
  return nestedResult ?? objectValue;
}
async function readDeployStartPayload(value) {
  const record = toObject(value);
  if (!record) return void 0;
  const checkCandidate = record.check;
  if (typeof checkCandidate === "function") {
    const checkResult = await checkCandidate();
    return unwrapDeployResult(checkResult);
  }
  return unwrapDeployResult(record);
}
function readJobId(result) {
  const record = toObject(result);
  if (!record) return void 0;
  const directCandidates = [record.id, record.jobId, record.asyncId, record.deployId];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  for (const [key, fieldValue] of Object.entries(record)) {
    if (typeof fieldValue === "string" && (key.toLowerCase().includes("id") || key.toLowerCase().includes("job")) && fieldValue.trim()) {
      return fieldValue.trim();
    }
  }
  for (const nestedValue of Object.values(record)) {
    if (Array.isArray(nestedValue)) {
      for (const nestedItem of nestedValue) {
        const found2 = readJobId(nestedItem);
        if (found2) return found2;
      }
      continue;
    }
    const found = readJobId(nestedValue);
    if (found) return found;
  }
  return void 0;
}
function readProgress(rawResult) {
  const state = readStatusString(rawResult);
  const total = readNumberField(rawResult, "numberComponentsTotal");
  const deployed = readNumberField(rawResult, "numberComponentsDeployed");
  const errors = readNumberField(rawResult, "numberComponentErrors");
  const processed = Math.max(0, deployed + errors);
  const percentComplete = total > 0 ? isTerminalState(state) ? 100 : Math.min(99, Math.round(processed / total * 100)) : isTerminalState(state) ? 100 : 0;
  return {
    state,
    processed,
    total,
    percentComplete,
    isTerminal: isTerminalState(state),
    message: `${state} ${percentComplete}% (${processed}/${total || 0} components processed)`
  };
}
function readStatusString(rawResult) {
  const status = rawResult.status;
  return typeof status === "string" && status.trim() ? status.trim() : "InProgress";
}
function readNumberField(rawResult, field) {
  const value = rawResult[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function isTerminalState(state) {
  return state === "Succeeded" || state === "SucceededPartial" || state === "Failed" || state === "Canceled" || state === "Canceling" || state === "FinalizingDeployFailed";
}
function resolveDeployOutcome(state, rawResult, failed) {
  const successField = rawResult.success;
  const successFromPayload = typeof successField === "boolean" ? successField : void 0;
  if (state === "Succeeded") return { success: true, status: "succeeded", resultState: "Succeeded", message: void 0 };
  if (state === "Canceled" || state === "Canceling") return { success: false, status: "canceled", resultState: "Canceled", message: "Deploy canceled by user." };
  if (state === "SucceededPartial") {
    const summary = failed.length ? `Deploy completed with partial failures (${failed.length} component failure${failed.length === 1 ? "" : "s"}).` : "Deploy completed with partial failures.";
    return { success: false, status: "failed", resultState: "PartiallySucceeded", message: summary };
  }
  if (successFromPayload === true) return { success: true, status: "succeeded", resultState: "Succeeded", message: void 0 };
  return { success: false, status: "failed", resultState: "Failed", message: void 0 };
}
function extractFailedComponents(rawResult) {
  const details = toObject(rawResult.details);
  if (!details) return [];
  const componentFailures = details.componentFailures;
  const failures = Array.isArray(componentFailures) ? componentFailures : componentFailures ? [componentFailures] : [];
  return failures.map((failure) => {
    const failureRecord = toObject(failure);
    if (!failureRecord) return void 0;
    const metadataType = stringOrEmpty(failureRecord.componentType);
    const fullName = stringOrEmpty(failureRecord.fullName);
    const problem = stringOrEmpty(failureRecord.problem) || "Deploy failure.";
    if (!metadataType || !fullName) return void 0;
    const normalized = { metadataType, fullName, problem };
    return normalized;
  }).filter((failure) => failure !== void 0);
}
function stringOrEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}
function summarizeResultShape(result) {
  const record = toObject(result);
  if (!record) return "Start result payload was empty.";
  const keys = Object.keys(record);
  if (!keys.length) return "Start result payload had no keys.";
  return `Start result keys: ${keys.join(", ")}.`;
}
function normalizeRetrievedDeployPath(fileName) {
  const normalized = fileName.startsWith("unpackaged/") ? fileName.slice("unpackaged/".length) : fileName;
  const sanitized = normalized.replaceAll("\\", "/");
  if (sanitized.startsWith("/") || sanitized.includes("\0")) {
    throw new Error(`Unsafe retrieved path: ${fileName}`);
  }
  const rawSegments = sanitized.split("/");
  if (rawSegments.some((segment) => segment === "..")) {
    throw new Error(`Unsafe retrieved path: ${fileName}`);
  }
  const normalizedPosix = import_node_path.default.posix.normalize(sanitized);
  if (normalizedPosix.startsWith("../") || normalizedPosix === "..") {
    throw new Error(`Unsafe retrieved path: ${fileName}`);
  }
  return normalizedPosix;
}
function shouldKeepExistingDeployFile(fileName, existingSource, nextSource) {
  const isCustomObjectMetadataFile = fileName.endsWith(".object") || fileName.endsWith(".object-meta.xml");
  if (!isCustomObjectMetadataFile) {
    return false;
  }
  const existingHasLabel = hasTopLevelCustomObjectLabel(existingSource);
  const nextHasLabel = hasTopLevelCustomObjectLabel(nextSource);
  if (existingHasLabel && !nextHasLabel) {
    return true;
  }
  return existingHasLabel && nextHasLabel && existingSource.length >= nextSource.length;
}
function hasTopLevelCustomObjectLabel(source) {
  const labelIndex = source.indexOf("<label>");
  if (labelIndex < 0) return false;
  const fieldsIndex = source.indexOf("<fields>");
  return fieldsIndex < 0 || labelIndex < fieldsIndex;
}

// src/server/lwc-service.ts
var import_core2 = require("@salesforce/core");
var SALESFORCE_ID_REGEX = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;
var LwcService = class {
  connectionFactory;
  constructor(options = {}) {
    this.connectionFactory = options.connectionFactory ?? createConnection2;
  }
  async listBundles(request) {
    const { tooling } = await this.connectionFactory(request.orgUsername);
    const result = await tooling.query(
      "SELECT Id, DeveloperName, MasterLabel, NamespacePrefix, ApiVersion, LastModifiedDate, LastModifiedBy.Name FROM LightningComponentBundle ORDER BY DeveloperName"
    );
    return {
      bundles: result.records.map(toBundleSummary)
    };
  }
  async getBundle(request) {
    validateBundleId(request.bundleId);
    const { tooling } = await this.connectionFactory(request.orgUsername);
    const [bundleResult, resourcesResult] = await Promise.all([
      tooling.query(
        `SELECT Id, DeveloperName, MasterLabel, NamespacePrefix, ApiVersion, LastModifiedDate, LastModifiedBy.Name FROM LightningComponentBundle WHERE Id = '${request.bundleId}'`
      ),
      tooling.query(
        `SELECT Id, FilePath, Format, Source, LastModifiedDate FROM LightningComponentResource WHERE LightningComponentBundleId = '${request.bundleId}'`
      )
    ]);
    if (!bundleResult.records.length) {
      throw new ApiError(404, "NOT_FOUND", `Bundle ${request.bundleId} not found.`);
    }
    return {
      bundle: toBundleSummary(bundleResult.records[0]),
      files: resourcesResult.records.map(toFile)
    };
  }
  async deployBundle(request) {
    validateBundleId(request.bundleId);
    const { tooling } = await this.connectionFactory(request.orgUsername);
    if (!request.force) {
      const conflictResult = await checkConflict(
        tooling,
        request.bundleId,
        request.expectedLastModifiedDate
      );
      if (conflictResult) {
        return conflictResult;
      }
    }
    const start = Date.now();
    const existingResult = await tooling.query(
      `SELECT Id, FilePath FROM LightningComponentResource WHERE LightningComponentBundleId = '${request.bundleId}'`
    );
    const idByPath = /* @__PURE__ */ new Map();
    for (const record of existingResult.records) {
      idByPath.set(String(record.FilePath ?? ""), String(record.Id ?? ""));
    }
    const missingPaths = request.files.filter((f) => !idByPath.has(f.path)).map((f) => f.path);
    if (missingPaths.length > 0) {
      return {
        status: "error",
        durationMs: Date.now() - start,
        errors: missingPaths.map((p) => ({
          filePath: p,
          message: `Resource not found on org: ${p}`,
          severity: "error"
        }))
      };
    }
    try {
      await Promise.all(
        request.files.map(
          (file) => tooling.sobject("LightningComponentResource").update({
            Id: idByPath.get(file.path),
            Source: file.source
          })
        )
      );
    } catch (err) {
      return {
        status: "error",
        durationMs: Date.now() - start,
        errors: parseLwcErrors(err)
      };
    }
    const bundleResult = await tooling.query(
      `SELECT LastModifiedDate FROM LightningComponentBundle WHERE Id = '${request.bundleId}'`
    );
    const newLastModifiedDate = bundleResult.records.length > 0 ? String(bundleResult.records[0].LastModifiedDate ?? "") : request.expectedLastModifiedDate;
    return {
      status: "success",
      durationMs: Date.now() - start,
      newLastModifiedDate
    };
  }
};
async function checkConflict(tooling, bundleId, expectedLastModifiedDate) {
  const result = await tooling.query(
    `SELECT LastModifiedDate FROM LightningComponentBundle WHERE Id = '${bundleId}'`
  );
  if (!result.records.length) {
    return null;
  }
  const currentLastModifiedDate = String(result.records[0].LastModifiedDate ?? "");
  const expectedTime = new Date(expectedLastModifiedDate).getTime();
  const currentTime = new Date(currentLastModifiedDate).getTime();
  if (currentTime <= expectedTime) {
    return null;
  }
  const resourcesResult = await tooling.query(
    `SELECT FilePath FROM LightningComponentResource WHERE LightningComponentBundleId = '${bundleId}'`
  );
  return {
    status: "conflict",
    currentLastModifiedDate,
    changedFiles: resourcesResult.records.map((r) => String(r.FilePath ?? ""))
  };
}
var LWC_ERROR_RE = /LWC\d+:\s*([^\n]+)(?:\n\s+([\w/.-]+):(\d+):(\d+))?/g;
function parseLwcErrors(err) {
  const message = err instanceof Error ? err.message : String(err);
  const errors = [];
  let match;
  LWC_ERROR_RE.lastIndex = 0;
  while ((match = LWC_ERROR_RE.exec(message)) !== null) {
    errors.push({
      filePath: match[2] ?? "",
      line: match[3] !== void 0 ? Number(match[3]) : void 0,
      column: match[4] !== void 0 ? Number(match[4]) : void 0,
      message: match[1].trim(),
      severity: "error"
    });
  }
  return errors.length > 0 ? errors : [{ filePath: "", message, severity: "error" }];
}
function validateBundleId(bundleId) {
  if (!SALESFORCE_ID_REGEX.test(bundleId)) {
    throw new ApiError(400, "INVALID_REQUEST", "bundleId must be a valid 15 or 18-character Salesforce Id.");
  }
}
function toBundleSummary(record) {
  const lastModifiedBy = record.LastModifiedBy;
  return {
    id: String(record.Id ?? ""),
    developerName: String(record.DeveloperName ?? ""),
    masterLabel: String(record.MasterLabel ?? ""),
    namespacePrefix: record.NamespacePrefix ? String(record.NamespacePrefix) : null,
    apiVersion: Number(record.ApiVersion ?? 0),
    lastModifiedDate: String(record.LastModifiedDate ?? ""),
    lastModifiedByName: lastModifiedBy?.Name ?? ""
  };
}
function toFile(record) {
  return {
    id: String(record.Id ?? ""),
    filePath: String(record.FilePath ?? ""),
    format: String(record.Format ?? ""),
    source: String(record.Source ?? ""),
    lastModifiedDate: String(record.LastModifiedDate ?? "")
  };
}
async function createConnection2(username) {
  const org = await import_core2.Org.create({ aliasOrUsername: username });
  const connection = org.getConnection();
  return connection;
}

// src/server/metadata-service.ts
var import_node_path2 = __toESM(require("node:path"), 1);
var import_core3 = require("@salesforce/core");
var MAX_CACHE_ENTRIES = 50;
var MetadataService = class {
  componentSourceCache = /* @__PURE__ */ new Map();
  async listMetadataTypes(request) {
    const connection = await this.getConnection(request.target.username);
    const apiVersion = connection.getApiVersion();
    const describeResult = await connection.metadata.describe(
      apiVersion
    );
    return {
      target: request.target,
      apiVersion,
      types: toMetadataTypes(describeResult)
    };
  }
  async listMetadataComponents(request) {
    const connection = await this.getConnection(request.target.username);
    const apiVersion = connection.getApiVersion();
    const componentsRaw = await this.listMetadataRecords(request, connection, apiVersion);
    const normalizedSearch = request.search?.trim().toLowerCase();
    const components = componentsRaw.map((record) => toMetadataComponentSummary(record, request.metadataType)).filter((component) => component !== void 0).filter(
      (component) => matchesMetadataComponentSearch(component, normalizedSearch)
    ).sort(compareMetadataComponents);
    return {
      target: request.target,
      metadataType: request.metadataType,
      apiVersion,
      components,
      errors: []
    };
  }
  async getConnection(username) {
    const org = await import_core3.Org.create({ aliasOrUsername: username });
    return org.getConnection();
  }
  async listMetadataRecords(request, connection, apiVersion) {
    if (request.folder) {
      return toArray(
        await connection.metadata.list(
          [{ type: request.metadataType, folder: request.folder }],
          apiVersion
        )
      );
    }
    const folderType = getFolderMetadataType(request.metadataType);
    if (!folderType) {
      return toArray(
        await connection.metadata.list([{ type: request.metadataType }], apiVersion)
      );
    }
    const folderRecords = toArray(
      await connection.metadata.list([{ type: folderType }], apiVersion)
    );
    const folderNames = folderRecords.map((record) => readStringField(record, "fullName")).filter((folder) => folder !== void 0);
    const grouped = await Promise.all(
      folderNames.map(
        (folder) => connection.metadata.list([{ type: request.metadataType, folder }], apiVersion)
      )
    );
    return grouped.flatMap((value) => toArray(value));
  }
  async getComponentSource(request) {
    const cacheKey = `${request.target.username}:${request.metadataType}:${request.fullName}`;
    const cached = this.componentSourceCache.get(cacheKey);
    if (cached) {
      return {
        target: request.target,
        metadataType: request.metadataType,
        fullName: request.fullName,
        source: cached.source,
        truncated: cached.truncated
      };
    }
    try {
      const org = await import_core3.Org.create({ aliasOrUsername: request.target.username });
      const connection = org.getConnection();
      const apiVersion = connection.getApiVersion();
      const xmlContent = await this.retrieveInMemory(connection, request.metadataType, request.fullName, apiVersion);
      const lines = xmlContent.split("\n");
      const truncated = lines.length > 1e3;
      const source = truncated ? lines.slice(0, 1e3).join("\n") + "\n... (truncated)" : xmlContent;
      if (this.componentSourceCache.size >= MAX_CACHE_ENTRIES) {
        const firstKey = this.componentSourceCache.keys().next().value;
        if (firstKey !== void 0) {
          this.componentSourceCache.delete(firstKey);
        }
      }
      this.componentSourceCache.set(cacheKey, { source, truncated });
      return { target: request.target, metadataType: request.metadataType, fullName: request.fullName, source, truncated, apiVersion };
    } catch (error) {
      return {
        target: request.target,
        metadataType: request.metadataType,
        fullName: request.fullName,
        error: {
          message: error instanceof Error ? redactSecrets(error.message) : "Unknown error",
          scope: "component-source"
        }
      };
    }
  }
  async getCrossOrgComponentDiff(request) {
    const sourceUsername = request.source.username;
    const targetUsername = request.target.username;
    if (sourceUsername === targetUsername) {
      throw new ApiError(
        400,
        "INVALID_REQUEST",
        "Source and target orgs must be different for metadata diff."
      );
    }
    await this.requireAuthenticatedOrg(sourceUsername, "Source");
    await this.requireAuthenticatedOrg(targetUsername, "Target");
    const results = await Promise.all(
      request.components.map(async (component) => {
        const sourceResponse = await this.getComponentSource({
          target: request.source,
          metadataType: component.metadataType,
          fullName: component.fullName,
          fileName: component.fileName,
          folder: component.folder
        });
        const targetResponse = await this.getComponentSource({
          target: request.target,
          metadataType: component.metadataType,
          fullName: component.fullName,
          fileName: component.fileName,
          folder: component.folder
        });
        const sourceXml = sourceResponse.source;
        const targetXml = targetResponse.source;
        const state = resolveDiffState(sourceResponse, targetResponse);
        return {
          metadataType: component.metadataType,
          fullName: component.fullName,
          fileName: component.fileName,
          state,
          sourceXml,
          targetXml,
          message: sourceResponse.error?.message ?? targetResponse.error?.message
        };
      })
    );
    return { source: request.source, target: request.target, results };
  }
  async requireAuthenticatedOrg(username, orgRole) {
    try {
      await this.getConnection(username);
    } catch {
      throw new ApiError(
        400,
        "ORG_NOT_AUTHENTICATED",
        `${orgRole} org is no longer authenticated. Re-authenticate it before comparing or deploying.`
      );
    }
  }
  async retrieveInMemory(connection, metadataType, fullName, apiVersion) {
    try {
      const locator = connection.metadata.retrieve({
        apiVersion,
        unpackaged: { types: [{ name: metadataType, members: [fullName] }], version: apiVersion }
      });
      const status = await locator.complete();
      if (status.zipFile) {
        const extracted = await this.extractFromZipBuffer(
          Buffer.from(status.zipFile, "base64"),
          fullName
        );
        if (extracted) {
          return extracted;
        }
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.warn(
        `In-memory retrieve failed for ${metadataType}/${fullName}, falling back to metadata.read: ${redactSecrets(errorMessage)}`
      );
    }
    return this.readAndSerialize(connection, metadataType, fullName);
  }
  async extractFromZipBuffer(zipBuffer, fullName) {
    const JSZip2 = await import("jszip");
    const zip = await JSZip2.default.loadAsync(zipBuffer);
    const baseName = fullName.includes("/") ? fullName.split("/").pop() : fullName;
    const matchingFile = Object.keys(zip.files).find(
      (name) => !zip.files[name].dir && isSafeZipEntryPath(name) && name.includes(baseName)
    );
    if (matchingFile) {
      return zip.files[matchingFile].async("string");
    }
    return void 0;
  }
  async readAndSerialize(connection, metadataType, fullName) {
    const unsupportedTypes = ["ApexClass", "ApexTrigger", "ApexComponent", "ApexPage"];
    if (!unsupportedTypes.includes(metadataType)) {
      try {
        const result = await connection.metadata.read(metadataType, [fullName]);
        const record = Array.isArray(result) ? result[0] : result;
        if (record && typeof record === "object" && Object.keys(record).length > 0) {
          return this.serializeToXml(metadataType, record);
        }
      } catch {
      }
    }
    return this.serializeToXml(metadataType, void 0);
  }
  serializeToXml(metadataType, metadata) {
    const header = '<?xml version="1.0" encoding="UTF-8"?>\n';
    const rootStart = `<${metadataType} xmlns="http://soap.sforce.com/2006/04/metadata">
`;
    const rootEnd = `</${metadataType}>`;
    const body = this.objectToXml(metadata, 1);
    return header + rootStart + body + rootEnd;
  }
  objectToXml(obj, indent) {
    let xml = "";
    const padding = "    ".repeat(indent);
    if (!isObjectRecord(obj)) {
      return xml;
    }
    for (const [key, value] of Object.entries(obj)) {
      if (key === "$" || key === "@" || key === "xmlns") continue;
      if (value === null || value === void 0) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          xml += `${padding}<${key}>
${this.objectToXml(item, indent + 1)}${padding}</${key}>
`;
        }
      } else if (typeof value === "object") {
        xml += `${padding}<${key}>
${this.objectToXml(value, indent + 1)}${padding}</${key}>
`;
      } else {
        xml += `${padding}<${key}>${this.escapeXml(String(value))}</${key}>
`;
      }
    }
    return xml;
  }
  escapeXml(unsafe) {
    return unsafe.replace(/[<>&"']/g, (c) => {
      switch (c) {
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case "&":
          return "&amp;";
        case '"':
          return "&quot;";
        case "'":
          return "&apos;";
        default:
          return c;
      }
    });
  }
};
function getFolderMetadataType(metadataType) {
  const folderTypes = {
    Dashboard: "DashboardFolder",
    Document: "DocumentFolder",
    EmailTemplate: "EmailFolder",
    Report: "ReportFolder"
  };
  return folderTypes[metadataType];
}
function toMetadataTypes(describeResult) {
  return (describeResult.metadataObjects ?? []).filter(hasXmlName).map((metadataObject) => ({
    xmlName: metadataObject.xmlName,
    label: toTypeLabel(metadataObject.xmlName),
    directoryName: metadataObject.directoryName,
    suffix: metadataObject.suffix,
    childXmlNames: toChildXmlNames(metadataObject.childXmlNames),
    inFolder: metadataObject.inFolder ?? false,
    metaFile: metadataObject.metaFile ?? false
  })).sort((left, right) => left.label.localeCompare(right.label));
}
function toMetadataComponentSummary(record, defaultType) {
  if (!isObjectRecord(record)) {
    return void 0;
  }
  const fullName = readStringField(record, "fullName");
  if (!fullName) {
    return void 0;
  }
  return {
    fullName,
    type: readStringField(record, "type") ?? defaultType,
    id: readStringField(record, "id"),
    fileName: readStringField(record, "fileName"),
    folder: readStringField(record, "folder") ?? deriveFolder(fullName),
    parentName: readStringField(record, "parentName") ?? deriveParentName(fullName),
    namespacePrefix: readStringField(record, "namespacePrefix"),
    manageableState: readStringField(record, "manageableState"),
    label: readStringField(record, "label"),
    developerName: readStringField(record, "developerName"),
    createdByName: readStringField(record, "createdByName"),
    createdDate: readStringField(record, "createdDate"),
    lastModifiedByName: readStringField(record, "lastModifiedByName"),
    lastModifiedDate: readStringField(record, "lastModifiedDate"),
    raw: record
  };
}
function matchesMetadataComponentSearch(component, normalizedSearch) {
  if (!normalizedSearch) {
    return true;
  }
  return [
    component.fullName,
    component.label,
    component.developerName,
    component.fileName,
    component.folder,
    component.parentName,
    component.namespacePrefix
  ].filter((value) => value !== void 0).some((value) => value.toLowerCase().includes(normalizedSearch));
}
function deriveFolder(fullName) {
  const slashIndex = fullName.indexOf("/");
  return slashIndex > 0 ? fullName.slice(0, slashIndex) : void 0;
}
function deriveParentName(fullName) {
  const dotIndex = fullName.indexOf(".");
  return dotIndex > 0 ? fullName.slice(0, dotIndex) : void 0;
}
function compareMetadataComponents(left, right) {
  const leftTimestamp = toTimestamp(left.lastModifiedDate);
  const rightTimestamp = toTimestamp(right.lastModifiedDate);
  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp;
  }
  return left.fullName.localeCompare(right.fullName);
}
function toTimestamp(value) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}
function readStringField(record, fieldName) {
  if (!isObjectRecord(record)) {
    return void 0;
  }
  const value = record[fieldName];
  return typeof value === "string" && value.trim() ? value : void 0;
}
function isObjectRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSafeZipEntryPath(entryPath) {
  const sanitized = entryPath.replaceAll("\\", "/");
  if (sanitized.startsWith("/") || sanitized.includes("\0")) {
    return false;
  }
  if (sanitized.split("/").some((segment) => segment === "..")) {
    return false;
  }
  const normalized = import_node_path2.default.posix.normalize(sanitized);
  if (normalized.startsWith("../") || normalized === "..") {
    return false;
  }
  return !normalized.split("/").some((segment) => segment === "..");
}
function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value === void 0 || value === null ? [] : [value];
}
function hasXmlName(metadataObject) {
  return typeof metadataObject.xmlName === "string" && metadataObject.xmlName !== "";
}
function toChildXmlNames(childXmlNames) {
  if (childXmlNames === void 0) {
    return [];
  }
  return Array.isArray(childXmlNames) ? childXmlNames : [childXmlNames];
}
function toTypeLabel(xmlName) {
  return xmlName.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}
function normalizeXmlForDiff(value) {
  return value.replace(/\r\n/g, "\n").trim();
}
function resolveDiffState(sourceResponse, targetResponse) {
  if (sourceResponse.error) {
    if (isLikelyMissingComponentError(sourceResponse.error.message)) {
      return "MissingInSource";
    }
    if (sourceResponse.error.scope === "component-source") {
      return "Error";
    }
    return "MissingInSource";
  }
  if (targetResponse.error) {
    if (isLikelyMissingComponentError(targetResponse.error.message)) {
      return "MissingInTarget";
    }
    if (targetResponse.error.scope === "component-source") {
      return "Error";
    }
    return "MissingInTarget";
  }
  if (sourceResponse.source === void 0) {
    return "MissingInSource";
  }
  if (targetResponse.source === void 0) {
    return "MissingInTarget";
  }
  return normalizeXmlForDiff(sourceResponse.source) === normalizeXmlForDiff(targetResponse.source) ? "Same" : "Changed";
}
function isLikelyMissingComponentError(message) {
  const normalized = message.toLowerCase();
  return normalized.includes("not found") || normalized.includes("does not exist");
}

// src/server/object-explorer-service.ts
var import_core4 = require("@salesforce/core");

// src/shared/object-explorer.ts
var OBJECT_CHILD_METADATA_TYPES = [
  "CustomField",
  "ValidationRule",
  "RecordType",
  "FieldSet",
  "ListView",
  "CompactLayout",
  "WebLink",
  "BusinessProcess",
  "SharingReason",
  "SharingRecalculation"
];

// src/server/object-explorer-service.ts
var ObjectExplorerService = class {
  async listObjects(request) {
    const connection = await this.getConnection(request.target.username);
    const apiVersion = connection.getApiVersion();
    const records = toArray2(
      await connection.metadata.list([{ type: "CustomObject" }], apiVersion)
    );
    const objects = records.map(toObjectSummary).filter((obj) => obj !== void 0).sort((left, right) => left.label.localeCompare(right.label));
    return { target: request.target, objects };
  }
  async listObjectChildren(request) {
    const connection = await this.getConnection(request.target.username);
    const apiVersion = connection.getApiVersion();
    const results = await Promise.allSettled(
      OBJECT_CHILD_METADATA_TYPES.map(async (childType) => {
        const records = toArray2(
          await connection.metadata.list(
            [{ type: childType, folder: request.objectApiName }],
            apiVersion
          )
        );
        const items = records.map((record) => toChildMetadataItem(record, childType, request.objectApiName)).filter((item) => item !== void 0);
        return { childType, items };
      })
    );
    const children = {};
    const errors = [];
    for (let i = 0; i < OBJECT_CHILD_METADATA_TYPES.length; i++) {
      const childType = OBJECT_CHILD_METADATA_TYPES[i];
      const result = results[i];
      if (!result || !childType) continue;
      if (result.status === "fulfilled") {
        children[childType] = result.value.items;
      } else {
        children[childType] = [];
        const reason = result.reason;
        errors.push({
          metadataType: childType,
          message: reason instanceof Error ? reason.message : "Unknown error"
        });
      }
    }
    return {
      target: request.target,
      objectApiName: request.objectApiName,
      children,
      errors
    };
  }
  async getConnection(username) {
    const org = await import_core4.Org.create({ aliasOrUsername: username });
    return org.getConnection();
  }
};
function toObjectSummary(record) {
  if (!isObjectRecord2(record)) return void 0;
  const fullName = readStringField2(record, "fullName");
  if (!fullName) return void 0;
  const label = readStringField2(record, "label") ?? toObjectLabel(fullName);
  return {
    apiName: fullName,
    label,
    objectType: deriveObjectType(fullName),
    namespacePrefix: readStringField2(record, "namespacePrefix"),
    manageableState: readStringField2(record, "manageableState")
  };
}
function toChildMetadataItem(record, metadataType, parentObject) {
  if (!isObjectRecord2(record)) return void 0;
  const fullName = readStringField2(record, "fullName");
  if (!fullName) return void 0;
  const childApiName = deriveChildApiName(fullName);
  return {
    fullName,
    childApiName,
    parentObject: deriveParentFromFullName(fullName) ?? parentObject,
    metadataType,
    label: readStringField2(record, "label"),
    manageableState: readStringField2(record, "manageableState"),
    lastModifiedByName: readStringField2(record, "lastModifiedByName"),
    lastModifiedDate: readStringField2(record, "lastModifiedDate"),
    raw: record
  };
}
function deriveChildApiName(fullName) {
  const dotIndex = fullName.indexOf(".");
  return dotIndex >= 0 ? fullName.slice(dotIndex + 1) : fullName;
}
function deriveParentFromFullName(fullName) {
  const dotIndex = fullName.indexOf(".");
  return dotIndex > 0 ? fullName.slice(0, dotIndex) : void 0;
}
function deriveObjectType(apiName) {
  if (apiName.endsWith("__mdt")) return "customMetadata";
  if (apiName.endsWith("__e")) return "platformEvent";
  if (apiName.endsWith("__c")) return "custom";
  return "standard";
}
function toObjectLabel(apiName) {
  return apiName.replace(/__c$/, "").replace(/__e$/, "").replace(/__mdt$/, "").replace(/_/g, " ").trim();
}
function readStringField2(record, fieldName) {
  const value = record[fieldName];
  return typeof value === "string" && value.trim() ? value : void 0;
}
function isObjectRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function toArray2(value) {
  if (Array.isArray(value)) return value;
  return value === void 0 || value === null ? [] : [value];
}

// src/server/org-service.ts
var import_core5 = require("@salesforce/core");

// src/server/active-org-store.ts
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path3 = require("node:path");
var ActiveOrgStore = class {
  activeUsername;
  stateFilePath;
  constructor(stateFilePath = resolveDefaultStateFilePath()) {
    this.stateFilePath = stateFilePath;
    this.activeUsername = this.readFromDisk();
  }
  getActiveUsername() {
    return this.activeUsername;
  }
  setActiveUsername(username) {
    this.activeUsername = username;
    this.writeToDisk();
  }
  clear() {
    this.activeUsername = void 0;
    this.clearFromDisk();
  }
  readFromDisk() {
    if (!(0, import_node_fs.existsSync)(this.stateFilePath)) {
      return void 0;
    }
    try {
      const content = (0, import_node_fs.readFileSync)(this.stateFilePath, "utf8");
      const parsed = JSON.parse(content);
      return typeof parsed.activeUsername === "string" && parsed.activeUsername.trim() ? parsed.activeUsername : void 0;
    } catch {
      return void 0;
    }
  }
  writeToDisk() {
    const directoryPath = (0, import_node_path3.dirname)(this.stateFilePath);
    (0, import_node_fs.mkdirSync)(directoryPath, { recursive: true });
    const state = this.activeUsername ? { activeUsername: this.activeUsername } : {};
    const tempPath = `${this.stateFilePath}.tmp`;
    (0, import_node_fs.writeFileSync)(tempPath, JSON.stringify(state, null, 2), "utf8");
    (0, import_node_fs.renameSync)(tempPath, this.stateFilePath);
  }
  clearFromDisk() {
    if (!(0, import_node_fs.existsSync)(this.stateFilePath)) {
      return;
    }
    try {
      (0, import_node_fs.unlinkSync)(this.stateFilePath);
    } catch {
    }
  }
};
function resolveDefaultStateFilePath() {
  return (0, import_node_path3.join)(resolveConfigRoot(), "mavmeta", "active-org-state.json");
}
function resolveConfigRoot() {
  if (process.platform === "darwin") {
    return (0, import_node_path3.join)((0, import_node_os.homedir)(), "Library", "Application Support");
  }
  if (process.platform === "win32") {
    return process.env.APPDATA ?? (0, import_node_path3.join)((0, import_node_os.homedir)(), "AppData", "Roaming");
  }
  return process.env.XDG_CONFIG_HOME ?? (0, import_node_path3.join)((0, import_node_os.homedir)(), ".config");
}

// src/server/system-browser.ts
var import_node_child_process = require("node:child_process");
async function openInSystemBrowser(url, spawnProcess = import_node_child_process.spawn) {
  const command = getOpenCommand(url);
  await new Promise((resolve2, reject) => {
    const process2 = spawnProcess(command[0], command.slice(1), {
      stdio: "ignore",
      detached: true
    });
    process2.once("error", reject);
    process2.once("spawn", resolve2);
    process2.unref();
  });
}
function getOpenCommand(url) {
  if (process.platform === "darwin") {
    return ["open", url];
  }
  if (process.platform === "win32") {
    return ["cmd", "/c", "start", "", url];
  }
  return ["xdg-open", url];
}

// src/server/org-service.ts
var OrgService = class {
  constructor(activeOrgStore = new ActiveOrgStore(), options) {
    this.activeOrgStore = activeOrgStore;
    this.trialExpirationCacheTtlMs = options?.trialExpirationCacheTtlMs ?? 5 * 60 * 1e3;
  }
  activeOrgStore;
  trialExpirationCache = /* @__PURE__ */ new Map();
  trialExpirationInflight = /* @__PURE__ */ new Map();
  trialExpirationCacheTtlMs;
  async listOrgs() {
    const authorizations = await import_core5.AuthInfo.listAllAuthorizations();
    const orgs = (await Promise.all(
      authorizations.map((authorization) => this.toOrgSummary(authorization))
    )).sort(
      (left, right) => (left.alias ?? left.username).localeCompare(right.alias ?? right.username)
    );
    const activeUsername = this.resolveActiveUsername(orgs);
    const activeOrg = activeUsername ? orgs.find((org) => org.username === activeUsername) : void 0;
    return {
      orgs,
      activeOrg
    };
  }
  async setActiveOrg(target) {
    const authInfo = await import_core5.AuthInfo.create({ username: target.username });
    const username = authInfo.getUsername();
    this.activeOrgStore.setActiveUsername(username);
    return {
      org: await this.getOrg(username),
      message: `${username} is now active in MavMeta.`
    };
  }
  async authOrg(request) {
    return this.runOauth({
      loginUrl: request.loginUrl,
      alias: request.alias
    });
  }
  async reauthOrg(target) {
    const existingAuth = await import_core5.AuthInfo.create({ username: target.username });
    const fields = existingAuth.getFields();
    return this.runOauth({
      loginUrl: fields.loginUrl ?? fields.instanceUrl,
      usernameHint: target.username,
      alias: fields.alias
    });
  }
  async openOrg(target) {
    const org = await import_core5.Org.create({ aliasOrUsername: target.username });
    const frontDoorUrl = await org.getFrontDoorUrl();
    const urlToOpen = withStartPath(frontDoorUrl, target.startPath);
    await openInSystemBrowser(urlToOpen);
    return {
      org: await this.getOrg(target.username),
      message: `${target.username} opened in your browser.`
    };
  }
  async logoutOrg(target) {
    const remover = await import_core5.AuthRemover.create();
    await remover.removeAuth(target.username);
    if (this.activeOrgStore.getActiveUsername() === target.username) {
      this.activeOrgStore.clear();
    }
    return {
      message: `${target.username} was removed from local Salesforce auth.`
    };
  }
  async setAlias(request) {
    const authInfo = await import_core5.AuthInfo.create({ username: request.target.username });
    await authInfo.setAlias(request.alias);
    return {
      org: await this.getOrg(request.target.username),
      message: `Alias "${request.alias}" set for ${request.target.username}.`
    };
  }
  async refreshOrgStatus(target) {
    const org = await import_core5.Org.create({ aliasOrUsername: target.username });
    await org.refreshAuth();
    await org.updateLocalInformation();
    return {
      org: await this.getOrg(target.username),
      message: `${target.username} auth status refreshed.`
    };
  }
  async deleteScratchOrg(target) {
    const org = await import_core5.Org.create({ aliasOrUsername: target.username });
    const isScratch = await org.determineIfScratch();
    if (!isScratch) {
      throw new Error(
        `Only scratch orgs can be deleted. ${target.username} is not a scratch org.`
      );
    }
    await org.delete();
    if (this.activeOrgStore.getActiveUsername() === target.username) {
      this.activeOrgStore.clear();
    }
    return {
      message: `Scratch org ${target.username} was deleted.`
    };
  }
  async getOrg(username) {
    const response = await this.listOrgs();
    const org = response.orgs.find((candidate) => candidate.username === username);
    if (!org) {
      throw new Error(`No Salesforce auth found for ${username}.`);
    }
    return org;
  }
  async runOauth(options) {
    const oauthServer = await import_core5.WebOAuthServer.create({
      oauthConfig: {
        loginUrl: normalizeLoginUrl(options.loginUrl ?? "")
      }
    });
    await oauthServer.start();
    await openInSystemBrowser(oauthServer.getAuthorizationUrl());
    const authInfo = await oauthServer.authorizeAndSave();
    if (options.alias?.trim()) {
      await authInfo.setAlias(options.alias.trim());
    }
    const username = authInfo.getUsername();
    this.activeOrgStore.setActiveUsername(username);
    const messagePrefix = options.usernameHint ? `${options.usernameHint} reauthorized as ${username}` : `${username} authenticated`;
    return {
      org: await this.getOrg(username),
      message: `${messagePrefix}.`
    };
  }
  resolveActiveUsername(orgs) {
    const activeUsername = this.activeOrgStore.getActiveUsername();
    if (activeUsername && orgs.some((org) => org.username === activeUsername)) {
      return activeUsername;
    }
    if (activeUsername) {
      this.activeOrgStore.clear();
    }
    const defaultOrg = orgs.find((org) => org.isDefault);
    if (defaultOrg) {
      this.activeOrgStore.setActiveUsername(defaultOrg.username);
      return defaultOrg.username;
    }
    return orgs[0]?.username;
  }
  async toOrgSummary(authorization) {
    if (!authorization.isScratchOrg) {
      return toOrgSummary(authorization);
    }
    const trialExpirationDate = await this.lookupTrialExpirationDate(authorization.username);
    return toOrgSummary(authorization, trialExpirationDate);
  }
  async lookupTrialExpirationDate(username) {
    const now = Date.now();
    const cached = this.trialExpirationCache.get(username);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    const inflight = this.trialExpirationInflight.get(username);
    if (inflight) {
      return inflight;
    }
    const fetchPromise = (async () => {
      try {
        const org = await import_core5.Org.create({ aliasOrUsername: username });
        const connection = org.getConnection();
        const response = await connection.query(
          "SELECT TrialExpirationDate FROM Organization"
        );
        const value = response.records?.[0]?.TrialExpirationDate;
        const normalized = typeof value === "string" && value.trim() ? value : void 0;
        this.trialExpirationCache.set(username, {
          value: normalized,
          expiresAt: Date.now() + this.trialExpirationCacheTtlMs
        });
        return normalized;
      } catch {
        this.trialExpirationCache.set(username, {
          value: void 0,
          expiresAt: Date.now() + this.trialExpirationCacheTtlMs
        });
        return void 0;
      } finally {
        this.trialExpirationInflight.delete(username);
      }
    })();
    this.trialExpirationInflight.set(username, fetchPromise);
    return fetchPromise;
  }
};
function toOrgSummary(authorization, trialExpirationDate) {
  return {
    alias: authorization.aliases?.[0] ?? void 0,
    username: authorization.username,
    orgId: authorization.orgId,
    instanceUrl: authorization.instanceUrl,
    ...trialExpirationDate ? { trialExpirationDate } : {},
    environment: authorization.isScratchOrg ? "scratch" : authorization.isSandbox ? "sandbox" : authorization.isDevHub ? "developer" : "production",
    isDefault: authorization.configs?.includes("target-org") === true || authorization.configs?.includes("defaultusername") === true,
    authStatus: authorization.isExpired === true ? "expired" : authorization.isExpired === false ? "connected" : "unknown"
  };
}
function normalizeLoginUrl(loginUrl) {
  const trimmedLoginUrl = loginUrl.trim();
  if (!trimmedLoginUrl) {
    return "https://login.salesforce.com";
  }
  if (trimmedLoginUrl.startsWith("http://") || trimmedLoginUrl.startsWith("https://")) {
    return trimmedLoginUrl;
  }
  return `https://${trimmedLoginUrl}`;
}
function withStartPath(frontDoorUrl, startPath) {
  if (!startPath) return frontDoorUrl;
  const trimmedPath = startPath.trim();
  if (!trimmedPath.startsWith("/")) return frontDoorUrl;
  const url = new URL(frontDoorUrl);
  url.searchParams.set("retURL", trimmedPath);
  return url.toString();
}

// src/server/rest-service.ts
var import_core6 = require("@salesforce/core");

// src/server/salesforce-host.ts
var ALLOWED_SALESFORCE_HOST_SUFFIXES = [
  ".salesforce.com",
  ".force.com",
  ".lightning.force.com",
  ".salesforce-setup.com",
  ".cloudforce.com"
];
function assertSalesforceHost(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ApiError(
      400,
      "INVALID_SALESFORCE_HOST",
      "Salesforce instance URL is invalid."
    );
  }
  if (parsed.protocol !== "https:") {
    throw new ApiError(
      400,
      "INVALID_SALESFORCE_HOST",
      "Salesforce instance URL must use HTTPS."
    );
  }
  const hostname = parsed.hostname.toLowerCase();
  const isAllowed = ALLOWED_SALESFORCE_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix)
  );
  if (!isAllowed) {
    throw new ApiError(
      400,
      "INVALID_SALESFORCE_HOST",
      "Salesforce instance URL host is not allowed."
    );
  }
}

// src/server/rest-service.ts
var RestService = class {
  connectionFactory;
  fetcher;
  constructor(options = {}) {
    this.connectionFactory = options.connectionFactory ?? createConnection3;
    this.fetcher = options.fetcher ?? fetch;
  }
  async executeRequest(request) {
    if (!request.path.startsWith("/services/")) {
      throw new ApiError(400, "INVALID_PATH", 'Path must start with "/services/".');
    }
    const connection = await this.connectionFactory(request.username);
    assertSalesforceHost(connection.instanceUrl);
    const url = `${connection.instanceUrl}${request.path}`;
    const headers = {
      Authorization: `Bearer ${connection.accessToken ?? ""}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...request.headers
    };
    const start = Date.now();
    const response = await this.fetcher(url, {
      method: request.method,
      headers,
      body: request.body
    });
    const durationMs = Date.now() - start;
    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    let body;
    let isJson = false;
    if (contentType.includes("application/json")) {
      try {
        body = JSON.parse(text);
        isJson = true;
      } catch {
        body = text;
      }
    } else {
      body = text;
    }
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    return { status: response.status, headers: responseHeaders, body, isJson, durationMs };
  }
};
async function createConnection3(username) {
  const org = await import_core6.Org.create({ aliasOrUsername: username });
  return org.getConnection();
}

// src/server/scratch-org-service.ts
var import_node_crypto2 = require("node:crypto");
var import_core7 = require("@salesforce/core");
var DEFAULT_COMPLETED_OPERATION_TTL_MS2 = 10 * 60 * 1e3;
var SNAPSHOT_ELIGIBILITY_QUERY = "SELECT count() FROM OrgSnapshot LIMIT 1";
var SNAPSHOT_LIST_QUERY = "SELECT Id, SnapshotName, Content, Status, ExpirationDate, CreatedDate, SourceOrg FROM OrgSnapshot ORDER BY CreatedDate DESC LIMIT 200";
var ScratchOrgService = class {
  operations = /* @__PURE__ */ new Map();
  uuidFactory;
  now;
  completedOperationTtlMs;
  scratchOrgCreateFn;
  orgFactory;
  authInfoFactory;
  constructor(options = {}) {
    this.uuidFactory = options.uuidFactory ?? import_node_crypto2.randomUUID;
    this.now = options.now ?? Date.now;
    this.completedOperationTtlMs = options.completedOperationTtlMs ?? DEFAULT_COMPLETED_OPERATION_TTL_MS2;
    this.scratchOrgCreateFn = options.scratchOrgCreateFn ?? (async (hubOrg, orgConfig, durationDays) => {
      const result = await (0, import_core7.scratchOrgCreate)({ hubOrg, orgConfig, durationDays });
      return { username: result.username, warnings: result.warnings };
    });
    this.orgFactory = options.orgFactory ?? ((username) => import_core7.Org.create({ aliasOrUsername: username }));
    this.authInfoFactory = options.authInfoFactory ?? ((username) => import_core7.AuthInfo.create({ username }));
  }
  async startCreate(request) {
    this.pruneCompletedOperations();
    const operationId = this.uuidFactory();
    const operation = {
      id: operationId,
      status: "pending",
      message: "Preparing to create scratch org..."
    };
    this.operations.set(operationId, operation);
    void this.runCreate(operation, request);
    return { operationId };
  }
  async getStatus(operationId) {
    const operation = this.operations.get(operationId);
    if (!operation) {
      throw new ApiError(404, "NOT_FOUND", `No scratch org create operation found with id "${operationId}".`);
    }
    return {
      operationId: operation.id,
      status: operation.status,
      message: operation.message,
      username: operation.username,
      warnings: operation.warnings
    };
  }
  async listSnapshots(devHubUsername) {
    const hubOrg = await this.orgFactory(devHubUsername);
    const connection = await this.readConnection(hubOrg);
    try {
      await connection.tooling.query(SNAPSHOT_ELIGIBILITY_QUERY);
    } catch (error) {
      if (this.isSnapshotsNotEnabledError(error)) {
        return {
          eligibility: "not-enabled",
          snapshots: []
        };
      }
      throw error;
    }
    const response = await connection.tooling.query(SNAPSHOT_LIST_QUERY);
    const records = Array.isArray(response.records) ? response.records : [];
    return {
      eligibility: "enabled",
      snapshots: records.map((record) => this.mapOrgSnapshot(record)).filter((snapshot) => snapshot !== void 0)
    };
  }
  async runCreate(operation, request) {
    operation.status = "running";
    operation.message = "Creating scratch org...";
    try {
      const hubOrg = await this.orgFactory(request.devHubUsername);
      const result = await this.scratchOrgCreateFn(hubOrg, request.definition, request.durationDays);
      if (request.alias?.trim() && result.username) {
        const authInfo = await this.authInfoFactory(result.username);
        await authInfo.setAlias(request.alias.trim());
      }
      operation.username = result.username;
      operation.warnings = result.warnings;
      operation.status = "succeeded";
      operation.message = result.username ? `Scratch org ${result.username} created successfully.` : "Scratch org created successfully.";
    } catch (error) {
      operation.status = "failed";
      operation.message = error instanceof Error ? redactSecrets(error.message) : "Scratch org creation failed.";
    } finally {
      operation.completedAt = this.now();
    }
  }
  pruneCompletedOperations() {
    const cutoff = this.now() - this.completedOperationTtlMs;
    for (const [id, operation] of this.operations) {
      if (operation.completedAt !== void 0 && operation.completedAt < cutoff) {
        this.operations.delete(id);
      }
    }
  }
  async readConnection(hubOrg) {
    const getConnection = hubOrg.getConnection;
    if (typeof getConnection === "function") {
      const connection2 = await getConnection.call(hubOrg);
      if (typeof connection2?.tooling?.query === "function") {
        return connection2;
      }
    }
    const connection = hubOrg.connection;
    if (typeof connection?.tooling?.query !== "function") {
      throw new ApiError(500, "INTERNAL_ERROR", "Salesforce Tooling API is unavailable for this org.");
    }
    return connection;
  }
  isSnapshotsNotEnabledError(error) {
    const details = this.readToolingErrorDetails(error);
    if (details.errorCode === "INVALID_TYPE" && details.message.includes("orgsnapshot")) {
      return true;
    }
    return details.message.includes("sobject type 'orgsnapshot' is not supported");
  }
  mapOrgSnapshot(record) {
    const id = this.readOptionalString(record.Id);
    const snapshotName = this.readOptionalString(record.SnapshotName);
    const createdDate = this.readOptionalString(record.CreatedDate);
    if (!id || !snapshotName || !createdDate) {
      return void 0;
    }
    return {
      id,
      snapshotName,
      description: this.readOptionalString(record.Content),
      status: this.readOptionalString(record.Status) ?? "Unknown",
      expirationDate: this.readOptionalString(record.ExpirationDate),
      createdDate,
      sourceOrgId: this.readOptionalString(record.SourceOrg)
    };
  }
  readOptionalString(value) {
    return typeof value === "string" && value.trim() !== "" ? value : void 0;
  }
  readToolingErrorDetails(error) {
    if (!error || typeof error !== "object") {
      return { message: "" };
    }
    const objectError = error;
    const message = typeof objectError.message === "string" ? objectError.message.toLowerCase() : "";
    const errorCode = typeof objectError.errorCode === "string" ? objectError.errorCode : void 0;
    const firstDataError = Array.isArray(objectError.data) && objectError.data.length > 0 ? objectError.data[0] : void 0;
    const dataMessage = typeof firstDataError?.message === "string" ? firstDataError.message.toLowerCase() : "";
    const dataErrorCode = typeof firstDataError?.errorCode === "string" ? firstDataError.errorCode : void 0;
    return {
      errorCode: errorCode ?? dataErrorCode,
      message: dataMessage || message
    };
  }
};

// src/server/app.ts
var SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; connect-src 'self' https://*.salesforce.com https://*.force.com https://*.lightning.force.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "geolocation=(), microphone=(), camera=(), payment=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin"
};
function createApp(options = {}) {
  const app2 = (0, import_fastify.default)({
    logger: true
  });
  const orgService = options.orgService ?? new OrgService();
  const metadataService = options.metadataService ?? new MetadataService();
  const objectExplorerService = options.objectExplorerService ?? new ObjectExplorerService();
  const deployService = options.deployService ?? new DeployService();
  const restService = options.restService ?? new RestService();
  const scratchOrgService = options.scratchOrgService ?? new ScratchOrgService();
  const lwcService = options.lwcService ?? new LwcService();
  const sessionToken = options.sessionToken ?? (0, import_node_crypto3.randomBytes)(32).toString("hex");
  const allowDevSessionBootstrap = options.allowDevSessionBootstrap === true;
  const configuredHostAllowlist = new Set(
    options.hostAllowlist?.map((host2) => host2.toLowerCase()) ?? []
  );
  const configuredOriginAllowlist = new Set(options.originAllowlist ?? []);
  const tokenBuffer = Buffer.from(sessionToken, "utf8");
  app2.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      const allowedMethods = /* @__PURE__ */ new Set(["GET", "POST", "OPTIONS"]);
      if (!allowedMethods.has(request.method)) {
        reply.code(405).send({
          code: "METHOD_NOT_ALLOWED",
          message: "HTTP method is not allowed for API routes."
        });
        return;
      }
    }
    const hostHeader = request.headers.host?.toLowerCase();
    const allowedHosts = getAllowedHosts(app2, configuredHostAllowlist);
    if (!hostHeader || !allowedHosts.has(hostHeader)) {
      reply.code(403).send({ code: "INVALID_HOST", message: "Host header is not allowed." });
      return;
    }
    const originHeader = request.headers.origin;
    const allowedOrigins = getAllowedOrigins(app2, configuredOriginAllowlist);
    if (originHeader && !allowedOrigins.has(originHeader)) {
      reply.code(403).send({ code: "INVALID_ORIGIN", message: "Origin is not allowed." });
      return;
    }
    if (!request.url.startsWith("/api/")) {
      return;
    }
    if (allowDevSessionBootstrap && request.method === "GET" && request.url === "/api/session") {
      if (originHeader && !allowedOrigins.has(originHeader)) {
        reply.code(403).send({ code: "INVALID_ORIGIN", message: "Origin is not allowed." });
        return;
      }
      return;
    }
    if (!hasMatchingSessionToken(request.headers["x-mavmeta-session"], tokenBuffer)) {
      reply.code(401).send({ code: "INVALID_SESSION", message: "Invalid or missing session token." });
      return;
    }
  });
  app2.addHook("onSend", async (request, reply, payload) => {
    reply.header("vary", "Origin");
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      reply.header(key, value);
    }
    const originHeader = request.headers.origin;
    const allowedOrigins = getAllowedOrigins(app2, configuredOriginAllowlist);
    if (originHeader && allowedOrigins.has(originHeader)) {
      reply.header("access-control-allow-origin", originHeader);
      reply.header("access-control-allow-headers", "content-type, x-mavmeta-session");
      reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
    }
    return payload;
  });
  app2.options("/api/*", async (request, reply) => {
    const originHeader = request.headers.origin;
    const allowedOrigins = getAllowedOrigins(app2, configuredOriginAllowlist);
    if (originHeader && allowedOrigins.has(originHeader)) {
      reply.header("access-control-allow-origin", originHeader);
      reply.header("access-control-allow-headers", "content-type, x-mavmeta-session");
      reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
    }
    reply.code(204).send();
  });
  if (allowDevSessionBootstrap) {
    app2.get("/api/session", async (request, reply) => {
      const bootstrapHeader = request.headers["x-mavmeta-bootstrap"];
      if (bootstrapHeader !== "1") {
        reply.code(400).send({
          code: "INVALID_BOOTSTRAP",
          message: "Missing required bootstrap header."
        });
        return;
      }
      reply.send({ token: sessionToken });
    });
  }
  app2.setErrorHandler((error, request, reply) => {
    const statusCode = error instanceof ApiError ? error.statusCode : Number.isInteger(error.statusCode) ? error.statusCode ?? 500 : 500;
    const payload = {
      code: error instanceof ApiError ? error.code : "INTERNAL_ERROR",
      message: error instanceof Error ? redactSecrets(error.message) : "Unexpected backend failure."
    };
    if (statusCode >= 500) {
      const safeErrorMessage = error instanceof Error ? redactSecrets(error.message) : "Unexpected backend failure.";
      request.log.error({ err: { message: safeErrorMessage } }, "Internal server error");
    }
    reply.status(statusCode).send(payload);
  });
  app2.get("/api/health", async () => ({ status: "ok" }));
  app2.get("/api/orgs", async () => orgService.listOrgs());
  app2.post("/api/orgs/active", async (request) => {
    const target = readOrgTarget(request.body);
    return orgService.setActiveOrg(target);
  });
  app2.post(
    "/api/orgs/auth",
    async (request) => orgService.authOrg(readAuthOrgRequest(request.body))
  );
  app2.post(
    "/api/orgs/reauth",
    async (request) => orgService.reauthOrg(readOrgTarget(request.body))
  );
  app2.post(
    "/api/orgs/open",
    async (request) => orgService.openOrg(readOrgTarget(request.body))
  );
  app2.post(
    "/api/orgs/logout",
    async (request) => orgService.logoutOrg(readOrgTarget(request.body))
  );
  app2.post(
    "/api/orgs/alias",
    async (request) => orgService.setAlias(readSetAliasRequest(request.body))
  );
  app2.post(
    "/api/orgs/refresh",
    async (request) => orgService.refreshOrgStatus(readOrgTarget(request.body))
  );
  app2.post(
    "/api/orgs/delete-scratch",
    async (request) => orgService.deleteScratchOrg(readOrgTarget(request.body))
  );
  app2.post(
    "/api/metadata/types",
    async (request) => metadataService.listMetadataTypes(readListMetadataTypesRequest(request.body))
  );
  app2.post(
    "/api/metadata/components",
    async (request) => metadataService.listMetadataComponents(
      readListMetadataComponentsRequest(request.body)
    )
  );
  app2.post(
    "/api/metadata/component-source",
    async (request) => metadataService.getComponentSource(
      readGetComponentSourceRequest(request.body)
    )
  );
  app2.post(
    "/api/metadata/diff",
    async (request) => metadataService.getCrossOrgComponentDiff(
      readCrossOrgDiffRequest(request.body)
    )
  );
  app2.post(
    "/api/objects/list",
    async (request) => objectExplorerService.listObjects(readOrgTargetRequest(request.body))
  );
  app2.post(
    "/api/objects/children",
    async (request) => objectExplorerService.listObjectChildren(readListObjectChildrenRequest(request.body))
  );
  app2.post(
    "/api/deploy/start",
    async (request) => deployService.startDestructiveDeploy(
      readStartDestructiveDeployRequest(request.body)
    )
  );
  app2.post(
    "/api/deploy/status",
    async (request) => deployService.getDestructiveDeployStatus(
      readDestructiveDeployStatusRequest(request.body).operationId
    )
  );
  app2.post(
    "/api/deploy/cancel",
    async (request) => deployService.cancelDestructiveDeploy(
      readDestructiveDeployStatusRequest(request.body).operationId
    )
  );
  app2.post(
    "/api/deploy/cross-org/start",
    async (request) => deployService.startCrossOrgDeploy(readStartCrossOrgDeployRequest(request.body))
  );
  app2.post(
    "/api/deploy/cross-org/status",
    async (request) => deployService.getCrossOrgDeployStatus(
      readDestructiveDeployStatusRequest(request.body).operationId
    )
  );
  app2.post(
    "/api/deploy/cross-org/cancel",
    async (request) => deployService.cancelCrossOrgDeploy(
      readDestructiveDeployStatusRequest(request.body).operationId
    )
  );
  app2.post(
    "/api/rest/execute",
    async (request) => restService.executeRequest(readRestExecuteRequest(request.body))
  );
  app2.post(
    "/api/lwc/bundles/list",
    async (request) => lwcService.listBundles(readLwcListBundlesRequest(request.body))
  );
  app2.post(
    "/api/lwc/bundles/get",
    async (request) => lwcService.getBundle(readLwcGetBundleRequest(request.body))
  );
  app2.post(
    "/api/lwc/bundles/deploy",
    async (request) => lwcService.deployBundle(readLwcDeployBundleRequest(request.body))
  );
  app2.post(
    "/api/orgs/create-scratch/start",
    async (request) => scratchOrgService.startCreate(readStartScratchOrgCreateRequest(request.body))
  );
  app2.post("/api/orgs/create-scratch/status", async (request) => {
    const { operationId } = readOperationIdRequest(request.body);
    return scratchOrgService.getStatus(operationId);
  });
  app2.get(
    "/api/orgs/snapshots",
    async (request) => scratchOrgService.listSnapshots(readDevHubUsernameFromQuery(request.query))
  );
  if (options.serveStatic) {
    const staticRoot = options.staticRootDir ?? (0, import_node_path4.resolve)(process.cwd(), "dist");
    if ((0, import_node_fs2.existsSync)(staticRoot)) {
      const staticIndexHtml = injectSessionMetaIntoHtml(
        (0, import_node_fs2.readFileSync)((0, import_node_path4.resolve)(staticRoot, "index.html"), "utf8"),
        sessionToken
      );
      void app2.register(import_static.default, {
        root: staticRoot,
        prefix: "/",
        wildcard: false,
        index: false
      });
      app2.get("/*", async (request, reply) => {
        const requestedPath = request.params;
        if (requestedPath["*"].startsWith("api/")) {
          throw new ApiError(404, "NOT_FOUND", "Route not found.");
        }
        return reply.type("text/html; charset=utf-8").send(staticIndexHtml);
      });
    } else {
      app2.log.warn(`Static root "${staticRoot}" does not exist.`);
    }
  }
  return app2;
}
function hasMatchingSessionToken(requestToken, sessionTokenBuffer) {
  if (typeof requestToken !== "string") {
    return false;
  }
  const requestBuffer = Buffer.from(requestToken, "utf8");
  if (requestBuffer.length !== sessionTokenBuffer.length) {
    return false;
  }
  return (0, import_node_crypto3.timingSafeEqual)(requestBuffer, sessionTokenBuffer);
}
function getAllowedHosts(app2, configured) {
  const address = app2.server.address();
  const allowed = new Set(configured);
  if (address && typeof address !== "string") {
    allowed.add(`127.0.0.1:${address.port}`);
    allowed.add(`localhost:${address.port}`);
  }
  return allowed;
}
function getAllowedOrigins(app2, configured) {
  const address = app2.server.address();
  const allowed = new Set(configured);
  if (address && typeof address !== "string") {
    allowed.add(`http://127.0.0.1:${address.port}`);
    allowed.add(`http://localhost:${address.port}`);
  }
  return allowed;
}
function injectSessionMetaIntoHtml(indexHtml, sessionToken) {
  if (indexHtml.includes('name="MavMeta-session"')) {
    return indexHtml;
  }
  if (!indexHtml.includes("</head>")) {
    throw new Error("Static index.html is missing </head>; cannot inject session meta.");
  }
  const metaTag = `<meta name="MavMeta-session" content="${sessionToken}">`;
  return indexHtml.replace("</head>", `  ${metaTag}
  </head>`);
}
function readObjectBody(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(400, "INVALID_BODY", "Request body must be an object.");
  }
  return body;
}
function readStringField3(body, fieldName, options = {}) {
  const value = body[fieldName];
  if (value === void 0 || value === null) {
    if (options.required) {
      throw new ApiError(
        400,
        "INVALID_REQUEST",
        `Missing required field "${fieldName}".`
      );
    }
    return void 0;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      `Field "${fieldName}" must be a non-empty string.`
    );
  }
  return value.trim();
}
function readOrgTarget(body) {
  const objectBody = readObjectBody(body);
  const startPath = readStringField3(objectBody, "startPath");
  if (startPath && !startPath.startsWith("/")) {
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      'Field "startPath" must start with "/".'
    );
  }
  return {
    username: readStringField3(objectBody, "username", { required: true }),
    startPath
  };
}
function readAuthOrgRequest(body) {
  const objectBody = readObjectBody(body);
  return {
    loginUrl: readStringField3(objectBody, "loginUrl", { required: true }) ?? "",
    alias: readStringField3(objectBody, "alias")
  };
}
function readSetAliasRequest(body) {
  const objectBody = readObjectBody(body);
  const targetValue = objectBody.target;
  const targetBody = readObjectBody(targetValue);
  return {
    target: {
      username: readStringField3(targetBody, "username", {
        required: true
      })
    },
    alias: readStringField3(objectBody, "alias", { required: true })
  };
}
function readListMetadataTypesRequest(body) {
  const objectBody = readObjectBody(body);
  const targetBody = readObjectBody(objectBody.target);
  return {
    target: {
      username: readStringField3(targetBody, "username", {
        required: true
      })
    }
  };
}
function readListMetadataComponentsRequest(body) {
  const objectBody = readObjectBody(body);
  const targetBody = readObjectBody(objectBody.target);
  return {
    target: {
      username: readStringField3(targetBody, "username", {
        required: true
      })
    },
    metadataType: readStringField3(objectBody, "metadataType", { required: true }) ?? "",
    folder: readStringField3(objectBody, "folder"),
    search: readStringField3(objectBody, "search")
  };
}
function readStartDestructiveDeployRequest(body) {
  const objectBody = readObjectBody(body);
  const targetBody = readObjectBody(objectBody.target);
  const mode = readStringField3(objectBody, "mode", {
    required: true
  });
  if (mode !== "validate" && mode !== "deploy") {
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      'Field "mode" must be "validate" or "deploy".'
    );
  }
  const componentsValue = objectBody.components;
  if (!Array.isArray(componentsValue)) {
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      'Field "components" must be an array.'
    );
  }
  const components = componentsValue.map((component, index) => {
    const componentBody = readObjectBody(component);
    const metadataType = readStringField3(componentBody, "metadataType", {
      required: true
    });
    const fullName = readStringField3(componentBody, "fullName", {
      required: true
    });
    if (!metadataType || !fullName) {
      throw new ApiError(
        400,
        "INVALID_REQUEST",
        `Component at index ${index} is missing metadataType or fullName.`
      );
    }
    if (!validateMetadataName(fullName)) {
      throw new ApiError(
        400,
        "INVALID_REQUEST",
        `Component at index ${index} has invalid fullName.`
      );
    }
    return {
      metadataType,
      fullName
    };
  });
  return {
    target: {
      username: readStringField3(targetBody, "username", {
        required: true
      })
    },
    mode,
    components
  };
}
function readDestructiveDeployStatusRequest(body) {
  const objectBody = readObjectBody(body);
  return {
    operationId: readStringField3(objectBody, "operationId", {
      required: true
    })
  };
}
function readStartCrossOrgDeployRequest(body) {
  const objectBody = readObjectBody(body);
  const sourceBody = readObjectBody(objectBody.source);
  const targetBody = readObjectBody(objectBody.target);
  const mode = readStringField3(objectBody, "mode", { required: true });
  if (mode !== "validate" && mode !== "deploy") {
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      'Field "mode" must be "validate" or "deploy".'
    );
  }
  const componentsValue = objectBody.components;
  if (!Array.isArray(componentsValue)) {
    throw new ApiError(400, "INVALID_REQUEST", 'Field "components" must be an array.');
  }
  const components = componentsValue.map((component, index) => {
    const componentBody = readObjectBody(component);
    const metadataType = readStringField3(componentBody, "metadataType", {
      required: true
    });
    const fullName = readStringField3(componentBody, "fullName", { required: true });
    if (!metadataType || !fullName) {
      throw new ApiError(
        400,
        "INVALID_REQUEST",
        `Component at index ${index} is missing metadataType or fullName.`
      );
    }
    if (!validateMetadataName(fullName)) {
      throw new ApiError(
        400,
        "INVALID_REQUEST",
        `Component at index ${index} has invalid fullName.`
      );
    }
    return { metadataType, fullName };
  });
  return {
    source: {
      username: readStringField3(sourceBody, "username", { required: true })
    },
    target: {
      username: readStringField3(targetBody, "username", { required: true })
    },
    mode,
    components
  };
}
function readRestExecuteRequest(body) {
  const objectBody = readObjectBody(body);
  const username = readStringField3(objectBody, "username", { required: true });
  const methodRaw = readStringField3(objectBody, "method", { required: true });
  const path4 = readStringField3(objectBody, "path", { required: true });
  if (!["GET", "POST", "PATCH", "DELETE"].includes(methodRaw)) {
    throw new ApiError(400, "INVALID_REQUEST", 'Field "method" must be GET, POST, PATCH, or DELETE.');
  }
  const method = methodRaw;
  const bodyText = readStringField3(objectBody, "body");
  const headersValue = objectBody.headers;
  let headers;
  if (headersValue !== void 0 && headersValue !== null) {
    if (typeof headersValue !== "object" || Array.isArray(headersValue)) {
      throw new ApiError(400, "INVALID_REQUEST", 'Field "headers" must be an object.');
    }
    headers = headersValue;
  }
  return { username, method, path: path4, headers, body: bodyText };
}
function readStartScratchOrgCreateRequest(body) {
  const objectBody = readObjectBody(body);
  const devHubUsername = readStringField3(objectBody, "devHubUsername", { required: true });
  const alias = readStringField3(objectBody, "alias");
  const durationDaysRaw = objectBody.durationDays;
  if (typeof durationDaysRaw !== "number" || !Number.isInteger(durationDaysRaw)) {
    throw new ApiError(400, "INVALID_REQUEST", 'Field "durationDays" must be an integer.');
  }
  const definitionValue = objectBody.definition;
  if (typeof definitionValue !== "object" || definitionValue === null || Array.isArray(definitionValue)) {
    throw new ApiError(400, "INVALID_REQUEST", 'Field "definition" must be an object.');
  }
  return {
    devHubUsername,
    definition: definitionValue,
    alias,
    durationDays: durationDaysRaw
  };
}
function readOperationIdRequest(body) {
  const objectBody = readObjectBody(body);
  return {
    operationId: readStringField3(objectBody, "operationId", { required: true })
  };
}
function readDevHubUsernameFromQuery(query) {
  const queryBody = readObjectBody(query);
  return readStringField3(queryBody, "devHub", { required: true });
}
function readGetComponentSourceRequest(body) {
  const objectBody = readObjectBody(body);
  const targetBody = readObjectBody(objectBody.target);
  return {
    target: {
      username: readStringField3(targetBody, "username", {
        required: true
      })
    },
    metadataType: readStringField3(objectBody, "metadataType", { required: true }),
    fullName: readStringField3(objectBody, "fullName", { required: true }),
    fileName: readStringField3(objectBody, "fileName"),
    folder: readStringField3(objectBody, "folder")
  };
}
function readOrgTargetRequest(body) {
  const objectBody = readObjectBody(body);
  const targetBody = readObjectBody(objectBody.target);
  return {
    target: {
      username: readStringField3(targetBody, "username", { required: true })
    }
  };
}
function readCrossOrgDiffRequest(body) {
  const objectBody = readObjectBody(body);
  const sourceBody = readObjectBody(objectBody.source);
  const targetBody = readObjectBody(objectBody.target);
  const componentsRaw = objectBody.components;
  if (!Array.isArray(componentsRaw)) {
    throw new ApiError(400, "INVALID_REQUEST", 'Field "components" must be an array.');
  }
  return {
    source: {
      username: readStringField3(sourceBody, "username", { required: true })
    },
    target: {
      username: readStringField3(targetBody, "username", { required: true })
    },
    components: componentsRaw.map((component) => {
      const componentBody = readObjectBody(component);
      return {
        metadataType: readStringField3(componentBody, "metadataType", { required: true }),
        fullName: readStringField3(componentBody, "fullName", { required: true }),
        fileName: readStringField3(componentBody, "fileName"),
        folder: readStringField3(componentBody, "folder")
      };
    })
  };
}
function readListObjectChildrenRequest(body) {
  const objectBody = readObjectBody(body);
  const targetBody = readObjectBody(objectBody.target);
  return {
    target: {
      username: readStringField3(targetBody, "username", { required: true })
    },
    objectApiName: readStringField3(objectBody, "objectApiName", { required: true })
  };
}
function readLwcListBundlesRequest(body) {
  const objectBody = readObjectBody(body);
  return {
    orgUsername: readStringField3(objectBody, "orgUsername", { required: true })
  };
}
function readLwcGetBundleRequest(body) {
  const objectBody = readObjectBody(body);
  return {
    orgUsername: readStringField3(objectBody, "orgUsername", { required: true }),
    bundleId: readStringField3(objectBody, "bundleId", { required: true })
  };
}
function readLwcDeployBundleRequest(body) {
  const objectBody = readObjectBody(body);
  const orgUsername = readStringField3(objectBody, "orgUsername", { required: true });
  const bundleId = readStringField3(objectBody, "bundleId", { required: true });
  const expectedLastModifiedDate = readStringField3(objectBody, "expectedLastModifiedDate", {
    required: true
  });
  const forceRaw = objectBody.force;
  const force = forceRaw === true;
  const filesRaw = objectBody.files;
  if (!Array.isArray(filesRaw)) {
    throw new ApiError(400, "INVALID_REQUEST", 'Field "files" must be an array.');
  }
  const files = filesRaw.map((item, index) => {
    const fileBody = readObjectBody(item);
    const path4 = readStringField3(fileBody, "path", { required: true });
    if (!path4) {
      throw new ApiError(400, "INVALID_REQUEST", `files[${index}] is missing path.`);
    }
    const sourceRaw = fileBody.source;
    if (typeof sourceRaw !== "string") {
      throw new ApiError(400, "INVALID_REQUEST", `files[${index}].source must be a string.`);
    }
    return { path: path4, source: sourceRaw };
  });
  return { orgUsername, bundleId, files, expectedLastModifiedDate, force };
}

// src/server/auth-file-write-guard.ts
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_promises = __toESM(require("node:fs/promises"), 1);
var import_node_os2 = __toESM(require("node:os"), 1);
var import_node_path5 = __toESM(require("node:path"), 1);
var PROTECTED_ROOTS = [
  import_node_path5.default.resolve(import_node_os2.default.homedir(), ".sf"),
  import_node_path5.default.resolve(import_node_os2.default.homedir(), ".sfdx")
];
var WRITE_FLAG_PATTERN = /[wa+]/;
var MAX_WARNED_PATHS = 256;
var warnedPaths = /* @__PURE__ */ new Set();
function installAuthFileWriteGuard(options = {}) {
  const mode = options.mode ?? "block";
  const originalOpen = import_node_fs3.default.open;
  import_node_fs3.default.open = (filePath, flags, ...rest) => {
    assertWriteAllowed(filePath, flags, mode);
    return originalOpen(filePath, flags, ...rest);
  };
  const originalWriteFile = import_node_fs3.default.writeFile;
  import_node_fs3.default.writeFile = (filePath, data, ...rest) => {
    assertWriteAllowed(filePath, "w", mode);
    return originalWriteFile(filePath, data, ...rest);
  };
  const originalAppendFile = import_node_fs3.default.appendFile;
  import_node_fs3.default.appendFile = (filePath, data, ...rest) => {
    assertWriteAllowed(filePath, "a", mode);
    return originalAppendFile(filePath, data, ...rest);
  };
  const originalPromisesOpen = import_promises.default.open.bind(import_promises.default);
  import_promises.default.open = async (filePath, flags = "r", fileMode) => {
    assertWriteAllowed(filePath, flags, mode);
    return originalPromisesOpen(filePath, flags, fileMode);
  };
  const originalPromisesWriteFile = import_promises.default.writeFile.bind(import_promises.default);
  import_promises.default.writeFile = async (filePath, data, options2) => {
    assertWriteAllowed(filePath, "w", mode);
    return originalPromisesWriteFile(filePath, data, options2);
  };
  const originalPromisesAppendFile = import_promises.default.appendFile.bind(import_promises.default);
  import_promises.default.appendFile = async (filePath, data, options2) => {
    assertWriteAllowed(filePath, "a", mode);
    return originalPromisesAppendFile(filePath, data, options2);
  };
}
function assertWriteAllowed(filePath, flags, mode = "block") {
  if (typeof flags === "number") {
    return;
  }
  if (typeof flags !== "string" || !WRITE_FLAG_PATTERN.test(flags)) {
    return;
  }
  if (typeof filePath !== "string") {
    return;
  }
  const resolvedPath = import_node_path5.default.resolve(filePath);
  const isProtected = PROTECTED_ROOTS.some(
    (root) => resolvedPath === root || resolvedPath.startsWith(`${root}${import_node_path5.default.sep}`)
  );
  if (isProtected) {
    const message = `Write access to Salesforce auth path is forbidden: ${resolvedPath}`;
    if (mode === "warn") {
      if (!warnedPaths.has(resolvedPath)) {
        if (warnedPaths.size >= MAX_WARNED_PATHS) {
          warnedPaths.clear();
        }
        warnedPaths.add(resolvedPath);
        console.warn(message);
      }
      return;
    }
    throw new Error(message);
  }
}

// src/server/startup-browser.ts
async function maybeOpenStaticBrowser({
  shouldServeStatic: shouldServeStatic2,
  url,
  log,
  openBrowser = openInSystemBrowser
}) {
  if (!shouldServeStatic2) {
    return;
  }
  log.info(`Opening MavMeta at ${url}`);
  try {
    await openBrowser(url);
  } catch {
    log.warn(`Could not open browser automatically. Visit ${url} manually.`);
  }
}

// src/server/index.ts
var host = process.env.MAVMETA_HOST ?? "127.0.0.1";
var hasExplicitPort = process.env.MAVMETA_PORT !== void 0;
var shouldServeStatic = process.argv.includes("--serve-static") || process.env.MAVMETA_SERVE_STATIC === "1";
var webPort = parsePort(
  process.env.MAVMETA_WEB_PORT ?? "5173",
  "MAVMETA_WEB_PORT"
);
var port = parsePort(
  process.env.MAVMETA_PORT ?? (shouldServeStatic ? "0" : "8787"),
  "MAVMETA_PORT"
);
if (!isLoopbackHost(host)) {
  throw new Error(`MAVMETA_HOST must be loopback-only. Received "${host}".`);
}
var app = createApp({
  serveStatic: shouldServeStatic,
  allowDevSessionBootstrap: !shouldServeStatic,
  hostAllowlist: shouldServeStatic ? [] : [`127.0.0.1:${webPort}`, `localhost:${webPort}`],
  originAllowlist: shouldServeStatic ? [] : [`http://127.0.0.1:${webPort}`, `http://localhost:${webPort}`]
});
installAuthFileWriteGuard({
  mode: parseAuthWriteGuardMode(process.env.MAVMETA_AUTH_WRITE_GUARD_MODE)
});
async function main() {
  await app.listen({ host, port });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }
  app.log.info(
    `MavMeta backend listening on http://${host}:${address.port} (${hasExplicitPort ? "configured" : "ephemeral"} port)`
  );
  if (shouldServeStatic) {
    app.log.info("Static frontend serving is enabled.");
  }
  await maybeOpenStaticBrowser({
    shouldServeStatic,
    url: `http://${host}:${address.port}`,
    log: app.log
  });
}
main().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
function isLoopbackHost(value) {
  const normalized = value.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}
function parsePort(value, name) {
  const port2 = Number(value);
  if (!Number.isInteger(port2) || port2 < 0 || port2 > 65535) {
    throw new Error(`${name} must be an integer between 0 and 65535. Received "${value}".`);
  }
  return port2;
}
function parseAuthWriteGuardMode(value) {
  if (value === void 0 || value.trim() === "") {
    return "warn";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "warn" || normalized === "block") {
    return normalized;
  }
  throw new Error(
    `MAVMETA_AUTH_WRITE_GUARD_MODE must be "warn" or "block". Received "${value}".`
  );
}
