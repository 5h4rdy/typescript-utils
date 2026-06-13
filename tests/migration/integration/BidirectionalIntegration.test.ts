import PouchDB from "pouchdb";
import memoryAdapter from "pouchdb-adapter-memory";
import {DataSource, Entity, Column} from "typeorm";
import {v4 as uuidv4} from "uuid";
import {DataMigrationPump} from "../../../src/services/migration/DataMigrationPump";
import {GenericPouchDAO} from "../../../src/services/dao/GenericPouchDAO";
import {GenericOrmDAO} from "../../../src/services/dao/GenericOrmDAO";
import {GenericPouchMapper} from "../../../src/services/dao/mapper/GenericPouchMapper";
import {GenericOrmMapper} from "../../../src/services/dao/mapper/GenericOrmMapper";
import {GenericDAO} from "../../../src/services/dao/GenericDAO";
import {GenericOrmDoc} from "../../../src/services/dao/types/DbTypes";
import {
    SchemaMapping,
    SchemaMappingRegistry,
} from "../../../src/services/migration/SchemaMapping";

PouchDB.plugin(memoryAdapter);

// ============== TYPEORM TEST ENTITIES ==============

@Entity("holiday_homes")
class HolidayHomeEntity extends GenericOrmDoc {
    @Column({type: "varchar"})
    name!: string;

    @Column({type: "varchar", nullable: true})
    parkId?: string;

    @Column({type: "integer", nullable: true})
    capacity?: number;
}

@Entity("circuits")
class CircuitEntity extends GenericOrmDoc {
    @Column({type: "varchar"})
    name!: string;

    @Column({type: "integer", nullable: true})
    ratedVoltage?: number;

    @Column({type: "varchar", nullable: true})
    holidayHomeId?: string;
}

@Entity("testers")
class TesterEntity extends GenericOrmDoc {
    @Column({type: "varchar"})
    name!: string;

    @Column({type: "varchar", nullable: true})
    email?: string;

    @Column({type: "boolean", nullable: true})
    active?: boolean;
}

// ============== HELPERS ==============

async function createSqliteDataSource(): Promise<DataSource> {
    const ds = new DataSource({
        type: "better-sqlite3",
        database: ":memory:",
        entities: [HolidayHomeEntity, CircuitEntity, TesterEntity],
        synchronize: true,
        dropSchema: true,
    });
    await ds.initialize();
    return ds;
}

// ============== BIDIRECTIONAL INTEGRATION TESTS ==============

