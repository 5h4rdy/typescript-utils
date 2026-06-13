import {EntityManager, OptimisticLockVersionMismatchError, QueryRunner, Repository} from "typeorm";
import {Mutex} from "async-mutex";
import {createError, ErrorType} from "../../errors/Errors";
import {DateUtils} from "../../utils/DateUtils";
import {StringUtils} from "../../utils/StringUtils";
import {GenericDAO} from "./GenericDAO";
import {Transaction, TypeORMTransactionWrapper} from "./Transaction";
import {GenericOrmDoc, OrmCounter} from "./types/DbTypes";
import {GenericMapper} from "./mapper/GenericMapper";

export class GenericOrmDAO<D extends GenericOrmDoc> implements GenericDAO<D> {
    protected readonly repository: Repository<D>;
    private readonly mutex = new Mutex();

    constructor(
        private readonly entity: new () => D,
        private readonly mapper: GenericMapper,
        private readonly entityManager: EntityManager,
        private readonly appVersion: string
    ) {
        this.repository = this.entityManager.getRepository<D>(entity);
    }

    public getQueryRunner(): QueryRunner {
        if (this.entityManager.queryRunner) {
            return this.entityManager.queryRunner
        } else {
            return this.entityManager.dataSource.createQueryRunner();
        }
    }

    async create(doc: D, transaction?: Transaction): Promise<[D, Transaction?]> {
        doc.createdDate = StringUtils.setIfEmpty(doc.createdDate, DateUtils.nowISO());
        doc.appVersion = StringUtils.setIfEmpty(doc.appVersion, this.appVersion);
        const manager = this.getManager(transaction);
        const savedDoc = await manager.save(this.entity, doc);
        return [savedDoc, transaction];
    }

    async getOne(id: string): Promise<D> {
        const result = await this.repository
            .createQueryBuilder("entity")
            .where("entity._id = :id", {id})
            .getOne();

        if (!result) {
            throw createError(ErrorType.DatabaseGetError, 'Error retrieving document in getOne: ' + id);
        }

        return result;
    }

    async getAll(): Promise<D[]> {
        return await this.repository.find();
    }

    async update(doc: D, transaction?: Transaction): Promise<[D, Transaction?]> {
        doc.updatedDate = DateUtils.nowISO();
        const manager = this.getManager(transaction);
        const updatedDoc = await manager.save(this.entity, doc);
        return [updatedDoc, transaction];
    }

    async delete(id: string, transaction?: Transaction): Promise<[string, Transaction?]> {
        const manager = this.getManager(transaction);
        const deletedDoc = await this.getOne(id);  // Store the state
        if (transaction) {
            // we have to do this as for some reason deletes aren't respected properly in the rollback of TypeORM SQLite databases?!?
            transaction.registerUndo(async () => {
                // Re-insert the deleted doc
                await this.create(deletedDoc, transaction);
            });
        }
        const result = await manager.delete(this.entity, id);
        if (result.affected === 0) {
            return [`No entity found with id: ${id}`, transaction];
        }
        return [result.affected!.toString(), transaction];
    }

    async getNextSequenceId(counterDocId: string, maxRetries: number = 200): Promise<number> {
        for (let retries = 0; retries < maxRetries; retries++) {
            let counterDoc;

            const release = await this.mutex.acquire();
            try {
                try {
                    counterDoc = await this.repository.manager
                        .createQueryBuilder(OrmCounter, "counter")
                        .where("counter.name = :name", {name: counterDocId})
                        .getOne();
                } catch (error: any) {
                    throw createError(ErrorType.DatabaseGetError, `Failed to get counter doc ${counterDocId}`, error);
                }

                if (!counterDoc) {
                    counterDoc = new OrmCounter(counterDocId, 0);
                }

                counterDoc.seq++;

                try {
                    counterDoc = await this.repository.manager.save(OrmCounter, counterDoc);
                    return counterDoc.seq;
                } catch (error: any) {
                    if (error instanceof OptimisticLockVersionMismatchError) {
                        console.log(`Version Mismatch: Expected = ${error}`);
                        // Conflict detected, retrying
                        continue;
                    }
                    throw createError(ErrorType.DatabaseUpdateError, `Failed to update counter doc ${counterDocId}`, error);
                }
            } finally {
                release();
            }
        }

        throw createError(ErrorType.DatabaseError, `Exceeded max retries (${maxRetries}) while trying to get next sequence ID for ${counterDocId}`);
    }

    async getMany(ids: string[]): Promise<D[]> {
        return await this.repository
            .createQueryBuilder("entity")
            .whereInIds(ids)
            .getMany();
    }

    async findByField(fieldName: string, value: any): Promise<D[]> {
        return await this.repository
            .createQueryBuilder("entity")
            .where(`entity.${fieldName} = :value`, {value})
            .getMany();
    }

    private getManager(transaction?: Transaction): EntityManager {
        if (transaction && transaction instanceof TypeORMTransactionWrapper) {
            return transaction.queryRunner.manager;  // This is within the transaction
        }
        return this.entityManager;  // This is outside of the transaction
    }

    getMapper(): GenericMapper {
        return this.mapper;
    }
}
