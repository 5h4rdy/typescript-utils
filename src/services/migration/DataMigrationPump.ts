import {GenericDAO} from "../dao/GenericDAO";
import {
    MigrationOptions,
    normaliseOptions,
    EntityTypeTransform,
    MigrationProgress,
} from "./MigrationOptions";
import {
    MigrationResult,
    MigrationResultBuilder,
    EntityTypeResult,
    MigrationErrorEntry,
    MigrationWarningEntry,
} from "./MigrationResult";
import {MigrationTransformer} from "./MigrationTransformer";
import {SchemaMappingRegistry, MigrationDirection} from "./SchemaMapping";

/**
 * A generic data migration pump that transfers data between any two
 * GenericDAO implementations.
 *
 * Features:
 * - Batch processing
 * - Dry-run mode
 * - Rollback on failure
 * - Progress reporting
 * - Incremental migrations (migrateSince)
 * - Configurable on-error strategies (abort, skip, retry)
 * - Pluggable transformations
 * - SchemaMapping support for type-aware, bidirectional migration
 * - Sub-document extraction (nested objects → separate tables)
 *
 * The pump works through the GenericDAO interface, so it is inherently
 * bidirectional: any DAO can be a source or target. The SchemaMapping
 * registry adds type-awareness on top, enabling field-level transforms,
 * sub-document extraction, and docType-to-entity routing.
 */
export class DataMigrationPump {
    private readonly options: ReturnType<typeof normaliseOptions>;

    constructor(options: MigrationOptions) {
        this.options = normaliseOptions(options);
    }

    /**
     * Run the migration.
     */
    async run(): Promise<MigrationResult> {
        const startedAt = new Date();
        const builder = new MigrationResultBuilder(startedAt, this.options.dryRun);
        const loadedRecordIds: Array<{ entityType: string; id: string }> = [];
        let totalFailedAcrossEntities = 0;

        try {
            for (const et of this.options.entityTypes) {
                const result = await this.migrateEntityType(et, loadedRecordIds);
                builder.addEntityResult(result);
                totalFailedAcrossEntities += result.failedCount;

                if (result.failedCount > 0 && this.options.onError === "abort") {
                    break;
                }
            }
        } catch (err: any) {
            if (this.options.rollbackOnFailure && !this.options.dryRun) {
                const count = await this.rollback(loadedRecordIds);
                builder.setRolledBack(count);
            }
            throw err;
        }

        // Handle rollback for abort-with-errors case (no exception thrown)
        if (totalFailedAcrossEntities > 0 && this.options.onError === "abort"
                && this.options.rollbackOnFailure && !this.options.dryRun) {
            const count = await this.rollback(loadedRecordIds);
            builder.setRolledBack(count);
        }

        return builder.build(new Date());
    }

