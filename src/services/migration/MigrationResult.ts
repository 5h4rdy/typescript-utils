/**
 * Structured result for a single entity-type migration.
 */
export interface EntityTypeResult {
    entityType: string;
    sourceCount: number;
    migratedCount: number;
    failedCount: number;
    warningCount: number;
    errors: MigrationErrorEntry[];
    warnings: MigrationWarningEntry[];
    durationMs: number;
}

/**
 * Structured result for an entire migration run.
 */
export interface MigrationResult {
    /** True if every entity type completed without errors. */
    success: boolean;

    /** True if this was a dry run. */
    dryRun: boolean;

    /** Aggregate counts. */
    totalSourceRecords: number;
    totalMigrated: number;
    totalFailed: number;
    totalWarnings: number;

    /** Per-entity-type breakdown. */
    entityResults: EntityTypeResult[];

    /** Overall timing. */
    startedAt: Date;
    finishedAt: Date;
    durationMs: number;

    /** Was a rollback performed? */
    rolledBack: boolean;
    /** Records removed during rollback. */
    rollbackCount: number;
}

/**
 * A single error encountered during migration.
 */
export interface MigrationErrorEntry {
    /** Source record ID (if known). */
    recordId?: string;
    /** Entity type. */
    entityType: string;
    /** Error message. */
    message: string;
    /** Original error (if any). */
    cause?: string;
    /** Which phase the error occurred in. */
    phase: "extract" | "transform" | "load";
}

/**
 * A single warning encountered during migration.
 */
export interface MigrationWarningEntry {
    recordId?: string;
    entityType: string;
    message: string;
}

/**
 * Builder for incrementally constructing a MigrationResult.
 */
export class MigrationResultBuilder {
    private entityResults: EntityTypeResult[] = [];
    private rolledBack = false;
    private rollbackCount = 0;

    constructor(
        private readonly startedAt: Date,
        private readonly dryRun: boolean,
    ) {}

    addEntityResult(result: EntityTypeResult): void {
        this.entityResults.push(result);
    }

    setRolledBack(count: number): void {
        this.rolledBack = true;
        this.rollbackCount = count;
    }

    build(finishedAt: Date): MigrationResult {
        const totalSourceRecords = this.entityResults.reduce((s, r) => s + r.sourceCount, 0);
        const totalMigrated = this.entityResults.reduce((s, r) => s + r.migratedCount, 0);
        const totalFailed = this.entityResults.reduce((s, r) => s + r.failedCount, 0);
        const totalWarnings = this.entityResults.reduce((s, r) => s + r.warningCount, 0);

        return {
            success: totalFailed === 0 && !this.rolledBack,
            dryRun: this.dryRun,
            totalSourceRecords,
            totalMigrated,
            totalFailed,
            totalWarnings,
            entityResults: [...this.entityResults],
            startedAt: this.startedAt,
            finishedAt,
            durationMs: finishedAt.getTime() - this.startedAt.getTime(),
            rolledBack: this.rolledBack,
            rollbackCount: this.rollbackCount,
        };
    }
}
