import {Column, DataSource, Entity} from "typeorm";
import {GenericDAO} from "../../src/services/dao/GenericDAO";
import {GenericOrmDAO} from "../../src/services/dao/GenericOrmDAO";
import {TransactionManager} from "../../src/services/dao/Transaction";
import {GenericOrmDoc, OrmCounter} from "../../src/services/dao/types/DbTypes";
import {GenericOrmMapper} from "../../src/services/dao/mapper/GenericOrmMapper";

@Entity()
export class ExampleDoc extends GenericOrmDoc {
    @Column("varchar")
    name: string | undefined;

    @Column("varchar")
    value: string | undefined;
}

describe('GenericOrmDAO', () => {
    let dataSource: DataSource;
    let genericDAO: GenericDAO<ExampleDoc>;

    beforeEach(async () => {
        dataSource = new DataSource({
            type: 'sqlite',
            database: ':memory:',
            entities: [GenericOrmDoc, OrmCounter, ExampleDoc],
            synchronize: true
        });
        await dataSource.initialize();

        genericDAO = new GenericOrmDAO(ExampleDoc, new GenericOrmMapper(), dataSource.manager, "0.0.1-alpha");
    });

    afterEach(async () => {
        await dataSource.destroy();
    });
    describe('GenericOrmDAO', () => {

        it('creates and retrieves a document', async () => {
            const doc = new ExampleDoc();
            doc.name = "SomeThing";
            doc.value = "Some Value";

            const [savedEntity] = await genericDAO.create(doc);
            expect(savedEntity._id).toBeTruthy();

            const retrievedDoc = await genericDAO.getOne(savedEntity._id!);
            expect(retrievedDoc._id).toBe(savedEntity._id);
            expect(retrievedDoc.appVersion).toBe("0.0.1-alpha");
            expect(retrievedDoc.value).toBe(doc.value);
        });

        it('updates a document', async () => {
            const doc = new ExampleDoc();
            doc.name = "SomeThing";
            doc.value = "Some Value";
            const [savedEntity] = await genericDAO.create(doc);
            savedEntity.value = "Updated Value";

            const [updatedEntity] = await genericDAO.update(savedEntity);

            const retrievedDoc = await genericDAO.getOne(updatedEntity._id!);
            expect(retrievedDoc.value).toBe("Updated Value");
        });

        it('deletes a document', async () => {
            const doc = new ExampleDoc();
            doc.name = "SomeThing";
            doc.value = "Some Value";
            const [savedEntity] = await genericDAO.create(doc);

            let docs = await genericDAO.getAll();
            expect(docs.length).toEqual(1);

            await genericDAO.delete(savedEntity._id!);

            docs = await genericDAO.getAll();
            expect(docs.length).toEqual(0);
        });

        it('retrieves multiple documents with getMany', async () => {
            const doc1 = new ExampleDoc();
            doc1.name = "SomeThing1";
            doc1.value = "Some Value 1";

            const doc2 = new ExampleDoc();
            doc2.name = "SomeThing2";
            doc2.value = "Some Value 2";

            const [savedEntity1] = await genericDAO.create(doc1);
            const [savedEntity2] = await genericDAO.create(doc2);

            const retrievedDocs = await genericDAO.getMany([savedEntity1._id!, savedEntity2._id!]);

            expect(retrievedDocs.length).toBe(2);

            const values = retrievedDocs.map(doc => doc.value);
            expect(values).toContain("Some Value 1");
            expect(values).toContain("Some Value 2");

        });

        it('finds by field', async () => {
            const doc1 = new ExampleDoc();
            doc1.name = "SomeThing1";
            doc1.value = "Some Value 1";

            const doc2 = new ExampleDoc();
            doc2.name = "SomeThing2";
            doc2.value = "Some Value 2";

            await genericDAO.create(doc1);
            await genericDAO.create(doc2);

            const retrievedDocs = await genericDAO.findByField("value", "Some Value 2")
            const docs = await genericDAO.getAll();
            expect(docs.length).toEqual(2);

            expect(retrievedDocs.length).toBe(1);
            expect(retrievedDocs[0].name).toEqual("SomeThing2");
        });
    });

    test('fetches and increments a sequence counter without duplicates', async () => {
        const NUM_CONCURRENT_CALLS = 50;
        // noinspection DuplicatedCode
        const counterDocId = 'counter';

        const promises = Array.from({length: NUM_CONCURRENT_CALLS}).map(() =>
            genericDAO.getNextSequenceId(counterDocId)
        );

        const sequenceNumbers = await Promise.all(promises);
        const uniqueSequenceNumbers = Array.from(new Set(sequenceNumbers));
        expect(sequenceNumbers.length).toBe(uniqueSequenceNumbers.length);

        const expectedSet = new Set(
            Array.from({length: NUM_CONCURRENT_CALLS}, (_, i) => i + 1)
        );
        expect(new Set(sequenceNumbers)).toEqual(expectedSet);
    });
});

