import PouchDB from "pouchdb";
import memoryAdapter from "pouchdb-adapter-memory";
import {v4 as uuidv4} from "uuid";
import {DataMigrationPump} from "../../src/services/migration/DataMigrationPump";
import {MigrationOptions} from "../../src/services/migration/MigrationOptions";
import {MigrationTransformer} from "../../src/services/migration/MigrationTransformer";
import {GenericPouchDAO} from "../../src/services/dao/GenericPouchDAO";
import {GenericPouchMapper} from "../../src/services/dao/mapper/GenericPouchMapper";
import {GenericDAO} from "../../src/services/dao/GenericDAO";
import {GenericPouchDoc} from "../../src/services/dao/types/DbTypes";

PouchDB.plugin(memoryAdapter);

// -- Test helpers --

interface TestUser extends GenericPouchDoc {
    name: string;
    email: string;
    age: number;
}

function makePouchDAO(name: string, entityType: string): GenericDAO<any> {
    const db = new PouchDB(name + uuidv4(), {adapter: "memory"});
    return new GenericPouchDAO(db, new GenericPouchMapper(), entityType, "1.0.0");
}

async function seedUsers(dao: GenericDAO<any>, count: number): Promise<TestUser[]> {
    const created: TestUser[] = [];
    for (let i = 0; i < count; i++) {
        const doc: TestUser = {
            _id: undefined,
            entityType: undefined,
            name: `User${i}`,
            email: `user${i}@test.com`,
            age: 20 + i,
        };
        const [saved] = await dao.create(doc);
        created.push(saved as TestUser);
    }
    return created;
}

// -- Mock DAO factory for controlled tests --

function makeMockDAO(records: any[] = [], overrides: Partial<GenericDAO<any>> = {}): GenericDAO<any> {
    const store = [...records];
    return {
        getAll: jest.fn(async () => [...store]),
        getOne: jest.fn(async (id: string) => store.find(r => r._id === id || r.id === id)),
        getMany: jest.fn(async (ids: string[]) => store.filter(r => ids.includes(r._id || r.id))),
        create: jest.fn(async (doc: any): Promise<[any, any]> => {
            const saved = {...doc, _id: doc._id || `gen-${uuidv4()}`, _rev: "1-mock"};
            store.push(saved);
            return [saved, undefined] as [any, any];
        }),
        update: jest.fn(async (doc: any) => {
            const idx = store.findIndex(r => r._id === doc._id);
            if (idx >= 0) store[idx] = {...store[idx], ...doc};
            return [doc, undefined];
        }),
        delete: jest.fn(async (id: string) => {
            const idx = store.findIndex(r => r._id === id || r.id === id);
            if (idx >= 0) store.splice(idx, 1);
            return ["1", undefined];
        }),
        findByField: jest.fn(async (field: string, value: any) =>
            store.filter(r => r[field] === value)),
        getNextSequenceId: jest.fn(async () => 1),
        getMapper: jest.fn(() => new GenericPouchMapper()),
        ...overrides,
    } as unknown as GenericDAO<any>;
}

// ============== TESTS ==============