    /**
     * Migrate a single entity type.
     */
    private async migrateEntityType(
        et: EntityTypeTransform,
        loadedIds: Array<{ entityType: string; id: string }>,
    ): Promise<EntityTypeResult> {
        const startTime = Date.now();
        const errors: MigrationErrorEntry[] = [];
        const warnings: MigrationWarningEntry[] = [];

        // Build transformer: SchemaMapping-aware if available, else from EntityTypeTransform
        const transformer = this.buildTransformer(et);

        // 1. Extract
        let sourceRecords: Record<string, any>[];
        try {
            sourceRecords = await this.extract(et);
        } catch (err: any) {
            errors.push({
                entityType: et.entityType,
                message: `Extraction failed: ${err.message}`,
                cause: err.parentError?.message,
                phase: "extract",
            });
            return {
                entityType: et.entityType,
                sourceCount: 0,
                migratedCount: 0,
                failedCount: 1,
                warningCount: 0,
                errors,
                warnings,
                durationMs: Date.now() - startTime,
            };
        }

        const sourceCount = sourceRecords.length;
        let migratedCount = 0;
        let failedCount = 0;
        let warningCount = 0;

        // Determine if sub-document handling is needed
        const hasSubDocuments = this.hasSubDocumentSupport(et);

        // 2. Process in batches
        const batchSize = this.options.batchSize;
        for (let i = 0; i < sourceRecords.length; i += batchSize) {
            const batch = sourceRecords.slice(i, i + batchSize);

            if (hasSubDocuments) {
                // Sub-document aware path
                for (let j = 0; j < batch.length; j++) {
                    const record = batch[j];
                    const sourceId = record["_id"] ?? record["id"];

                    try {
                        const result = await transformer.transformWithSubDocuments(record, et.entityType);
                        warnings.push(...result.warnings);
                        warningCount += result.warnings.length;

                        if (!this.options.dryRun) {
                            // Load main record
                            const loaded = await this.loadSingle(et.targetDAO, result.record);
                            const loadedId = loaded._id ?? loaded.id;
                            if (loadedId) {
                                loadedIds.push({entityType: et.entityType, id: loadedId});
                            }
                            migratedCount++;

                            // Load sub-documents
                            if (result.subDocuments && et.subDocumentDAOs) {
                                for (const sub of result.subDocuments) {
                                    const subDAO = et.subDocumentDAOs.get(sub.entityType);
                                    if (!subDAO) {
                                        warnings.push({
                                            recordId: sourceId,
                                            entityType: et.entityType,
                                            message: `No DAO registered for sub-document type: ${sub.entityType}`,
                                        });
                                        continue;
                                    }
                                    for (const subRec of sub.records) {
                                        // Update FK to actual loaded ID
                                        subRec[sub.foreignKeyField] = loadedId;
                                        const subLoaded = await this.loadSingle(subDAO, subRec);
                                        const subLoadedId = subLoaded._id ?? subLoaded.id;
                                        if (subLoadedId) {
                                            loadedIds.push({entityType: sub.entityType, id: subLoadedId});
                                        }
                                    }
                                }
                            }
                        } else {
                            migratedCount++;
                        }
                    } catch (err: any) {
                        errors.push({
                            recordId: sourceId,
                            entityType: et.entityType,
                            message: `Transform/Load error: ${err.message}`,
                            cause: err.parentError?.message,
                            phase: "transform",
                        });
                        failedCount++;

                        if (this.options.onError === "abort") break;
                    }
                }
            } else {
                // Standard batch transform path (original logic)
                let transformed: Record<string, any>[];
                try {
                    const [t, w] = await transformer.transformBatch(batch);
                    transformed = t;
                    warnings.push(...w);
                    warningCount += w.length;
                } catch (err: any) {
                    for (const rec of batch) {
                        errors.push({
                            recordId: rec["_id"] ?? rec["id"],
                            entityType: et.entityType,
                            message: `Transform error: ${err.message}`,
                            phase: "transform",
                        });
                    }
                    failedCount += batch.length;

                    if (this.options.onError === "abort") break;
                    continue;
                }

                // Load (skip if dry run)
                if (!this.options.dryRun) {
                    for (let j = 0; j < transformed.length; j++) {
                        const record = transformed[j];
                        const sourceId = batch[j]["_id"] ?? batch[j]["id"] ?? record["id"];

                        try {
                            const loaded = await this.loadSingle(et.targetDAO, record);
                            if (loaded._id || loaded.id) {
                                loadedIds.push({
                                    entityType: et.entityType,
                                    id: (loaded._id ?? loaded.id) as string,
                                });
                            }
                            migratedCount++;
                        } catch (err: any) {
                            errors.push({
                                recordId: sourceId,
                                entityType: et.entityType,
                                message: `Load error: ${err.message}`,
                                cause: err.parentError?.message,
                                phase: "load",
                            });
                            failedCount++;

                            if (this.options.onError === "abort") break;

                            if (this.options.onError === "retry") {
                                const retried = await this.retryLoad(et.targetDAO, record, sourceId, et.entityType);
                                if (retried.success) {
                                    migratedCount++;
                                    failedCount--;
                                    if (retried.loadedId) {
                                        loadedIds.push({entityType: et.entityType, id: retried.loadedId});
                                    }
                                } else {
                                    errors.push(...retried.errors);
                                }
                            }
                        }
                    }

                    if (this.options.onError === "abort" && failedCount > 0) break;
                } else {
                    migratedCount += transformed.length;
                }
            }

            // Report progress
            if (this.options.onProgress) {
                this.options.onProgress({
                    entityType: et.entityType,
                    processed: Math.min(i + batchSize, sourceCount),
                    total: sourceCount,
                    succeeded: migratedCount,
                    failed: failedCount,
                    warnings: warningCount,
                } as MigrationProgress);
            }
        }

        return {
            entityType: et.entityType,
            sourceCount,
            migratedCount,
            failedCount,
            warningCount,
            errors,
            warnings,
            durationMs: Date.now() - startTime,
        };
    }

