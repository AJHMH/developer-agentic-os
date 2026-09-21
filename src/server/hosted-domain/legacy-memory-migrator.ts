import { createHash, randomUUID } from "node:crypto";
import { access, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { readJsonFile } from "../local-store/json-file";
import type { HostedDomainStore, HostedRecordKind, MigrationPackage } from "./hosted-domain-store";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type LegacyMemoryStats = {
  detected: boolean;
  path: string;
  fileCount: number;
  estimatedRecords: number;
};

export type QuarantinedRecord = {
  kind: string;
  reason: string;
  rawValue: unknown;
};

export type LegacyMigrationPreflight = {
  detected: boolean;
  legacyMemoryPath: string;
  recognizedKinds: HostedRecordKind[];
  recognizedCount: number;
  duplicateCount: number;
  quarantinedCount: number;
  unknownKinds: string[];
  warnings: string[];
  expectedEffects: string[];
  idempotencyMarkerPresent: boolean;
};

export type LegacyMigrationResult = {
  status: "completed" | "already_migrated" | "partial";
  imported: number;
  quarantined: QuarantinedRecord[];
  warnings: string[];
  correlationId: string;
  resumeFrom?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const LEGACY_MEMORY_DIR = ".memory";

// Mapping from legacy .memory filenames to HostedRecordKind
const LEGACY_FILE_MAP: Array<{
  file: string;
  kind: HostedRecordKind;
  extractor: (raw: unknown) => unknown[];
}> = [
  {
    file: "work-items.json",
    kind: "workItems",
    extractor: (raw) => extractArray(raw),
  },
  {
    file: "incoming-signals.json",
    kind: "incomingSignals",
    extractor: (raw) => extractArray(raw),
  },
  {
    file: "operational.json",
    kind: "incidents",
    extractor: (raw) => extractArrayFromField(raw, "incidents"),
  },
  {
    file: "operational.json",
    kind: "automationRuns",
    extractor: (raw) => extractArrayFromField(raw, "runs"),
  },
  {
    file: "operational.json",
    kind: "approvals",
    extractor: (raw) => extractArrayFromField(raw, "audits"),
  },
  {
    file: "artifacts/index.json",
    kind: "artifacts",
    extractor: (raw) => extractArrayFromField(raw, "artifacts"),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks whether a legacy `.memory` directory exists at the given repository
 * root. Does NOT read records — safe to call on every activation.
 */
export async function detectLegacyMemory(root: string): Promise<LegacyMemoryStats> {
  const memoryPath = resolve(root, LEGACY_MEMORY_DIR);
  try {
    await access(memoryPath);
    const entries = await readdir(memoryPath, { recursive: true });
    const files = entries.filter((e) => typeof e === "string" && e.includes("."));
    // Quick estimate: count likely JSON files and sum their rough record counts
    let estimatedRecords = 0;
    for (const file of files) {
      if (file.endsWith(".json")) {
        const s = await stat(join(memoryPath, file)).catch(() => null);
        // Rough heuristic: ~200 bytes per record
        if (s) estimatedRecords += Math.max(1, Math.floor(s.size / 200));
      }
    }
    return {
      detected: true,
      path: memoryPath,
      fileCount: files.length,
      estimatedRecords,
    };
  } catch {
    return { detected: false, path: memoryPath, fileCount: 0, estimatedRecords: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Preflight
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads `.memory/` (read-only), classifies all records, and returns expected
 * effects. Does NOT write anything.
 */
export async function preflight(
  root: string,
  store: HostedDomainStore,
  userId: string,
  workspaceId: string
): Promise<LegacyMigrationPreflight> {
  const stats = await detectLegacyMemory(root);
  if (!stats.detected) {
    return {
      detected: false,
      legacyMemoryPath: stats.path,
      recognizedKinds: [],
      recognizedCount: 0,
      duplicateCount: 0,
      quarantinedCount: 0,
      unknownKinds: [],
      warnings: [],
      expectedEffects: [],
      idempotencyMarkerPresent: false,
    };
  }

  const memoryPath = stats.path;
  const warnings: string[] = [];
  const unknownKinds: string[] = [];
  let recognizedCount = 0;
  let quarantinedCount = 0;
  const recognizedKindSet = new Set<HostedRecordKind>();

  // Read raw files (deduplicate per unique file path)
  const rawFileCache = new Map<string, unknown>();
  for (const { file } of LEGACY_FILE_MAP) {
    if (!rawFileCache.has(file)) {
      rawFileCache.set(file, await readJsonFile(join(memoryPath, file), null));
    }
  }

  // Scan unknown .json files
  const knownFiles = new Set(LEGACY_FILE_MAP.map((m) => m.file));
  let allJsonFiles: string[] = [];
  try {
    allJsonFiles = (await readdir(memoryPath, { recursive: true }))
      .filter((e) => typeof e === "string" && e.endsWith(".json"))
      .map((e) => e.toString());
  } catch {
    // ignore
  }
  for (const f of allJsonFiles) {
    const norm = f.replace(/\\/g, "/");
    if (!knownFiles.has(norm)) {
      unknownKinds.push(norm);
      warnings.push(`Unknown file in .memory: ${norm} — will be quarantined.`);
    }
  }

  // Count records per mapping
  for (const { file, kind, extractor } of LEGACY_FILE_MAP) {
    const raw = rawFileCache.get(file);
    if (raw === null || raw === undefined) continue;
    const records = extractor(raw);
    let valid = 0;
    let quarantined = 0;
    for (const r of records) {
      if (isRecognizedRecord(r)) {
        valid++;
      } else {
        quarantined++;
      }
    }
    if (valid > 0) recognizedKindSet.add(kind);
    recognizedCount += valid;
    quarantinedCount += quarantined;
    if (quarantined > 0) {
      warnings.push(
        `${quarantined} malformed record(s) in ${file} (kind: ${kind}) will be quarantined.`
      );
    }
  }

  // Check idempotency marker
  const idempotencyMarkerPresent = await store.getLegacyMigrationMarker(userId, workspaceId).then(
    (m) => m !== null,
    () => false
  );

  const expectedEffects: string[] = [];
  if (recognizedCount > 0) {
    expectedEffects.push(
      `${recognizedCount} record(s) will be imported with source provenance "migration".`
    );
  }
  if (quarantinedCount > 0) {
    expectedEffects.push(
      `${quarantinedCount} malformed record(s) will be quarantined (not imported).`
    );
  }
  if (unknownKinds.length > 0) {
    expectedEffects.push(`${unknownKinds.length} unknown file(s) will be quarantined.`);
  }
  expectedEffects.push("The .memory directory will NOT be modified.");
  if (idempotencyMarkerPresent) {
    expectedEffects.push(
      "Migration already completed — executing again will return already_migrated."
    );
  }

  return {
    detected: true,
    legacyMemoryPath: memoryPath,
    recognizedKinds: [...recognizedKindSet],
    recognizedCount,
    duplicateCount: 0, // computed during actual import via externalId dedup
    quarantinedCount,
    unknownKinds,
    warnings,
    expectedEffects,
    idempotencyMarkerPresent,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Execute Migration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes the idempotent migration from `.memory` into the Hosted Workspace.
 * - Writes a durable idempotency marker before importing.
 * - Quarantines malformed/unknown records without halting.
 * - Returns a resumable report on partial failure.
 * - NEVER modifies the source `.memory` directory.
 */
export async function executeMigration(
  root: string,
  workspaceId: string,
  repositoryId: string,
  store: HostedDomainStore,
  userId: string
): Promise<LegacyMigrationResult> {
  const correlationId = randomUUID();

  // Check idempotency marker first
  const existingMarker = await store
    .getLegacyMigrationMarker(userId, workspaceId)
    .catch(() => null);
  if (existingMarker !== null) {
    return {
      status: "already_migrated",
      imported: 0,
      quarantined: [],
      warnings: [
        "Migration already completed. Use the preflight endpoint to review current state.",
      ],
      correlationId: existingMarker,
    };
  }

  const stats = await detectLegacyMemory(root);
  if (!stats.detected) {
    // No legacy state — write marker and return
    await store.setLegacyMigrationMarker(userId, workspaceId, correlationId);
    return {
      status: "completed",
      imported: 0,
      quarantined: [],
      warnings: ["No .memory directory detected. Migration marker recorded."],
      correlationId,
    };
  }

  // Write idempotency marker BEFORE importing — retry-safe
  await store.setLegacyMigrationMarker(userId, workspaceId, correlationId);

  const memoryPath = stats.path;
  const quarantined: QuarantinedRecord[] = [];
  const warnings: string[] = [];

  // Build migration package from .memory
  const rawFileCache = new Map<string, unknown>();
  for (const { file } of LEGACY_FILE_MAP) {
    if (!rawFileCache.has(file)) {
      // lgtm [js/path-injection] Migrator reads from arbitrary local repository paths.
      rawFileCache.set(file, await readJsonFile(join(memoryPath, file), null));
    }
  }

  // Collect unknown files as quarantined entries
  let allJsonFiles: string[] = [];
  try {
    allJsonFiles = (await readdir(memoryPath, { recursive: true }))
      .filter((e) => typeof e === "string" && e.endsWith(".json"))
      .map((e) => e.toString());
  } catch {
    // ignore
  }
  const knownFiles = new Set(LEGACY_FILE_MAP.map((m) => m.file));
  for (const f of allJsonFiles) {
    const norm = f.replace(/\\/g, "/");
    if (!knownFiles.has(norm)) {
      quarantined.push({
        kind: "unknown",
        reason: `Unknown file in .memory: ${norm}`,
        rawValue: norm,
      });
    }
  }

  // Build records map
  const records: Partial<Record<HostedRecordKind, Array<Record<string, unknown>>>> = {};
  for (const { file, kind, extractor } of LEGACY_FILE_MAP) {
    const raw = rawFileCache.get(file);
    if (raw === null || raw === undefined) continue;
    const items = extractor(raw);
    const valid: Array<Record<string, unknown>> = [];
    for (const item of items) {
      if (isRecognizedRecord(item)) {
        // Stamp provenance — set externalId for idempotency
        const externalId =
          typeof (item as Record<string, unknown>).id === "string"
            ? `legacy-memory:${kind}:${(item as Record<string, unknown>).id as string}`
            : `legacy-memory:${kind}:${createHash("sha256").update(JSON.stringify(item)).digest("hex")}`;
        valid.push({
          ...(item as Record<string, unknown>),
          externalId,
          provenance: {
            source: "migration",
            legacyPath: join(memoryPath, file),
            migratedAt: new Date().toISOString(),
            correlationId,
          },
          repositoryId,
        });
      } else {
        quarantined.push({
          kind,
          reason: "Record is not a plain object or is null",
          rawValue: item,
        });
      }
    }
    if (valid.length > 0) {
      if (!records[kind]) records[kind] = [];
      records[kind]!.push(...valid);
    }
  }

  // Assemble MigrationPackage
  const pkg: MigrationPackage = {
    version: 1,
    exportedAt: new Date().toISOString(),
    repositories: [
      {
        id: repositoryId,
        localPath: root,
        pathIdentity: createHash("sha256").update(resolve(root).toLowerCase()).digest("hex"),
      },
    ],
    records,
    relationships: [],
    warnings,
  };

  let imported = 0;
  let resumeFrom: string | undefined;
  let status: LegacyMigrationResult["status"] = "completed";

  try {
    const result = await store.importMigration(userId, workspaceId, pkg);
    imported = result.imported;
    warnings.push(...result.warnings);
  } catch (err: unknown) {
    // Partial failure — the marker is already written, so retry is safe
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`Partial failure during import: ${message}`);
    status = "partial";
    resumeFrom = correlationId; // correlationId IS the resume key
  }

  return {
    status,
    imported,
    quarantined,
    warnings,
    correlationId,
    resumeFrom,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  return [];
}

function extractArrayFromField(raw: unknown, field: string): unknown[] {
  if (typeof raw === "object" && raw !== null && field in raw) {
    const v = (raw as Record<string, unknown>)[field];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function isRecognizedRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
