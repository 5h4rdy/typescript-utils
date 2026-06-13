import PouchDB from "pouchdb";
import memoryAdapter from "pouchdb-adapter-memory";
import {v4 as uuidv4} from "uuid";
import {
    BaseRepository
} from "../../src/services/repositories/BaseRepository";
import {GenericDAO} from "../../src/services/dao/GenericDAO";
import {GenericPouchDAO} from "../../src/services/dao/GenericPouchDAO";
import {GenericPouchMapper} from "../../src/services/dao/mapper/GenericPouchMapper";
import {GenericDoc} from "../../src/services/dao/types/DbTypes";
import {DatabaseError} from "../../src/errors/Errors";

PouchDB.plugin(memoryAdapter);

// A test repository that wraps a PouchDB DAO
class TestPouchRepository extends BaseRepository {
    private dao: GenericDAO<GenericDoc>;

    constructor(dao: GenericDAO<GenericDoc>) {
        super();
        this.dao = dao;
    }

    protected getDAO(): GenericDAO<GenericDoc> {
        return this.dao;
    }

    async createWithTransaction(name: string): Promise<any> {
        return this.withTransaction(async (tx) => {
            return this.dao.create({_id: "", entityType: "test", name} as GenericDoc, tx);
        });
    }

    async createFailing(name: string): Promise<any> {
        return this.withTransaction(async (tx) => {
            await this.dao.create({_id: "", entityType: "test", name} as GenericDoc, tx);
            throw new Error("intentional failure");
        });
    }
}

describe("BaseRepository", () => {
    let db: PouchDB.Database;
    let repo: TestPouchRepository;

    beforeEach(() => {
        db = new PouchDB("repo-test-" + uuidv4(), {adapter: "memory"});
        const dao = new GenericPouchDAO(db, new GenericPouchMapper(), "test", "1.0.0");
        repo = new TestPouchRepository(dao);
    });

    afterEach(async () => {
        await db.destroy();
    });

    it("commits on success", async () => {
        const [saved] = await repo.createWithTransaction("committed-doc");
        expect(saved._id).toBeTruthy();

        const all = await db.allDocs({include_docs: true});
        const dataDocs = all.rows.filter(r => r.doc && !r.id.startsWith("_design"));
        expect(dataDocs.length).toBe(1);
    });

    it("rolls back on failure and rethrows as DatabaseError", async () => {
        await expect(repo.createFailing("rolled-back-doc")).rejects.toThrow(DatabaseError);

        const all = await db.allDocs({include_docs: true});
        const dataDocs = all.rows.filter(r => r.doc && !r.id.startsWith("_design"));
        expect(dataDocs.length).toBe(0);
    });
});
