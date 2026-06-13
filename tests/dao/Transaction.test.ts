import {DataSource, Entity} from "typeorm";
import PouchDB from "pouchdb";
import memoryAdapter from "pouchdb-adapter-memory";
import {v4 as uuidv4} from "uuid";

import {
    Transaction,
    TransactionManager,
    PouchTransaction,
    TypeORMTransactionWrapper
} from "../../src/services/dao/Transaction";
import {GenericDAO} from "../../src/services/dao/GenericDAO";
import {GenericPouchDAO} from "../../src/services/dao/GenericPouchDAO";
import {GenericOrmDAO} from "../../src/services/dao/GenericOrmDAO";
import {GenericPouchMapper} from "../../src/services/dao/mapper/GenericPouchMapper";
import {GenericOrmMapper} from "../../src/services/dao/mapper/GenericOrmMapper";
import {GenericOrmDoc, OrmCounter} from "../../src/services/dao/types/DbTypes";
import {TestDoc} from "./TestDoc";

PouchDB.plugin(memoryAdapter);

@Entity()
class SimpleOrmDoc extends GenericOrmDoc {
    // intentionally minimal — just tests the infrastructure
}

describe("TransactionManager", () => {
    it("creates a PouchTransaction for PouchDB DAOs", () => {
        const db = new PouchDB("tx-test-" + uuidv4(), {adapter: "memory"});
        const dao = new GenericPouchDAO<TestDoc>(db, new GenericPouchMapper(), "Test|", "1.0.0");
        const tx = TransactionManager.createTransaction(dao);
        expect(tx).toBeInstanceOf(PouchTransaction);
        db.destroy();
    });

    it("creates a TypeORMTransactionWrapper for ORM DAOs", async () => {
        const ds = new DataSource({
            type: "sqlite",
            database: ":memory:",
            entities: [GenericOrmDoc, OrmCounter, SimpleOrmDoc],
            synchronize: true,
        });
        await ds.initialize();
        const dao = new GenericOrmDAO<SimpleOrmDoc>(SimpleOrmDoc, new GenericOrmMapper(), ds.manager, "1.0.0");
        const tx = TransactionManager.createTransaction(dao);
        expect(tx).toBeInstanceOf(TypeORMTransactionWrapper);
        // The constructor calls start() asynchronously; give it time to settle
        await new Promise(resolve => setTimeout(resolve, 100));
        await tx.release();
        await ds.destroy();
    });

    it("throws for unknown DAO type", () => {
        const fakeDao = {} as GenericDAO<any>;
        expect(() => TransactionManager.createTransaction(fakeDao)).toThrow();
    });
});

describe("PouchTransaction", () => {
    let tx: PouchTransaction;

    beforeEach(() => {
        tx = new PouchTransaction();
    });

    it("registers and executes undo functions on rollback (reverse order)", async () => {
        const calls: string[] = [];
        tx.registerUndo(async () => { calls.push("first"); });
        tx.registerUndo(async () => { calls.push("second"); });

        await tx.rollback();

        // reverse order
        expect(calls).toEqual(["second", "first"]);
    });

    it("commit is a no-op (resolves)", async () => {
        await expect(tx.commit()).resolves.toBeUndefined();
    });

    it("release clears undo functions", async () => {
        tx.registerUndo(async () => {});
        tx.registerUndo(async () => {});
        await tx.release();
        // After release, rollback should do nothing
        await expect(tx.rollback()).resolves.toBeUndefined();
    });

    it("rollback propagates errors as RollbackError", async () => {
        tx.registerUndo(async () => { throw new Error("undo failed"); });
        await expect(tx.rollback()).rejects.toThrow("Failed during rollback");
    });
});

describe("PouchTransaction lifecycle", () => {
    let db: PouchDB.Database;
    let dao: GenericDAO<TestDoc>;

    beforeEach(() => {
        db = new PouchDB("tx-lifecycle-" + uuidv4(), {adapter: "memory"});
        dao = new GenericPouchDAO<TestDoc>(db, new GenericPouchMapper(), "Test|", "1.0.0");
    });

    afterEach(async () => {
        await db.destroy();
    });

    it("commit then release cleans up cleanly", async () => {
        const tx = TransactionManager.createTransaction(dao);
        const doc: TestDoc = {
            _id: undefined, entityType: undefined,
            name: "commit-test", value: "val"
        };
        await dao.create(doc, tx);
        await tx.commit();
        await tx.release();

        const all = await dao.getAll();
        expect(all.length).toBe(1);
    });

    it("multiple undos in a single transaction", async () => {
        const tx = TransactionManager.createTransaction(dao);

        const doc1: TestDoc = {
            _id: undefined, entityType: undefined,
            name: "a", value: "1"
        };
        const doc2: TestDoc = {
            _id: undefined, entityType: undefined,
            name: "b", value: "2"
        };

        await dao.create(doc1, tx);
        await dao.create(doc2, tx);

        expect((await dao.getAll()).length).toBe(2);

        await tx.rollback();

        expect((await dao.getAll()).length).toBe(0);
    });
});

describe("TypeORMTransactionWrapper", () => {
    let dataSource: DataSource;
    let dao: GenericDAO<SimpleOrmDoc>;

    beforeEach(async () => {
        dataSource = new DataSource({
            type: "sqlite",
            database: ":memory:",
            entities: [GenericOrmDoc, OrmCounter, SimpleOrmDoc],
            synchronize: true,
        });
        await dataSource.initialize();
        dao = new GenericOrmDAO<SimpleOrmDoc>(SimpleOrmDoc, new GenericOrmMapper(), dataSource.manager, "1.0.0");
    });

    afterEach(async () => {
        await dataSource.destroy();
    });

    it("supports commit lifecycle", async () => {
        const tx = TransactionManager.createTransaction(dao);
        // Allow the async start() in the constructor to settle
        await new Promise(resolve => setTimeout(resolve, 50));

        const doc = new SimpleOrmDoc();

        await dao.create(doc, tx);
        await tx.commit();

        const all = await dao.getAll();
        expect(all.length).toBe(1);
    });

    it("supports rollback lifecycle", async () => {
        const tx = TransactionManager.createTransaction(dao);
        // Allow the async start() in the constructor to settle
        await new Promise(resolve => setTimeout(resolve, 50));

        const doc = new SimpleOrmDoc();

        await dao.create(doc, tx);
        expect((await dao.getAll()).length).toBe(1);

        await tx.rollback();

        expect((await dao.getAll()).length).toBe(0);
    });
});
