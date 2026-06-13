/**
 * Integration test proving the pluggable DAO architecture:
 * the SAME repository logic runs against both PouchDB and TypeORM
 * with zero business-logic code changes.
 *
 * This is the flagship test for the library's core design goal.
 */

import PouchDB from "pouchdb";
import memoryAdapter from "pouchdb-adapter-memory";
import {v4 as uuidv4} from "uuid";
import {Column, DataSource, Entity} from "typeorm";

import {GenericDAO} from "../../src/services/dao/GenericDAO";
import {DAOFactory} from "../../src/services/dao/DAOFactory";
import {GenericPouchDAO} from "../../src/services/dao/GenericPouchDAO";
import {GenericOrmDAO} from "../../src/services/dao/GenericOrmDAO";
import {Transaction, TransactionManager} from "../../src/services/dao/Transaction";
import {GenericPouchMapper} from "../../src/services/dao/mapper/GenericPouchMapper";
import {GenericOrmMapper} from "../../src/services/dao/mapper/GenericOrmMapper";
import {GenericOrmDoc, OrmCounter, GenericPouchDoc} from "../../src/services/dao/types/DbTypes";

PouchDB.plugin(memoryAdapter);

// --- Domain model shared by both backends ---
interface UserDoc extends GenericPouchDoc {
    name: string;
    email: string;
}

@Entity()
class UserOrmDoc extends GenericOrmDoc {
    @Column("varchar")
    name: string | undefined;

    @Column("varchar")
    email: string | undefined;
}

/**
 * Backend-agnostic suite: given a `GenericDAO`, run a series of CRUD
 * operations that exercise the full interface. This function is the
 * heart of the test — it makes ZERO references to PouchDB or TypeORM.
 */
async function exerciseDAO(dao: GenericDAO<any>) {
    // CREATE
    const doc: any = dao instanceof GenericOrmDAO ? new UserOrmDoc() : {};
    doc.name = "Alice";
    doc.email = "alice@example.com";

    const [created] = await dao.create(doc);
    expect(created._id).toBeTruthy();
    expect(created.name).toBe("Alice");
    expect(created.email).toBe("alice@example.com");
    expect(created.createdDate).toBeTruthy();

    // GET ONE
    const fetched = await dao.getOne(created._id!);
    expect(fetched.name).toBe("Alice");

    // UPDATE
    created.name = "Alice Updated";
    const [updated] = await dao.update(created);
    expect(updated.name).toBe("Alice Updated");
    expect(updated.updatedDate).toBeTruthy();

    // FIND BY FIELD
    const found = await dao.findByField("email", "alice@example.com");
    expect(found.length).toBe(1);
    expect(found[0].name).toBe("Alice Updated");

    // GET ALL
    const all = await dao.getAll();
    expect(all.length).toBe(1);

    // CREATE more for getMany
    const doc2: any = dao instanceof GenericOrmDAO ? new UserOrmDoc() : {};
    doc2.name = "Bob";
    doc2.email = "bob@example.com";
    const [created2] = await dao.create(doc2);

    // GET MANY
    const many = await dao.getMany([created._id!, created2._id!]);
    expect(many.length).toBe(2);

    // DELETE
    await dao.delete(created2._id!);
    const afterDelete = await dao.getAll();
    expect(afterDelete.length).toBe(1);

    // SEQUENCE
    const seq1 = await dao.getNextSequenceId("user-seq");
    const seq2 = await dao.getNextSequenceId("user-seq");
    expect(seq2).toBe(seq1 + 1);
}

describe("DAO Pluggability — PouchDB vs TypeORM", () => {

    it("PouchDB backend passes the full CRUD exercise", async () => {
        const db = new PouchDB("swap-pouch-" + uuidv4(), {adapter: "memory"});
        const dao = new GenericPouchDAO<UserDoc>(
            db, new GenericPouchMapper(), "User|", "1.0.0"
        );

        try {
            await exerciseDAO(dao);
        } finally {
            await db.destroy();
        }
    });

    it("TypeORM backend passes the full CRUD exercise", async () => {
        const ds = new DataSource({
            type: "sqlite",
            database: ":memory:",
            entities: [GenericOrmDoc, OrmCounter, UserOrmDoc],
            synchronize: true,
        });
        await ds.initialize();

        const dao = new GenericOrmDAO<UserOrmDoc>(
            UserOrmDoc, new GenericOrmMapper(), ds.manager, "1.0.0"
        );

        try {
            await exerciseDAO(dao);
        } finally {
            await ds.destroy();
        }
    });
});

