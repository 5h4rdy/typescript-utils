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

PouchDB.plugin(memoryAdapter);

// -- TypeORM test entities --

@Entity("users")
class UserEntity extends GenericOrmDoc {
    @Column({type: "varchar"})
    name!: string;

    @Column({type: "varchar"})
    email!: string;

    @Column({type: "integer", nullable: true})
    age?: number;
}

@Entity("products")
class ProductEntity extends GenericOrmDoc {
    @Column({type: "varchar"})
    name!: string;

    @Column({type: "varchar"})
    sku!: string;

    @Column({type: "float", nullable: true})
    price?: number;
}

// -- Helpers --

async function createSqliteDataSource(): Promise<DataSource> {
    const ds = new DataSource({
        type: "better-sqlite3",
        database: ":memory:",
        entities: [UserEntity, ProductEntity],
        synchronize: true,
        dropSchema: true,
    });
    await ds.initialize();
    return ds;
}

// -- Mock DAO factory for large-scale tests --

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

// ============== INTEGRATION TESTS ==============

describe("DataMigrationPump Integration Tests", () => {

    describe("PouchDB → SQLite migration", () => {
        it("migrates realistic data from PouchDB to SQLite", async () => {
            const pouchDb = new PouchDB("int-src-" + uuidv4(), {adapter: "memory"});
            const pouchDAO = new GenericPouchDAO(pouchDb, new GenericPouchMapper(), "User", "1.0.0");

            // Seed PouchDB with 20 users
            for (let i = 0; i < 20; i++) {
                await pouchDAO.create({
                    _id: undefined,
                    entityType: undefined,
                    name: `User${i}`,
                    email: `user${i}@test.com`,
                    age: 20 + i,
                } as any);
            }

            // Create SQLite target
            const ds = await createSqliteDataSource();
            const ormDAO = new GenericOrmDAO(UserEntity, new GenericOrmMapper(), ds.manager, "1.0.0");

            const pump = new DataMigrationPump({
                entityTypes: [{
                    entityType: "User",
                    sourceDAO: pouchDAO as GenericDAO<any>,
                    targetDAO: ormDAO as GenericDAO<any>,
                }],
            });

            const result = await pump.run();

            expect(result.success).toBe(true);
            expect(result.totalSourceRecords).toBe(20);
            expect(result.totalMigrated).toBe(20);

            // Verify data in SQLite
            const sqliteRecords = await ormDAO.getAll();
            expect(sqliteRecords.length).toBe(20);

            // Verify field values
            const names = sqliteRecords.map((r: any) => r.name).sort();
            expect(names[0]).toBe("User0");
            expect(names).toContain("User19");

            const emails = sqliteRecords.map((r: any) => r.email).sort();
            expect(emails).toContain("user5@test.com");

            await pouchDb.destroy();
            await ds.destroy();
        });
    });

    describe("SQLite → PouchDB migration", () => {
        it("migrates realistic data from SQLite to PouchDB", async () => {
            const ds = await createSqliteDataSource();
            const ormDAO = new GenericOrmDAO(UserEntity, new GenericOrmMapper(), ds.manager, "1.0.0");

            // Seed SQLite with 15 users
            for (let i = 0; i < 15; i++) {
                const user = new UserEntity();
                user.name = `OrmUser${i}`;
                user.email = `orm${i}@test.com`;
                user.age = 30 + i;
                await ormDAO.create(user);
            }

            // Create PouchDB target
            const pouchDb = new PouchDB("int-tgt-" + uuidv4(), {adapter: "memory"});
            const pouchDAO = new GenericPouchDAO(pouchDb, new GenericPouchMapper(), "User", "2.0.0");

            const pump = new DataMigrationPump({
                entityTypes: [{
                    entityType: "User",
                    sourceDAO: ormDAO as GenericDAO<any>,
                    targetDAO: pouchDAO as GenericDAO<any>,
                    stripFields: ["_id", "_rev", "appVersion"],
                }],
            });

            const result = await pump.run();

            expect(result.success).toBe(true);
            expect(result.totalSourceRecords).toBe(15);
            expect(result.totalMigrated).toBe(15);

            // Verify data in PouchDB
            const pouchRecords = await pouchDAO.getAll();
            expect(pouchRecords.length).toBe(15);

            const names = pouchRecords.map((r: any) => r.name).sort();
            expect(names).toContain("OrmUser0");
            expect(names).toContain("OrmUser14");

            await pouchDb.destroy();
            await ds.destroy();
        });
    });

    describe("Large dataset migration", () => {
        it("migrates 500 records using mock DAOs to test batch processing at scale", async () => {
            // Use mock DAOs to avoid PouchDB find() 25-record limit
            const largeRecords = Array.from({length: 500}, (_, i) => ({
                _id: `rec-${i}`,
                name: `Record${i}`,
                email: `r${i}@test.com`,
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

            expect(result.success).toBe(true);
            expect(result.totalSourceRecords).toBe(500);
            expect(result.totalMigrated).toBe(500);
            expect(result.totalFailed).toBe(0);
            expect(targetDAO.create).toHaveBeenCalledTimes(500);
        });

        it("migrates batch-crossing dataset (PouchDB, 20 records, batch=5)", async () => {
            const sourceDb = new PouchDB("batch-src-" + uuidv4(), {adapter: "memory"});
            const targetDb = new PouchDB("batch-tgt-" + uuidv4(), {adapter: "memory"});

            const sourceDAO = new GenericPouchDAO(sourceDb, new GenericPouchMapper(), "User", "1.0.0");
            const targetDAO = new GenericPouchDAO(targetDb, new GenericPouchMapper(), "User", "1.0.0");

            // Seed 20 records (below PouchDB find limit of 25)
            for (let i = 0; i < 20; i++) {
                await sourceDAO.create({
                    _id: undefined, entityType: undefined,
                    name: `BatchUser${i}`, email: `batch${i}@test.com`, age: i,
                } as any);
            }

            const pump = new DataMigrationPump({
                entityTypes: [{
                    entityType: "User",
                    sourceDAO: sourceDAO as GenericDAO<any>,
                    targetDAO: targetDAO as GenericDAO<any>,
                }],
                batchSize: 5, // 4 batches
            });

            const result = await pump.run();

            expect(result.success).toBe(true);
            expect(result.totalSourceRecords).toBe(20);
            expect(result.totalMigrated).toBe(20);

            const targetRecords = await targetDAO.getAll();
            expect(targetRecords.length).toBe(20);

            await sourceDb.destroy();
            await targetDb.destroy();
        });
    });

    describe("Mixed entity types", () => {
        it("migrates Users and Products in a single run", async () => {
            // Source: PouchDB with Users and Products
            const userDb = new PouchDB("mix-user-" + uuidv4(), {adapter: "memory"});
            const prodDb = new PouchDB("mix-prod-" + uuidv4(), {adapter: "memory"});

            const userSrcDAO = new GenericPouchDAO(userDb, new GenericPouchMapper(), "User", "1.0.0");
            const prodSrcDAO = new GenericPouchDAO(prodDb, new GenericPouchMapper(), "Product", "1.0.0");

            // Seed data
            for (let i = 0; i < 10; i++) {
                await userSrcDAO.create({
                    _id: undefined, entityType: undefined,
                    name: `User${i}`, email: `u${i}@test.com`, age: 20 + i,
                } as any);
            }
            for (let i = 0; i < 5; i++) {
                await prodSrcDAO.create({
                    _id: undefined, entityType: undefined,
                    name: `Product${i}`, sku: `SKU${i}`, price: 9.99 + i,
                } as any);
            }

            // Target: SQLite
            const ds = await createSqliteDataSource();
            const userTgtDAO = new GenericOrmDAO(UserEntity, new GenericOrmMapper(), ds.manager, "1.0.0");
            const prodTgtDAO = new GenericOrmDAO(ProductEntity, new GenericOrmMapper(), ds.manager, "1.0.0");

            const pump = new DataMigrationPump({
                entityTypes: [
                    {entityType: "User", sourceDAO: userSrcDAO as GenericDAO<any>, targetDAO: userTgtDAO as GenericDAO<any>},
                    {entityType: "Product", sourceDAO: prodSrcDAO as GenericDAO<any>, targetDAO: prodTgtDAO as GenericDAO<any>},
                ],
            });

            const result = await pump.run();

            expect(result.success).toBe(true);
            expect(result.entityResults).toHaveLength(2);
            expect(result.entityResults[0].entityType).toBe("User");
            expect(result.entityResults[0].migratedCount).toBe(10);
            expect(result.entityResults[1].entityType).toBe("Product");
            expect(result.entityResults[1].migratedCount).toBe(5);
            expect(result.totalMigrated).toBe(15);

            // Verify
            const users = await userTgtDAO.getAll();
            const products = await prodTgtDAO.getAll();
            expect(users.length).toBe(10);
            expect(products.length).toBe(5);

            await userDb.destroy();
            await prodDb.destroy();
            await ds.destroy();
        });
    });

    describe("Field mapping with custom transform in integration", () => {
        it("applies field mappings and custom transforms during migration", async () => {
            const sourceDb = new PouchDB("field-src-" + uuidv4(), {adapter: "memory"});
            const targetDb = new PouchDB("field-tgt-" + uuidv4(), {adapter: "memory"});

            const sourceDAO = new GenericPouchDAO(sourceDb, new GenericPouchMapper(), "User", "1.0.0");
            const targetDAO = new GenericPouchDAO(targetDb, new GenericPouchMapper(), "User", "1.0.0");

            // Seed with "old schema" field names
            await sourceDAO.create({
                _id: undefined, entityType: undefined,
                firstName: "Alice", lastName: "Smith", yearsOld: 30,
            } as any);
            await sourceDAO.create({
                _id: undefined, entityType: undefined,
                firstName: "Bob", lastName: "Jones", yearsOld: 25,
            } as any);

            const pump = new DataMigrationPump({
                entityTypes: [{
                    entityType: "User",
                    sourceDAO: sourceDAO as GenericDAO<any>,
                    targetDAO: targetDAO as GenericDAO<any>,
                    fieldMappings: [
                        {sourceField: "firstName", targetField: "name"},
                        {sourceField: "lastName", targetField: "familyName"},
                        {sourceField: "yearsOld", targetField: "age"},
                    ],
                    customTransform: (record: any) => ({
                        ...record,
                        displayName: `${record.name} ${record.familyName}`,
                    }),
                }],
            });

            const result = await pump.run();

            expect(result.success).toBe(true);
            expect(result.totalMigrated).toBe(2);

            const targetRecords = await targetDAO.getAll();
            expect(targetRecords.length).toBe(2);

            const alice = targetRecords.find((r: any) => r.name === "Alice");
            expect(alice).toBeDefined();
            expect((alice as any).familyName).toBe("Smith");
            expect((alice as any).age).toBe(30);
            expect((alice as any).displayName).toBe("Alice Smith");

            await sourceDb.destroy();
            await targetDb.destroy();
        });
    });

    describe("PouchDB → PouchDB (different databases)", () => {
        it("migrates between two separate PouchDB instances", async () => {
            const srcDb = new PouchDB("pp-src-" + uuidv4(), {adapter: "memory"});
            const tgtDb = new PouchDB("pp-tgt-" + uuidv4(), {adapter: "memory"});

            const srcDAO = new GenericPouchDAO(srcDb, new GenericPouchMapper(), "User", "1.0.0");
            const tgtDAO = new GenericPouchDAO(tgtDb, new GenericPouchMapper(), "User", "1.0.0");

            // Seed source
            for (let i = 0; i < 5; i++) {
                await srcDAO.create({
                    _id: undefined, entityType: undefined,
                    name: `PPUser${i}`, email: `pp${i}@test.com`, age: 40 + i,
                } as any);
            }

            const pump = new DataMigrationPump({
                entityTypes: [{
                    entityType: "User",
                    sourceDAO: srcDAO as GenericDAO<any>,
                    targetDAO: tgtDAO as GenericDAO<any>,
                }],
            });

            const result = await pump.run();

            expect(result.success).toBe(true);
            expect(result.totalMigrated).toBe(5);

            const targetRecords = await tgtDAO.getAll();
            expect(targetRecords.length).toBe(5);

            // Verify data integrity
            const names = targetRecords.map((r: any) => r.name).sort();
            expect(names).toEqual(["PPUser0", "PPUser1", "PPUser2", "PPUser3", "PPUser4"]);

            await srcDb.destroy();
            await tgtDb.destroy();
        });
    });

    describe("Dry-run integration", () => {
        it("dry-run does not write to target in real PouchDB scenario", async () => {
            const srcDb = new PouchDB("dr-src-" + uuidv4(), {adapter: "memory"});
            const tgtDb = new PouchDB("dr-tgt-" + uuidv4(), {adapter: "memory"});

            const srcDAO = new GenericPouchDAO(srcDb, new GenericPouchMapper(), "User", "1.0.0");
            const tgtDAO = new GenericPouchDAO(tgtDb, new GenericPouchMapper(), "User", "1.0.0");

            for (let i = 0; i < 5; i++) {
                await srcDAO.create({
                    _id: undefined, entityType: undefined,
                    name: `DRUser${i}`, email: `dr${i}@test.com`, age: 50 + i,
                } as any);
            }

            const pump = new DataMigrationPump({
                entityTypes: [{
                    entityType: "User",
                    sourceDAO: srcDAO as GenericDAO<any>,
                    targetDAO: tgtDAO as GenericDAO<any>,
                }],
                dryRun: true,
            });

            const result = await pump.run();

            expect(result.dryRun).toBe(true);
            expect(result.totalMigrated).toBe(5); // transformed count

            const targetRecords = await tgtDAO.getAll();
            expect(targetRecords.length).toBe(0); // nothing actually written

            await srcDb.destroy();
            await tgtDb.destroy();
        });
    });

    describe("Incremental migration integration", () => {
        it("only migrates records updated after migrateSince", async () => {
            const srcDb = new PouchDB("inc-src-" + uuidv4(), {adapter: "memory"});
            const tgtDb = new PouchDB("inc-tgt-" + uuidv4(), {adapter: "memory"});

            const srcDAO = new GenericPouchDAO(srcDb, new GenericPouchMapper(), "User", "1.0.0");
            const tgtDAO = new GenericPouchDAO(tgtDb, new GenericPouchMapper(), "User", "1.0.0");

            // Create "old" records (their createdDate will be now, but we'll filter by it)
            const [old1] = await srcDAO.create({
                _id: undefined, entityType: undefined,
                name: "OldUser1", email: "old1@test.com", age: 1,
            } as any);

            // Modify createdDate to be old
            const oldDoc: any = await srcDb.get(old1._id!);
            oldDoc.updatedDate = "2020-01-01T00:00:00.000Z";
            oldDoc.createdDate = "2020-01-01T00:00:00.000Z";
            await srcDb.put(oldDoc);

            // Create "new" records (default createdDate = now)
            await srcDAO.create({
                _id: undefined, entityType: undefined,
                name: "NewUser1", email: "new1@test.com", age: 2,
            } as any);
            await srcDAO.create({
                _id: undefined, entityType: undefined,
                name: "NewUser2", email: "new2@test.com", age: 3,
            } as any);

            const pump = new DataMigrationPump({
                entityTypes: [{
                    entityType: "User",
                    sourceDAO: srcDAO as GenericDAO<any>,
                    targetDAO: tgtDAO as GenericDAO<any>,
                }],
                migrateSince: new Date("2024-01-01"),
            });

            const result = await pump.run();

            expect(result.success).toBe(true);
            expect(result.totalSourceRecords).toBe(2); // Only 2 new records
            expect(result.totalMigrated).toBe(2);

            const targetRecords = await tgtDAO.getAll();
            const names = targetRecords.map((r: any) => r.name).sort();
            expect(names).toContain("NewUser1");
            expect(names).toContain("NewUser2");
            expect(names).not.toContain("OldUser1");

            await srcDb.destroy();
            await tgtDb.destroy();
        });
    });
});
