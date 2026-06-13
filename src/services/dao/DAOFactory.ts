import {DataSource, EntityManager} from "typeorm";
import PouchDB from "pouchdb";
import {GenericDAO} from "./GenericDAO";
import {GenericPouchDAO} from "./GenericPouchDAO";
import {GenericOrmDAO} from "./GenericOrmDAO";
import {GenericMapper} from "./mapper/GenericMapper";
import {GenericPouchDoc, GenericOrmDoc} from "./types/DbTypes";

/**
 * Supported backend types for the DAO layer.
 */
export type DAOBackend = "pouchdb" | "typeorm";

/**
 * Configuration for creating a DAO instance.
 *
 * For PouchDB:
 *   - `pouchDb`: a PouchDB database instance
 *   - `entityType`: the entity type string for document namespacing
 *
 * For TypeORM:
 *   - `entity`: the entity class constructor
 *   - `entityManager`: a TypeORM EntityManager (or DataSource)
 *   - `dataSource`: alternatively, provide a DataSource directly
 *
 * Common:
 *   - `mapper`: the mapper implementation to use
 *   - `appVersion`: application version string stored on created docs
 */
export interface DAOConfig {
    backend: DAOBackend;
    mapper: GenericMapper;
    appVersion: string;

    // PouchDB-specific
    pouchDb?: PouchDB.Database;
    entityType?: string;

    // TypeORM-specific
    entity?: new () => any;
    entityManager?: EntityManager;
    dataSource?: DataSource;
}

/**
 * Factory for creating DAO instances based on configuration.
 *
 * This enables zero-config for simple cases (sensible defaults) while
 * remaining fully configurable for complex setups. The key benefit:
 * business logic code never changes when swapping between PouchDB and
 * TypeORM — only the factory configuration changes at startup.
 *
 * @example
 * // PouchDB
 * const dao = DAOFactory.create({
 *     backend: "pouchdb",
 *     mapper: new GenericPouchMapper(),
 *     appVersion: "1.0.0",
 *     pouchDb: new PouchDB("mydb"),
 *     entityType: "User"
 * });
 *
 * // TypeORM (SQLite)
 * const dao = DAOFactory.create({
 *     backend: "typeorm",
 *     mapper: new GenericOrmMapper(),
 *     appVersion: "1.0.0",
 *     entity: User,
 *     dataSource: myDataSource
 * });
 */
export class DAOFactory {

    /**
     * Creates a DAO instance from the provided configuration.
     *
     * The concrete type returned depends on the backend:
     * - `"pouchdb"` → `GenericPouchDAO<GenericPouchDoc>`
     * - `"typeorm"` → `GenericOrmDAO<GenericOrmDoc>`
     *
     * Both implement `GenericDAO`, so the return type is the interface.
     * Consumers can optionally cast if they need backend-specific methods.
     */
    static create<D extends GenericPouchDoc>(config: {
        backend: "pouchdb";
        mapper: GenericMapper;
        appVersion: string;
        pouchDb: PouchDB.Database;
        entityType: string;
    }): GenericDAO<D>;

    static create<D extends GenericOrmDoc>(config: {
        backend: "typeorm";
        mapper: GenericMapper;
        appVersion: string;
        entity: new () => D;
        entityManager?: EntityManager;
        dataSource?: DataSource;
    }): GenericDAO<D>;

    static create<D>(config: DAOConfig): GenericDAO<D> {
        switch (config.backend) {
            case "pouchdb":
                return DAOFactory.createPouchDAO<D>(config);
            case "typeorm":
                return DAOFactory.createOrmDAO<D>(config);
            default:
                throw new Error(`Unsupported DAO backend: ${(config as DAOConfig).backend}`);
        }
    }

    private static createPouchDAO<D>(config: DAOConfig): GenericDAO<D> {
        if (!config.pouchDb) {
            throw new Error("PouchDB backend requires 'pouchDb' in config");
        }
        if (!config.entityType) {
            throw new Error("PouchDB backend requires 'entityType' in config");
        }
        return new GenericPouchDAO(
            config.pouchDb,
            config.mapper,
            config.entityType,
            config.appVersion
        ) as unknown as GenericDAO<D>;
    }

    private static createOrmDAO<D>(config: DAOConfig): GenericDAO<D> {
        if (!config.entity) {
            throw new Error("TypeORM backend requires 'entity' in config");
        }

        let entityManager: EntityManager;
        if (config.entityManager) {
            entityManager = config.entityManager;
        } else if (config.dataSource) {
            entityManager = config.dataSource.manager;
        } else {
            throw new Error("TypeORM backend requires either 'entityManager' or 'dataSource' in config");
        }

        return new GenericOrmDAO(
            config.entity,
            config.mapper,
            entityManager,
            config.appVersion
        ) as unknown as GenericDAO<D>;
    }
}