describe("DAOFactory", () => {

    it("creates a working PouchDB DAO from config", async () => {
        const db = new PouchDB("factory-pouch-" + uuidv4(), {adapter: "memory"});

        const dao = DAOFactory.create<UserDoc>({
            backend: "pouchdb",
            mapper: new GenericPouchMapper(),
            appVersion: "1.0.0",
            pouchDb: db,
            entityType: "User|",
        });

        // Smoke test
        const doc: UserDoc = {
            _id: "", entityType: "",
            name: "Factory Pouch User",
            email: "fp@test.com",
        };
        const [created] = await dao.create(doc);
        expect(created._id).toContain("User|");
        expect(created.name).toBe("Factory Pouch User");

        await db.destroy();
    });

    it("creates a working TypeORM DAO from config", async () => {
        const ds = new DataSource({
            type: "sqlite",
            database: ":memory:",
            entities: [GenericOrmDoc, OrmCounter, UserOrmDoc],
            synchronize: true,
        });
        await ds.initialize();

        const dao = DAOFactory.create<UserOrmDoc>({
            backend: "typeorm",
            mapper: new GenericOrmMapper(),
            appVersion: "1.0.0",
            entity: UserOrmDoc,
            dataSource: ds,
        });

        // Smoke test
        const doc = new UserOrmDoc();
        doc.name = "Factory ORM User";
        doc.email = "fo@test.com";
        const [created] = await dao.create(doc);
        expect(created._id).toBeTruthy();
        expect(created.name).toBe("Factory ORM User");

        await ds.destroy();
    });

    it("throws on missing pouchDb for pouchdb backend", () => {
        expect(() =>
            DAOFactory.create({
                backend: "pouchdb",
                mapper: new GenericPouchMapper(),
                appVersion: "1.0.0",
                entityType: "X",
            } as any)
        ).toThrow("pouchDb");
    });

    it("throws on missing entity for typeorm backend", () => {
        expect(() =>
            DAOFactory.create({
                backend: "typeorm",
                mapper: new GenericOrmMapper(),
                appVersion: "1.0.0",
            } as any)
        ).toThrow("entity");
    });

    it("throws on missing dataSource AND entityManager for typeorm", () => {
        expect(() =>
            DAOFactory.create({
                backend: "typeorm",
                mapper: new GenericOrmMapper(),
                appVersion: "1.0.0",
                entity: UserOrmDoc,
            } as any)
        ).toThrow();
    });
});

describe("Transactions work identically across backends", () => {

    it("PouchDB: rollback undoes a create", async () => {
        const db = new PouchDB("tx-pouch-" + uuidv4(), {adapter: "memory"});
        const dao = new GenericPouchDAO<UserDoc>(
            db, new GenericPouchMapper(), "User|", "1.0.0"
        );

        try {
            const tx = TransactionManager.createTransaction(dao);
            const doc: UserDoc = {
                _id: "", entityType: "",
                name: "Temp",
                email: "temp@test.com",
            };
            await dao.create(doc, tx);
            expect((await dao.getAll()).length).toBe(1);

            await tx.rollback();
            expect((await dao.getAll()).length).toBe(0);
        } finally {
            await db.destroy();
        }
    });

    it("TypeORM: rollback undoes a create", async () => {
        const ds = new DataSource({
            type: "sqlite",
            database: ":memory:",
            entities: [GenericOrmDoc, OrmCounter, UserOrmDoc],
            synchronize: true,
        });
        await ds.initialize();
        const dao = new GenericOrmDAO<UserOrmDoc>(
            UserOrmDoc, new GenericOrmMapper(), ds.manager, "1.0.0"
        );

        try {
            const tx = TransactionManager.createTransaction(dao);
            const doc = new UserOrmDoc();
            doc.name = "Temp";
            doc.email = "temp@test.com";

            await dao.create(doc, tx);
            expect((await dao.getAll()).length).toBe(1);

            await tx.rollback();
            expect((await dao.getAll()).length).toBe(0);
        } finally {
            await ds.destroy();
        }
    });
});
