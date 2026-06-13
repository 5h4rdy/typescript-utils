import {MigrationResultBuilder, EntityTypeResult} from "../../src/services/migration/MigrationResult";

describe("MigrationResult", () => {
    const makeEntityResult = (overrides: Partial<EntityTypeResult> = {}): EntityTypeResult => ({
        entityType: "User",
        sourceCount: 10,
        migratedCount: 10,
        failedCount: 0,
        warningCount: 0,
        errors: [],
        warnings: [],
        durationMs: 100,
        ...overrides,
    });

    describe("MigrationResultBuilder", () => {
        it("builds a successful result with no entity results", () => {
            const startedAt = new Date("2024-01-01T10:00:00Z");
            const builder = new MigrationResultBuilder(startedAt, false);
            const finishedAt = new Date("2024-01-01T10:00:05Z");

            const result = builder.build(finishedAt);

            expect(result.success).toBe(true);
            expect(result.dryRun).toBe(false);
            expect(result.totalSourceRecords).toBe(0);
            expect(result.totalMigrated).toBe(0);
            expect(result.totalFailed).toBe(0);
            expect(result.totalWarnings).toBe(0);
            expect(result.entityResults).toHaveLength(0);
            expect(result.durationMs).toBe(5000);
            expect(result.rolledBack).toBe(false);
            expect(result.rollbackCount).toBe(0);
        });

        it("builds a result with one entity type", () => {
            const startedAt = new Date("2024-01-01T10:00:00Z");
            const builder = new MigrationResultBuilder(startedAt, false);
            builder.addEntityResult(makeEntityResult());
            const finishedAt = new Date("2024-01-01T10:00:10Z");

            const result = builder.build(finishedAt);

            expect(result.success).toBe(true);
            expect(result.totalSourceRecords).toBe(10);
            expect(result.totalMigrated).toBe(10);
            expect(result.totalFailed).toBe(0);
            expect(result.entityResults).toHaveLength(1);
            expect(result.entityResults[0].entityType).toBe("User");
            expect(result.durationMs).toBe(10000);
        });

        it("builds a result with multiple entity types", () => {
            const builder = new MigrationResultBuilder(new Date(), false);
            builder.addEntityResult(makeEntityResult({
                entityType: "User",
                sourceCount: 50,
                migratedCount: 48,
                failedCount: 2,
            }));
            builder.addEntityResult(makeEntityResult({
                entityType: "Product",
                sourceCount: 100,
                migratedCount: 100,
                failedCount: 0,
            }));
            const result = builder.build(new Date());

            expect(result.totalSourceRecords).toBe(150);
            expect(result.totalMigrated).toBe(148);
            expect(result.totalFailed).toBe(2);
            expect(result.success).toBe(false); // failed > 0
            expect(result.entityResults).toHaveLength(2);
        });

        it("marks success=false when rolled back", () => {
            const builder = new MigrationResultBuilder(new Date(), false);
            builder.addEntityResult(makeEntityResult({migratedCount: 5, sourceCount: 5}));
            builder.setRolledBack(5);

            const result = builder.build(new Date());

            expect(result.success).toBe(false);
            expect(result.rolledBack).toBe(true);
            expect(result.rollbackCount).toBe(5);
        });

        it("marks dryRun correctly", () => {
            const builder = new MigrationResultBuilder(new Date(), true);
            builder.addEntityResult(makeEntityResult());

            const result = builder.build(new Date());

            expect(result.dryRun).toBe(true);
        });

        it("preserves errors and warnings in entity results", () => {
            const builder = new MigrationResultBuilder(new Date(), false);
            builder.addEntityResult(makeEntityResult({
                errors: [{
                    entityType: "User",
                    message: "Load failed",
                    phase: "load" as const,
                    recordId: "123",
                }],
                warnings: [{
                    entityType: "User",
                    message: "Deprecated field",
                }],
                failedCount: 1,
                warningCount: 1,
            }));

            const result = builder.build(new Date());

            expect(result.totalFailed).toBe(1);
            expect(result.totalWarnings).toBe(1);
            expect(result.entityResults[0].errors).toHaveLength(1);
            expect(result.entityResults[0].warnings).toHaveLength(1);
        });
    });
});