    /**
     * Build the appropriate transformer for an entity type.
     * Uses SchemaMapping if available, otherwise falls back to EntityTypeTransform config.
     */
    private buildTransformer(et: EntityTypeTransform): MigrationTransformer {
        if (this.options.schemaMappings && et.schemaMappingKey) {
            const direction = this.options.direction ?? this.inferDirection(et);
            return MigrationTransformer.fromRegistry(
                this.options.schemaMappings,
                et.schemaMappingKey,
                direction,
            );
        }
        return MigrationTransformer.fromEntityType(et);
    }

    /**
     * Infer migration direction from DAO types.
     */
    private inferDirection(et: EntityTypeTransform): MigrationDirection {
        const sourceName = et.sourceDAO.constructor.name;
        if (sourceName.includes("Pouch")) return "pouch-to-orm";
        return "orm-to-pouch";
    }

    /**
     * Check if the entity type has sub-document support configured.
     */
    private hasSubDocumentSupport(et: EntityTypeTransform): boolean {
        if (!this.options.schemaMappings || !et.schemaMappingKey) return false;
        const mapping = this.options.schemaMappings.getByKey(et.schemaMappingKey);
        if (!mapping || !mapping.subDocuments || mapping.subDocuments.length === 0) return false;
        return et.subDocumentDAOs !== undefined && et.subDocumentDAOs.size > 0;
    }

    /**
     * Extract records from the source DAO, optionally filtered by migrateSince.
     */
    private async extract(et: EntityTypeTransform): Promise<Record<string, any>[]> {
        const dao = et.sourceDAO;
        let records = await dao.getAll();

        if (this.options.migrateSince) {
            const since = this.options.migrateSince.getTime();
            records = records.filter((r: any) => {
                const dateStr = r.updatedDate ?? r.createdDate;
                if (!dateStr) return false;
                const recordDate = typeof dateStr === "string" ? new Date(dateStr).getTime() : new Date(dateStr).getTime();
                return recordDate > since;
            });
        }

        return records as Record<string, any>[];
    }

    /**
     * Load a single record into the target DAO.
     */
    private async loadSingle(dao: GenericDAO<any>, record: Record<string, any>): Promise<any> {
        // Strip undefined fields
        const clean: Record<string, any> = {};
        for (const [k, v] of Object.entries(record)) {
            if (v !== undefined) clean[k] = v;
        }

        const [saved] = await dao.create(clean);
        return saved;
    }

    /**
     * Retry loading a record up to maxRetries times.
     */
    private async retryLoad(
        dao: GenericDAO<any>,
        record: Record<string, any>,
        sourceId: string | undefined,
        entityType: string,
    ): Promise<{ success: boolean; loadedId?: string; errors: MigrationErrorEntry[] }> {
        const errors: MigrationErrorEntry[] = [];
        for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
            try {
                const [saved] = await dao.create(record);
                return {success: true, loadedId: saved._id ?? saved.id, errors: []};
            } catch (err: any) {
                errors.push({
                    recordId: sourceId,
                    entityType,
                    message: `Retry ${attempt}/${this.options.maxRetries} failed: ${err.message}`,
                    phase: "load",
                });
            }
        }
        return {success: false, errors};
    }

    /**
     * Rollback: delete all records that were loaded.
     */
    private async rollback(loadedIds: Array<{ entityType: string; id: string }>): Promise<number> {
        // Group by entity type to use the right DAO
        const byEntity = new Map<string, string[]>();
        for (const {entityType, id} of loadedIds) {
            if (!byEntity.has(entityType)) byEntity.set(entityType, []);
            byEntity.get(entityType)!.push(id);
        }

        let count = 0;

        // Build a lookup of entity type → DAO (includes sub-document DAOs)
        const daoMap = new Map<string, GenericDAO<any>>();
        for (const et of this.options.entityTypes) {
            daoMap.set(et.entityType, et.targetDAO);
            if (et.subDocumentDAOs) {
                for (const [subType, subDAO] of et.subDocumentDAOs) {
                    daoMap.set(subType, subDAO);
                }
            }
        }

        for (const [entityType, ids] of byEntity) {
            const dao = daoMap.get(entityType);
            if (!dao) continue;

            for (const id of ids) {
                try {
                    await dao.delete(id);
                    count++;
                } catch {
                    // Best-effort rollback
                }
            }
        }
        return count;
    }
}
