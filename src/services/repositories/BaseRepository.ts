import {Transaction, TransactionManager} from "../dao/Transaction";
import {createError, ErrorType} from "../../errors/Errors";
import {GenericDAO} from "../dao/GenericDAO";
import {GenericDoc} from "../dao/types/DbTypes";

export abstract class BaseRepository {
    protected abstract getDAO(): GenericDAO<GenericDoc>;

    // Utility Method for Transactions
    protected async withTransaction<R>(action: (transaction: Transaction) => Promise<R>): Promise<R> {
        const transaction = TransactionManager.createTransaction(this.getDAO());
        try {
            await transaction.begin();
            const result = await action(transaction);
            await transaction.commit();
            return result;
        } catch (error: any) {
            await transaction.rollback();
            throw createError(ErrorType.DatabaseError, "Transaction failed and rollback was performed", error);
        }
    }
}