describe("DataMigrationPump", () => {

    describe("Basic migration", () => {
        it("migrates all records from source to target with mock DAOs", async () => {
            const sourceRecords = [
                {_id: "u1", name: "Alice", email: "alice@test.com", age: 30, _rev: "1-a", entityType: "User"},
                {_id: "u2", name: "Bob", email: "bob@test.com", age: 25, _rev: "1-b", entityType: "User"},
                {_id: "u3", name: "Charlie", email: "charlie@test.com", age: 35, _rev: "1-c", entityType: "User"},
            ];

            const sourceDAO = makeMockDAO(sourceRecords);
            const targetDAO = makeMockDAO();

            const pump = new DataMigrationPump({
                entityTypes: [{
                    entityType: "User",
                    sourceDAO,
                    targetDAO,
                }],
            });

            const result = await pump.run();

            expect(result.success).toBe(true);
            expect(result.totalSourceRecords).toBe(3);
            expect(result.totalMigrated).toBe(3);
            expect(result.totalFailed).toBe(0);
            expect(targetDAO.create).toHaveBeenCalledTimes(3);
        });

        it("migrates data using real PouchDB DAOs", async () => {
            const sourceDb = new PouchDB("src-" + uuidv4(), {adapter: "memory"});
            const targetDb = new PouchDB("tgt-" + uuidv4(), {adapter: "memory"});

            const sourceDAO = new GenericPouchDAO(sourceDb, new GenericPouchMapper(), "User", "1.0.0");
            const targetDAO = new GenericPouchDAO(targetDb, new GenericPouchMapper(), "User", "1.0.0");

            await seedUsers(sourceDAO as GenericDAO<any>, 5);

            const pump = new DataMigrationPump({
                entityTypes: [{
                    entityType: "User",
                    sourceDAO,
                    targetDAO,
                }],
            });

            const result = await pump.run();

            expect(result.success).toBe(true);
            expect(result.totalSourceRecords).toBe(5);
            expect(result.totalMigrated).toBe(5);

            const targetRecords = await targetDAO.getAll();
            expect(targetRecords.length).toBe(5);

            await sourceDb.destroy();
            await targetDb.destroy();
        });
    });

    describe("Dry-run mode", () => {
        it("does not load records in dry-run mode", async () => {
            const sourceDAO = makeMockDAO([
                {_id: "1", name: "Test", _rev: "1"},
            ]);
            const targetDAO = makeMockDAO();

            const pump = new DataMigrationPump({
                entityTypes: [{entityType: "User", sourceDAO, targetDAO}],
                dryRun: true,
            });

            const result = await pump.run();

            expect(result.dryRun).toBe(true);
            expect(result.totalMigrated).toBe(1);
            expect(targetDAO.create).not.toHaveBeenCalled();
        });
    });

    describe("Batch processing", () => {
        it("handles empty source", async () => {
            const sourceDAO = makeMockDAO([]);
            const targetDAO = makeMockDAO();

            const pump = new DataMigrationPump({
                entityTypes: [{entityType: "User", sourceDAO, targetDAO}],
            });

            const result = await pump.run();

            expect(result.totalSourceRecords).toBe(0);
            expect(result.totalMigrated).toBe(0);
            expect(targetDAO.create).not.toHaveBeenCalled();
        });

        it("handles single record", async () => {
            const sourceDAO = makeMockDAO([{_id: "1", name: "Only"}]);
            const targetDAO = makeMockDAO();

            const pump = new DataMigrationPump({
                entityTypes: [{entityType: "User", sourceDAO, targetDAO}],
            });

            const result = await pump.run();

            expect(result.totalMigrated).toBe(1);
        });

        it("processes large dataset in batches", async () => {
            const largeRecords = Array.from({length: 150}, (_, i) => ({
                _id: `rec${i}`,
                name: `Record${i}`,
                _rev: `1-${i}`,
                entityType: "Record",
            }));

            const sourceDAO = makeMockDAO(largeRecords);
            const targetDAO = makeMockDAO();

            const pump = new DataMigrationPump({
                entityTypes: [{entityType: "Record", sourceDAO, targetDAO}],
                batchSize: 50,
            });

            const result = await pump.run();

            expect(result.totalSourceRecords).toBe(150);
            expect(result.totalMigrated).toBe(150);
            expect(targetDAO.create).toHaveBeenCalledTimes(150);
        });

        it("respects batch size of 1", async () => {
            const sourceDAO = makeMockDAO([
                {_id: "1", name: "A"},
                {_id: "2", name: "B"},
                {_id: "3", name: "C"},
            ]);
            const targetDAO = makeMockDAO();

            const pump = new DataMigrationPump({
                entityTypes: [{entityType: "User", sourceDAO, targetDAO}],
                batchSize: 1,
            });

            const result = await pump.run();

            expect(result.totalMigrated).toBe(3);
        });
    });

    describe("Error handling", () => {
        it("aborts on first error with onError=abort", async () => {
            const sourceRecords = [
                {_id: "1", name: "Alice"},
                {_id: "2", name: "Bob"},
                {_id: "3", name: "Charlie"},
            ];

            const sourceDAO = makeMockDAO(sourceRecords);
            const targetDAO = makeMockDAO([], {
                create: jest.fn()
                    .mockRejectedValueOnce(new Error("DB write failed"))
                    .mockResolvedValueOnce([{_id: "ok"}, undefined] as [any, any]),
            });

            const pump = new DataMigrationPump({
                entityTypes: [{entityType: "User", sourceDAO, targetDAO}],
                onError: "abort",
                rollbackOnFailure: false,
            });

            const result = await pump.run();

            expect(result.success).toBe(false);
            expect(result.totalFailed).toBeGreaterThanOrEqual(1);
            expect(result.entityResults[0].errors).toHaveLength(1);
            expect(result.entityResults[0].errors[0].phase).toBe("load");
        });

        it("skips failed records with onError=skip", async () => {
            const sourceRecords = [
                {_id: "1", name: "Alice"},
                {_id: "2", name: "Bob"},
                {_id: "3", name: "Charlie"},
            ];

            const sourceDAO = makeMockDAO(sourceRecords);
            let callCount = 0;
            const targetDAO = makeMockDAO([], {
                create: jest.fn(async (doc: any): Promise<[any, any]> => {
                    callCount++;
                    if (callCount === 2) throw new Error("Simulated failure for record 2");
                    [{...doc, _id: doc._id || `gen-${callCount}`}, undefined] as [any, any];
                    return [{...doc, _id: doc._id || `gen-${callCount}`}, undefined] as [any, any];
                }),
            });

            const pump = new DataMigrationPump({
                entityTypes: [{entityType: "User", sourceDAO, targetDAO}],
                onError: "skip",
                rollbackOnFailure: false,
            });

            const result = await pump.run();

            expect(result.totalMigrated).toBe(2);
            expect(result.totalFailed).toBe(1);
            expect(result.entityResults[0].errors).toHaveLength(1);
        });

        it("retries failed records with onError=retry", async () => {
            const sourceRecords = [
                {_id: "1", name: "Alice"},
            ];

            const sourceDAO = makeMockDAO(sourceRecords);
            let callCount = 0;
            const targetDAO = makeMockDAO([], {
                create: jest.fn(async (doc: any): Promise<[any, any]> => {
                    callCount++;
                    if (callCount <= 2) throw new Error("Transient failure");
                    return [{...doc, _id: "saved-1"}, undefined] as [any, any];
                }),
            });

            const pump = new DataMigrationPump({
                entityTypes: [{entityType: "User", sourceDAO, targetDAO}],
                onError: "retry",
                maxRetries: 3,
                rollbackOnFailure: false,
            });

            const result = await pump.run();

            // Initial attempt fails, then 2 retries (total callCount 3), third succeeds
            expect(result.totalMigrated).toBe(1);
        });

        it("handles source DAO extraction error", async () => {
            const sourceDAO = makeMockDAO([], {
                getAll: jest.fn().mockRejectedValue(new Error("Connection lost")),
            });
            const targetDAO = makeMockDAO();

            const pump = new DataMigrationPump({
                entityTypes: [{entityType: "User", sourceDAO, targetDAO}],
            });

            const result = await pump.run();

            expect(result.success).toBe(false);
            expect(result.entityResults[0].failedCount).toBe(1);
            expect(result.entityResults[0].errors[0].phase).toBe("extract");
        });
    });

    describe("Rollback", () => {
        it("rolls back loaded records on failure when rollbackOnFailure=true", async () => {
            const sourceRecords = [
                {_id: "1", name: "Alice"},
                {_id: "2", name: "Bob"},
                {_id: "3", name: "Charlie"},
            ];

            const sourceDAO = makeMockDAO(sourceRecords);
            let callCount = 0;
            const targetDAO = makeMockDAO([], {
                create: jest.fn(async (doc: any): Promise<[any, any]> => {
                    callCount++;
                    if (callCount === 3) throw new Error("Failure on third record");
                    return [{...doc, _id: `saved-${callCount}`}, undefined] as [any, any];
                }),
            });

            const pump = new DataMigrationPump({
                entityTypes: [{entityType: "User", sourceDAO, targetDAO}],
                onError: "abort",
                rollbackOnFailure: true,
            });

            const result = await pump.run();

            expect(result.rolledBack).toBe(true);
            expect(result.rollbackCount).toBe(2); // 2 were loaded before failure
            expect(targetDAO.delete).toHaveBeenCalled();
        });

        it("does not rollback when rollbackOnFailure=false", async () => {
            const sourceRecords = [
                {_id: "1", name: "Alice"},
                {_id: "2", name: "Bob"},
            ];

            const sourceDAO = makeMockDAO(sourceRecords);
            let callCount = 0;
            const targetDAO = makeMockDAO([], {
                create: jest.fn(async (doc: any): Promise<[any, any]> => {
                    callCount++;
                    if (callCount === 2) throw new Error("Failure");
                    return [{...doc, _id: `saved-${callCount}`}, undefined] as [any, any];
                }),
            });

            const pump = new DataMigrationPump({
                entityTypes: [{entityType: "User", sourceDAO, targetDAO}],
                onError: "abort",
                rollbackOnFailure: false,
            });

            const result = await pump.run();

            expect(result.rolledBack).toBe(false);
            expect(result.rollbackCount).toBe(0);
            expect(targetDAO.delete).not.toHaveBeenCalled();
        });
    });

    describe("Progress reporting", () => {
        it("calls progress callback during migration", async () => {
            const sourceRecords = Array.from({length: 25}, (_, i) => ({
                _id: `r${i}`,
                name: `Record${i}`,
            }));

            const sourceDAO = makeMockDAO(sourceRecords);
            const targetDAO = makeMockDAO();

            const progressCalls: any[] = [];

            const pump = new DataMigrationPump({
                entityTypes: [{entityType: "Record", sourceDAO, targetDAO}],
                batchSize: 10,
                onProgress: (p) => progressCalls.push(p),
            });

            await pump.run();

            expect(progressCalls.length).toBeGreaterThan(0);
            expect(progressCalls[0].entityType).toBe("Record");
            expect(progressCalls[progressCalls.length - 1].processed).toBe(25);
            expect(progressCalls[progressCalls.length - 1].succeeded).toBe(25);
        });
    });

    describe("Incremental migration", () => {
        it("filters records by migrateSince", async () => {
            const old1 = {_id: "1", name: "Old", updatedDate: "2023-01-01T00:00:00.000Z"};
            const new1 = {_id: "2", name: "New", updatedDate: "2024-06-01T00:00:00.000Z"};
            const new2 = {_id: "3", name: "Newer", updatedDate: "2024-12-01T00:00:00.000Z"};

            const sourceDAO = makeMockDAO([old1, new1, new2]);
            const targetDAO = makeMockDAO();

            const pump = new DataMigrationPump({
                entityTypes: [{entityType: "User", sourceDAO, targetDAO}],
                migrateSince: new Date("2024-01-01"),
            });

            const result = await pump.run();

            expect(result.totalSourceRecords).toBe(2); // Only new1 and new2
            expect(result.totalMigrated).toBe(2);
        });

        it("migrates all when migrateSince is not set", async () => {
            const records = [
                {_id: "1", name: "Old", updatedDate: "2020-01-01"},
                {_id: "2", name: "New", updatedDate: "2024-01-01"},
            ];

            const sourceDAO = makeMockDAO(records);
            const targetDAO = makeMockDAO();

            const pump = new DataMigrationPump({
                entityTypes: [{entityType: "User", sourceDAO, targetDAO}],
            });

            const result = await pump.run();

            expect(result.totalSourceRecords).toBe(2);
        });
    });

    describe("Multiple entity types", () => {
        it("migrates multiple entity types in one run", async () => {
            const userSource = makeMockDAO([{_id: "u1", name: "Alice"}]);
            const userTarget = makeMockDAO();
            const productSource = makeMockDAO([{_id: "p1", name: "Widget"}]);
            const productTarget = makeMockDAO();

            const pump = new DataMigrationPump({
                entityTypes: [
                    {entityType: "User", sourceDAO: userSource, targetDAO: userTarget},
                    {entityType: "Product", sourceDAO: productSource, targetDAO: productTarget},
                ],
            });

            const result = await pump.run();

            expect(result.success).toBe(true);
            expect(result.entityResults).toHaveLength(2);
            expect(result.totalMigrated).toBe(2);
            expect(result.entityResults[0].entityType).toBe("User");
            expect(result.entityResults[1].entityType).toBe("Product");
        });

        it("stops processing entity types when onError=abort and first fails", async () => {
            const userSource = makeMockDAO([{_id: "u1"}], {
                getAll: jest.fn().mockRejectedValue(new Error("DB down")),
            });
            const userTarget = makeMockDAO();
            const productSource = makeMockDAO([{_id: "p1"}]);
            const productTarget = makeMockDAO();

            const pump = new DataMigrationPump({
                entityTypes: [
                    {entityType: "User", sourceDAO: userSource, targetDAO: userTarget},
                    {entityType: "Product", sourceDAO: productSource, targetDAO: productTarget},
                ],
                onError: "abort",
                rollbackOnFailure: false,
            });

            const result = await pump.run();

            expect(result.entityResults).toHaveLength(1); // Only User attempted
            expect(productTarget.create).not.toHaveBeenCalled();
        });
    });

    describe("Custom transformers", () => {
        it("applies custom transform function during migration", async () => {
            const sourceRecords = [
                {_id: "1", firstName: "Alice", lastName: "Smith"},
            ];

            const sourceDAO = makeMockDAO(sourceRecords);
            const targetDAO = makeMockDAO();

            const pump = new DataMigrationPump({
                entityTypes: [{
                    entityType: "User",
                    sourceDAO,
                    targetDAO,
                    fieldMappings: [
                        {sourceField: "firstName", targetField: "givenName"},
                        {sourceField: "lastName", targetField: "familyName"},
                    ],
                    customTransform: (record: any) => ({
                        ...record,
                        fullName: `${record.givenName} ${record.familyName}`,
                    }),
                }],
            });

            const result = await pump.run();

            expect(result.success).toBe(true);
            expect(targetDAO.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    givenName: "Alice",
                    familyName: "Smith",
                    fullName: "Alice Smith",
                }),
            );
        });

        it("strips source metadata during migration", async () => {
            const sourceRecords = [
                {_id: "1", _rev: "1-a", entityType: "User", appVersion: "1.0.0", name: "Alice"},
            ];

            const sourceDAO = makeMockDAO(sourceRecords);
            const targetDAO = makeMockDAO();

            const pump = new DataMigrationPump({
                entityTypes: [{entityType: "User", sourceDAO, targetDAO}],
            });

            await pump.run();

            const createCall = (targetDAO.create as jest.Mock).mock.calls[0][0];
            expect(createCall).not.toHaveProperty("_rev");
            expect(createCall).not.toHaveProperty("entityType");
            expect(createCall).not.toHaveProperty("appVersion");
            expect(createCall.name).toBe("Alice");
        });
    });
});
