import {MigrationOptions, normaliseOptions, EntityTypeTransform, OnErrorStrategy} from "../../src/services/migration/MigrationOptions";

describe("MigrationOptions", () => {
    const mockDAO: any = {getAll: jest.fn()};

    const makeEntityType = (name: string): EntityTypeTransform => ({
        entityType: name,
        sourceDAO: mockDAO,
        targetDAO: mockDAO,
    });

    describe("normaliseOptions", () => {
        it("applies default values", () => {
            const opts = normaliseOptions({
                entityTypes: [makeEntityType("User")],
            });

            expect(opts.batchSize).toBe(100);
            expect(opts.dryRun).toBe(false);
            expect(opts.onError).toBe("abort");
            expect(opts.maxRetries).toBe(3);
            expect(opts.rollbackOnFailure).toBe(true);
        });

        it("respects provided values", () => {
            const opts = normaliseOptions({
                entityTypes: [makeEntityType("User")],
                batchSize: 25,
                dryRun: true,
                onError: "skip",
                maxRetries: 5,
                rollbackOnFailure: false,
            });

            expect(opts.batchSize).toBe(25);
            expect(opts.dryRun).toBe(true);
            expect(opts.onError).toBe("skip");
            expect(opts.maxRetries).toBe(5);
            expect(opts.rollbackOnFailure).toBe(false);
        });

        it("throws on duplicate entity types", () => {
            expect(() => {
                normaliseOptions({
                    entityTypes: [makeEntityType("User"), makeEntityType("User")],
                });
            }).toThrow("Duplicate entityType");
        });

        it("preserves optional fields", () => {
            const since = new Date("2024-01-01");
            const cb = jest.fn();
            const opts = normaliseOptions({
                entityTypes: [makeEntityType("User")],
                migrateSince: since,
                onProgress: cb,
                sourceDAO: mockDAO,
                targetDAO: mockDAO,
            });

            expect(opts.migrateSince).toEqual(since);
            expect(opts.onProgress).toBe(cb);
            expect(opts.sourceDAO).toBe(mockDAO);
            expect(opts.targetDAO).toBe(mockDAO);
        });

        it("preserves fieldMappings and stripFields in entity types", () => {
            const et = makeEntityType("User");
            et.fieldMappings = [{sourceField: "oldName", targetField: "newName"}];
            et.stripFields = ["_id", "_rev"];

            const opts = normaliseOptions({entityTypes: [et]});
            expect(opts.entityTypes[0].fieldMappings).toHaveLength(1);
            expect(opts.entityTypes[0].stripFields).toHaveLength(2);
        });
    });
});
