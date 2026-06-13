import {GenericDAO} from "../dao/GenericDAO";
import {Entity} from "../../model/Entity";

/**
 * Strategy for handling errors during migration.
 * - `abort`: Stop the entire migration on first error.
 * - `skip`: Log the error and continue with the next record.
 * - `retry`: Retry the failed record up to `maxRetries` times before falling back to skip.
 */
export type OnErrorStrategy = "abort" | "skip" | "retry";

/**
 * Custom transformation function signature.
 * Receives the source record and returns the transformed record.
 */
export type TransformFn<S = any, T = any> = (record: S) => T | Promise<T>;

/**
 * Field mapping entry: source field name → target field name.
 */
export interface FieldMapping {
    sourceField: string;
    targetField: string;
}

/**
 * Per-entity-type transformation rules.
 */
export interface EntityTypeTransform {
    /** Entity type identifier (e.g. "User", "Product"). */
    entityType: string;

    /** Source DAO for this entity type. */
    sourceDAO: GenericDAO<any>;

    /** Target DAO for this entity type. */
    targetDAO: GenericDAO<any>;

    /** Explicit field name mappings. */
    fieldMappings?: FieldMapping[];

    /** Fields to strip from the source record before loading. */
    stripFields?: string[];

    /** Custom transform function applied after built-in transforms. */
    customTransform?: TransformFn;

    /** Joi or similar validation schema (optional, not enforced by the pump itself). */
    validateSchema?: (record: any) => boolean;
}

/**
 * Progress callback for reporting migration progress.
 */
export type ProgressCallback = (progress: MigrationProgress) => void;

/**
 * Progress update emitted during migration.
 */
export interface MigrationProgress {
    entityType: string;
    processed: number;
    total: number;
    succeeded: number;
    failed: number;
    warnings: number;
}

/**
 * Configuration for the Data Migration Pump.
 */
export interface MigrationOptions {
    /** Source DAO (used when a single DAO pair covers all entities). */
    sourceDAO?: GenericDAO<any>;

    /** Target DAO (used when a single DAO pair covers all entities). */
    targetDAO?: GenericDAO<any>;

    /** Per-entity-type transform configurations. */
    entityTypes: EntityTypeTransform[];

    /** Number of records to process per batch. Default: 100. */
    batchSize?: number;

    /** If true, extract and transform only — no loading to target. Default: false. */
    dryRun?: boolean;

    /** What to do when a record fails. Default: "abort". */
    onError?: OnErrorStrategy;

    /** Max retry attempts when onError = "retry". Default: 3. */
    maxRetries?: number;

    /** Optional progress callback. */
    onProgress?: ProgressCallback;

    /** If provided, only migrate records whose updatedDate > this value. */
    migrateSince?: Date;

    /** If true, rollback (delete) already-loaded records on failure when not in dry-run. Default: true. */
    rollbackOnFailure?: boolean;
}

/**
 * Provides sensible defaults for partial options.
 */
export function normaliseOptions(options: MigrationOptions): Required<Omit<MigrationOptions, "migrateSince" | "onProgress" | "sourceDAO" | "targetDAO">> &
    Pick<MigrationOptions, "migrateSince" | "onProgress" | "sourceDAO" | "targetDAO"> {

    const seen = new Set<string>();
    for (const et of options.entityTypes) {
        if (seen.has(et.entityType)) {
            throw new Error(`Duplicate entityType in options: ${et.entityType}`);
        }
        seen.add(et.entityType);
    }

    return {
        sourceDAO: options.sourceDAO,
        targetDAO: options.targetDAO,
        entityTypes: options.entityTypes,
        batchSize: options.batchSize ?? 100,
        dryRun: options.dryRun ?? false,
        onError: options.onError ?? "abort",
        maxRetries: options.maxRetries ?? 3,
        onProgress: options.onProgress,
        migrateSince: options.migrateSince,
        rollbackOnFailure: options.rollbackOnFailure ?? true,
    };
}