describe('GenericOrmDAO with Transactions', () => {
    let dataSource: DataSource;
    let genericDAO: GenericDAO<ExampleDoc>;

    beforeEach(async () => {
        dataSource = new DataSource({
            type: 'sqlite',
            database: ':memory:',
            entities: [GenericOrmDoc, ExampleDoc],
            synchronize: true
        });
        await dataSource.initialize();

        genericDAO = new GenericOrmDAO(ExampleDoc, new GenericOrmMapper(), dataSource.manager, "0.0.1-alpha");
    });

    afterEach(async () => {
        await dataSource.destroy();
    });

    it('rolls back a document creation', async () => {
        const transaction = TransactionManager.createTransaction(genericDAO);
        await transaction.begin();
        const doc = new ExampleDoc();
        doc.name = "ToBeRolledBack";
        doc.value = 'Initial Value';

        await genericDAO.create(doc, transaction);

        let allDocs = await genericDAO.getAll();
        expect(allDocs.length).toBe(1);

        await transaction.rollback();

        allDocs = await genericDAO.getAll();
        expect(allDocs.length).toBe(0);
    });

    it('rolls back a document update', async () => {

        const initialDoc = new ExampleDoc();
        initialDoc.name = "ToBeUpdated";
        initialDoc.value = 'Initial Value';

        const [createdDoc] = await genericDAO.create(initialDoc);

        const transaction = TransactionManager.createTransaction(genericDAO);
        await transaction.begin();
        createdDoc.value = 'Updated Value';
        const [savedDoc] = await genericDAO.update(createdDoc, transaction);
        expect(savedDoc.value).toBe('Updated Value');

        await transaction.rollback();

        const revertedDoc = await genericDAO.getOne(createdDoc._id!);
        expect(revertedDoc.value).toBe('Initial Value');
        expect(revertedDoc._id).toBe(createdDoc._id);
    });

    it('rolls back a document deletion', async () => {
        // THIS TEST MAY FAIL IF TYPEORM FIX ROLLBACK FOR DELETE!!
        // I'm working around this by making the DAO manually restore the entity using the Transaction rollback steps
        const doc = new ExampleDoc();
        doc.name = "ToBeDeleted";
        doc.value = 'Initial Value';
        const saveTransaction = TransactionManager.createTransaction(genericDAO);
        await saveTransaction.begin();
        const [createdDoc] = await genericDAO.create(doc, saveTransaction);

        let allDocs = await genericDAO.getAll();
        expect(allDocs.length).toBe(1);
        await saveTransaction.commit();

        const deleteTransaction = TransactionManager.createTransaction(genericDAO);
        await deleteTransaction.begin();
        await genericDAO.delete(createdDoc._id!, deleteTransaction);

        allDocs = await genericDAO.getAll();
        expect(allDocs.length).toBe(0);

        await deleteTransaction.rollback();

        allDocs = await genericDAO.getAll();
        expect(allDocs.length).toBe(1);
        expect(allDocs[0]._id).toBe(createdDoc._id);
    });


    it('rolls back multiple operations', async () => {

        const doc1 = new ExampleDoc();
        doc1.name = "ToBeUpdated";
        doc1.value = 'Initial Value';

        const doc2 = new ExampleDoc();
        doc2.name = "ToBeDeleted";
        doc2.value = 'Initial Value';

        const [createdDoc1] = await genericDAO.create(doc1);
        const [createdDoc2] = await genericDAO.create(doc2);

        createdDoc1.value = 'Updated Value';

        const transaction = TransactionManager.createTransaction(genericDAO);
        await transaction.begin();
        const [savedDoc] = await genericDAO.update(createdDoc1, transaction);
        await genericDAO.delete(createdDoc2._id!, transaction);
        expect(savedDoc.value).toBe('Updated Value');

        await transaction.rollback();

        const revertedDoc1 = await genericDAO.getOne(createdDoc1._id!);
        const allDocs = await genericDAO.getAll();

        expect(revertedDoc1.value).toBe('Initial Value');
        expect(allDocs.length).toBe(2);
    });
});