describe("Bidirectional Migration Integration Tests", () => {

    describe("SchemaMapping-driven PouchDB → SQLite", () => {
        it("migrates with field mapping using SchemaMappingRegistry", async () => {
            const pouchDb = new PouchDB("bi-src-" + uuidv4(), {adapter: "memory"});
            const sourceDAO = new GenericPouchDAO(pouchDb, new GenericPouchMapper(), "Tester", "1.0.0");

            // Seed with PouchDB-style field names
            await sourceDAO.create({
                _id: undefined, entityType: undefined,
                fullName: "Jane Doe",
                emailAddress: "jane@test.com",
                active: true,
            } as any);
            await sourceDAO.create({
                _id: undefined, entityType: undefined,
                fullName: "Bob Smith",
                emailAddress: "bob@test.com",
                active: false,
            } as any);

            const ds = await createSqliteDataSource();
            const ormDAO = new GenericOrmDAO(TesterEntity, new GenericOrmMapper(), ds.manager, "1.0.0");

            const registry = new SchemaMappingRegistry([
                {
                    key: "Tester",
                    pouchDocTypes: ["Tester"],
                    ormEntityName: "TesterEntity",
                    forward: {
                        fieldTransforms: [
                            {sourceField: "fullName", targetField: "name"},
                            {sourceField: "emailAddress", targetField: "email"},
                        ],
                    },
                },
            ]);

            const pump = new DataMigrationPump({
                entityTypes: [{
                    entityType: "Tester",
                    sourceDAO: sourceDAO as GenericDAO<any>,
                    targetDAO: ormDAO as GenericDAO<any>,
                    schemaMappingKey: "Tester",
                }],
                schemaMappings: registry,
                direction: "pouch-to-orm",
            });

            const result = await pump.run();

            expect(result.success).toBe(true);
            expect(result.totalMigrated).toBe(2);

            // Verify mapped fields in SQLite
            const records = await ormDAO.getAll();
            expect(records.length).toBe(2);
            const jane = records.find((r: any) => r.name === "Jane Doe");
            expect(jane).toBeDefined();
            expect(jane!.email).toBe("jane@test.com");
            expect(jane!.active).toBe(true);

            await pouchDb.destroy();
            await ds.destroy();
        });
    });

    describe("SchemaMapping-driven SQLite → PouchDB (Reverse)", () => {
        it("migrates with reverse field mapping", async () => {
            const ds = await createSqliteDataSource();
            const ormDAO = new GenericOrmDAO(TesterEntity, new GenericOrmMapper(), ds.manager, "1.0.0");

            // Seed SQLite with ORM-style field names
            const tester = new TesterEntity();
            tester.name = "Alice Wonder";
            tester.email = "alice@test.com";
            tester.active = true;
            await ormDAO.create(tester);

            const tester2 = new TesterEntity();
            tester2.name = "Charlie Brown";
            tester2.email = "charlie@test.com";
            tester2.active = false;
            await ormDAO.create(tester2);

            const pouchDb = new PouchDB("bi-rev-" + uuidv4(), {adapter: "memory"});
            const targetDAO = new GenericPouchDAO(pouchDb, new GenericPouchMapper(), "Tester", "2.0.0");

            const registry = new SchemaMappingRegistry([
                {
                    key: "Tester",
                    pouchDocTypes: ["Tester"],
                    ormEntityName: "TesterEntity",
                    reverse: {
                        fieldTransforms: [
                            {sourceField: "name", targetField: "fullName"},
                            {sourceField: "email", targetField: "emailAddress"},
                        ],
                    },
                },
            ]);

            const pump = new DataMigrationPump({
                entityTypes: [{
                    entityType: "Tester",
                    sourceDAO: ormDAO as GenericDAO<any>,
                    targetDAO: targetDAO as GenericDAO<any>,
                    schemaMappingKey: "Tester",
                    stripFields: ["_id", "_rev", "appVersion"],
                }],
                schemaMappings: registry,
                direction: "orm-to-pouch",
            });

            const result = await pump.run();

            expect(result.success).toBe(true);
            expect(result.totalMigrated).toBe(2);

            // Verify reverse-mapped fields in PouchDB
            const records = await targetDAO.getAll();
            expect(records.length).toBe(2);
            const alice = records.find((r: any) => r.fullName === "Alice Wonder");
            expect(alice).toBeDefined();
            expect((alice as any).emailAddress).toBe("alice@test.com");

            await pouchDb.destroy();
            await ds.destroy();
        });
    });

    describe("Round-trip: PouchDB → SQLite → PouchDB", () => {
        it("preserves data through full round-trip with field transforms", async () => {
            // Setup: PouchDB source
            const pouchDb1 = new PouchDB("rt-src-" + uuidv4(), {adapter: "memory"});
            const srcDAO = new GenericPouchDAO(pouchDb1, new GenericPouchMapper(), "Tester", "1.0.0");

            await srcDAO.create({
                _id: undefined, entityType: undefined,
                fullName: "Round Trip",
                emailAddress: "rt@test.com",
                active: true,
            } as any);

            // SQLite intermediate
            const ds = await createSqliteDataSource();
            const ormDAO = new GenericOrmDAO(TesterEntity, new GenericOrmMapper(), ds.manager, "1.0.0");

            const registry = new SchemaMappingRegistry([
                {
                    key: "Tester",
                    pouchDocTypes: ["Tester"],
                    ormEntityName: "TesterEntity",
                    forward: {
                        fieldTransforms: [
                            {sourceField: "fullName", targetField: "name"},
                            {sourceField: "emailAddress", targetField: "email"},
                        ],
                    },
                    reverse: {
                        fieldTransforms: [
                            {sourceField: "name", targetField: "fullName"},
                            {sourceField: "email", targetField: "emailAddress"},
                        ],
                    },
                },
            ]);

            // Phase 1: PouchDB → SQLite
            const pump1 = new DataMigrationPump({
                entityTypes: [{
                    entityType: "Tester",
                    sourceDAO: srcDAO as GenericDAO<any>,
                    targetDAO: ormDAO as GenericDAO<any>,
                    schemaMappingKey: "Tester",
                }],
                schemaMappings: registry,
                direction: "pouch-to-orm",
            });

            const result1 = await pump1.run();
            expect(result1.success).toBe(true);
            expect(result1.totalMigrated).toBe(1);

            // Verify SQLite has ORM field names
            const ormRecords = await ormDAO.getAll();
            expect(ormRecords[0].name).toBe("Round Trip");
            expect(ormRecords[0].email).toBe("rt@test.com");

            // Phase 2: SQLite → PouchDB (different instance)
            const pouchDb2 = new PouchDB("rt-dst-" + uuidv4(), {adapter: "memory"});
            const dstDAO = new GenericPouchDAO(pouchDb2, new GenericPouchMapper(), "Tester", "2.0.0");

            const pump2 = new DataMigrationPump({
                entityTypes: [{
                    entityType: "Tester",
                    sourceDAO: ormDAO as GenericDAO<any>,
                    targetDAO: dstDAO as GenericDAO<any>,
                    schemaMappingKey: "Tester",
                    stripFields: ["_id", "_rev", "appVersion"],
                }],
                schemaMappings: registry,
                direction: "orm-to-pouch",
            });

            const result2 = await pump2.run();
            expect(result2.success).toBe(true);
            expect(result2.totalMigrated).toBe(1);

            // Verify PouchDB has original field names back
            const pouchRecords = await dstDAO.getAll();
            expect(pouchRecords.length).toBe(1);
            expect((pouchRecords[0] as any).fullName).toBe("Round Trip");
            expect((pouchRecords[0] as any).emailAddress).toBe("rt@test.com");
            expect((pouchRecords[0] as any).active).toBe(true);

            await pouchDb1.destroy();
            await pouchDb2.destroy();
            await ds.destroy();
        });
    });

    describe("Multiple docTypes → single entity", () => {
        it("migrates records with different docTypes to the same entity type", async () => {
            // Use mock DAOs since PouchDAO sets entityType on create
            function makeMockDAO(records: any[] = []): GenericDAO<any> {
                const store = [...records];
                return {
                    getAll: jest.fn(async () => [...store]),
                    getOne: jest.fn(async () => store[0]),
                    getMany: jest.fn(async () => store),
                    create: jest.fn(async (doc: any) => {
                        const saved = {...doc, _id: doc._id || `gen-${uuidv4()}`, _rev: "1-mock"};
                        store.push(saved);
                        return [saved, undefined] as [any, any];
                    }),
                    update: jest.fn(async (doc: any) => [doc, undefined]),
                    delete: jest.fn(async () => ["1", undefined]),
                    findByField: jest.fn(async () => store),
                    getNextSequenceId: jest.fn(async () => 1),
                    getMapper: jest.fn(() => new GenericPouchMapper()),
                } as unknown as GenericDAO<any>;
            }

            // Source with mixed docTypes
            const sourceRecords = [
                {_id: "t1", docType: "tester", name: "Alice", _rev: "1-a", entityType: "tester"},
                {_id: "t2", docType: "tester_legacy", name: "Bob", _rev: "1-b", entityType: "tester_legacy"},
            ];
            const sourceDAO = makeMockDAO(sourceRecords);
            const targetDAO = makeMockDAO();

            const registry = new SchemaMappingRegistry([
                {
                    key: "Tester",
                    pouchDocTypes: ["tester", "tester_legacy"],
                    ormEntityName: "TesterEntity",
                },
            ]);

            const pump = new DataMigrationPump({
                entityTypes: [{
                    entityType: "Tester",
                    sourceDAO,
                    targetDAO,
                    schemaMappingKey: "Tester",
                }],
                schemaMappings: registry,
                direction: "pouch-to-orm",
            });

            const result = await pump.run();

            expect(result.success).toBe(true);
            expect(result.totalMigrated).toBe(2);
        });
    });

    describe("SchemaMapping without direction (backward compatibility)", () => {
        it("falls back to EntityTypeTransform when no SchemaMapping provided", async () => {
            function makeMockDAO(records: any[] = []): GenericDAO<any> {
                const store = [...records];
                return {
                    getAll: jest.fn(async () => [...store]),
                    getOne: jest.fn(async () => store[0]),
                    getMany: jest.fn(async () => store),
                    create: jest.fn(async (doc: any) => {
                        const saved = {...doc, _id: `gen-${uuidv4()}`, _rev: "1-mock"};
                        store.push(saved);
                        return [saved, undefined] as [any, any];
                    }),
                    update: jest.fn(async (doc: any) => [doc, undefined]),
                    delete: jest.fn(async () => ["1", undefined]),
                    findByField: jest.fn(async () => store),
                    getNextSequenceId: jest.fn(async () => 1),
                    getMapper: jest.fn(() => new GenericPouchMapper()),
                } as unknown as GenericDAO<any>;
            }

            const sourceDAO = makeMockDAO([{_id: "1", name: "Test", _rev: "1"}]);
            const targetDAO = makeMockDAO();

            // No schemaMappings — should use EntityTypeTransform fields directly
            const pump = new DataMigrationPump({
                entityTypes: [{
                    entityType: "User",
                    sourceDAO,
                    targetDAO,
                    fieldMappings: [{sourceField: "name", targetField: "fullName"}],
                }],
            });

            const result = await pump.run();

            expect(result.success).toBe(true);
            expect(result.totalMigrated).toBe(1);
            expect(targetDAO.create).toHaveBeenCalledWith(
                expect.objectContaining({fullName: "Test"}),
            );
        });
    });

    describe("Inheritance pattern: HolidayHome extends Entity", () => {
        it("maps inherited and specific fields correctly", async () => {
            const pouchDb = new PouchDB("inh-src-" + uuidv4(), {adapter: "memory"});
            const sourceDAO = new GenericPouchDAO(pouchDb, new GenericPouchMapper(), "holidayHome", "1.0.0");

            // Seed a HolidayHome doc — has Entity base fields + specific ones
            await sourceDAO.create({
                _id: undefined, entityType: undefined,
                homeName: "Cliffside Lodge",
                parkRef: "park-001",
                capacity: 12,
            } as any);

            const ds = await createSqliteDataSource();
            const ormDAO = new GenericOrmDAO(HolidayHomeEntity, new GenericOrmMapper(), ds.manager, "1.0.0");

            const registry = new SchemaMappingRegistry([
                {
                    key: "HolidayHome",
                    pouchDocTypes: ["holidayHome"],
                    ormEntityName: "HolidayHomeEntity",
                    forward: {
                        fieldTransforms: [
                            {sourceField: "homeName", targetField: "name"},
                            {sourceField: "parkRef", targetField: "parkId"},
                        ],
                    },
                },
            ]);

            const pump = new DataMigrationPump({
                entityTypes: [{
                    entityType: "holidayHome",
                    sourceDAO: sourceDAO as GenericDAO<any>,
                    targetDAO: ormDAO as GenericDAO<any>,
                    schemaMappingKey: "HolidayHome",
                }],
                schemaMappings: registry,
                direction: "pouch-to-orm",
            });

            const result = await pump.run();

            expect(result.success).toBe(true);
            expect(result.totalMigrated).toBe(1);

            const records = await ormDAO.getAll();
            expect(records.length).toBe(1);
            expect(records[0].name).toBe("Cliffside Lodge");
            expect(records[0].parkId).toBe("park-001");
            expect(records[0].capacity).toBe(12);

            await pouchDb.destroy();
            await ds.destroy();
        });
    });
});
