# TypeScript Utilities for CRUD Applications

This library serves as a comprehensive toolkit for building CRUD (Create, Read, Update, Delete) applications in TypeScript. It provides a range of
utilities designed to accelerate the development process, allowing you to focus on the unique aspects of your application while the boilerplate code
is efficiently handled.

## Overview

The library is modular, organized into distinct layers and functionalities:

- **DAO (Data Access Object)**: Base implementations for generic data access operations, offering both a standard interface (`GenericDAO`) and a
  PouchDB-specific implementation (`GenericPouchDAO`).

- **Mappers**: Utility for mapping between datastore and domain models, facilitating data transformation.

- **Errors**: A robust error-handling module that includes custom error classes, an error type enumeration, and utility functions for error creation
  and handling.

- **Model**: The starting point for crafting domain models (`Entity` and `PouchEntity`), providing a consistent structure for your application's data.

- **Password Utilities**: Helper functions for hashing and verifying passwords, encapsulated in the `PasswordUtils` class.

- **String Utilities**: A collection of string manipulation functions, ranging from capitalization to email validation.

With these foundational elements, you can extend and adapt the library to fit the specific requirements of your CRUD application, whether you're
building DTOs (Data Transfer Objects), domain models, or implementing other common operations.

___

# DAO

The DAO (Data Access Object) layer is responsible for abstracting the interaction with the data source. In this project, the DAO layer is implemented
using PouchDB.

## Classes

### `GenericDAO` Interface

This interface defines the standard CRUD operations along with some additional utility methods.

#### Methods

- `create(doc: D): Promise<D>`: Creates a new document of type `D`.
- `getOne(id: string): Promise<D>`: Retrieves a single document by its ID.
- `getAll(): Promise<D[]>`: Retrieves all documents.
- `update(doc: D): Promise<D>`: Updates an existing document.
- `delete(id: string): Promise<void | string>`: Deletes a document by its ID.
- `getNextSequenceId(sequenceId: string): Promise<number>`: Gets the next sequence ID for a given sequence.
- `getMany(ids: string[]): Promise<D[]>`: Retrieves multiple documents by their IDs.
- `findByField(fieldName: string, value: any): Promise<D[]>`: Finds documents by a specific field.

---

## Transaction Module

### Transaction Interface

The `Transaction` interface provides a contract for transaction management within a CRUD application. It ensures that all operations within a
transaction are atomic and consistent.

#### Methods

- `begin()`: Begins the transaction. Must be called (and awaited) before performing any operations within the transaction.
- `registerUndo(undoFunction: UndoFunction)`: Registers an undo function that will be called if the transaction needs to be rolled back.
- `rollback()`: Rolls back the transaction, reverting all the operations performed during the transaction.
- `commit()`: Commits the transaction, making all the operations permanent.
- `release()`: Releases any resources held by the transaction.

### TransactionManager Class

It's a factory class for creating transaction objects based on the DAO provided.

#### Methods

- `createTransaction(dao: GenericDAO<any>): Transaction`: Creates a transaction object based on the type of DAO provided.

### PouchTransaction and TypeORMTransactionWrapper Classes

These classes implement the `Transaction` interface, one for PouchDB and the other for TypeORM.

---

### Generic ORM DAO

The `GenericOrmDAO` class provides a set of CRUD operations using TypeORM as the underlying ORM.

#### Fields

- `repository`: TypeORM repository for the entity.
- `mutex`: Mutex (via `async-mutex`) for synchronizing operations like `getNextSequenceId`.

#### Methods

- `getQueryRunner()`: Gets the TypeORM query runner associated with the DAO.
- `create(doc: D, transaction?: Transaction)`: Creates a new document in the database.
- `getOne(id: string)`: Retrieves a single document by its ID.
- `getAll()`: Retrieves all documents.
- `update(doc: D, transaction?: Transaction)`: Updates an existing document.
- `delete(id: string, transaction?: Transaction)`: Deletes a document by its ID.
- `getNextSequenceId(counterDocId: string, maxRetries: number)`: Gets the next sequence ID for a given sequence.
- `getMany(ids: string[])`: Retrieves multiple documents by their IDs.
- `findByField(fieldName: string, value: any)`: Finds documents by a specific field.

### GenericOrmDoc Class

The base class for documents that will be stored using TypeORM.

#### Fields

- `id`: The unique identifier for the document.
- `appVersion`: The application version the document was created with.
- `createdDate`: The date the document was created.
- `updatedDate`: The date the document was last updated.

### `GenericPouchDAO` Class

Implements the `GenericDAO` interface and provides additional functionalities specific to PouchDB.

#### Methods

- `getEntityType(): string`: Returns the entity type associated with the DAO.
- `getNextSequenceId(counterDocId: string): Promise<number>`: Gets the next sequence ID from a counter document.
- `createIndex(field: string): Promise<void>`: Creates an index on a field for optimized querying.
- `getAll(): Promise<D[]>`: Retrieves all documents of the entity type.
- `getOne(docId: string): Promise<D>`: Retrieves a single document by its ID.
- `getMany(docIds: string[]): Promise<D[]>`: Retrieves multiple documents by their IDs.
- `create(doc: D): Promise<D>`: Creates a new document.
- `update(doc: D): Promise<D>`: Updates an existing document.
- `restore(doc: D): Promise<D>`: Restores a deleted document.
- `delete(docId: string): Promise<string>`: Deletes a document by its ID.
- `bulkSave(docs: GenericPouchDoc[]): Promise<GenericPouchDoc[]>`: Performs a bulk save operation on an array of documents.
- `findByField(fieldName: string, value: any): Promise<D[]>`: Finds documents by a specific field.

### `ValidatingPouchDAO` Class

Extends `GenericPouchDAO` and adds schema validation for documents.

#### Methods

- `getSchema(): Joi.ObjectSchema`: Returns the Joi schema for document validation.
- `create(doc: D): Promise<D>`: Creates a new document with validation.
- `update(doc: D): Promise<D>`: Updates an existing document with validation.

### `GenericPouchMapper` Class

Provides utility methods for converting between PouchDB documents and domain models.

#### Methods

- `toDomain(dbDoc: GenericPouchDoc): PouchEntity`: Converts a PouchDB document to a domain model.
- `toDB(domainDoc: PouchEntity): GenericPouchDoc`: Converts a domain model to a PouchDB document.

### Interfaces

#### `GenericPouchDoc`

Defines the structure for documents that can be stored in PouchDB.

- `_id?: string`: The document ID.
- `_rev?: string`: The document revision.
- `entityType?: string`: The type of entity.
- `appVersion?: string`: The application version.
- `[key: string]: any`: Additional properties.

#### `IDocTypeProvider`

Defines a method for retrieving the entity type.

- `getEntityType(): string`: Returns the entity type.

___

## DAOFactory

The `DAOFactory` provides a single entry point for creating DAO instances regardless of the underlying backend.

Business logic code never needs to change when swapping between PouchDB and TypeORM — only the factory
configuration changes at application startup.

### `DAOFactory.create<D>(config: DAOConfig): GenericDAO<D>`

Creates a DAO instance based on the provided configuration. The concrete type returned depends on the
`backend` field:

- `"pouchdb"` → `GenericPouchDAO<GenericPouchDoc>`
- `"typeorm"` → `GenericOrmDAO<GenericOrmDoc>`

### Configuration (`DAOConfig`)

| Field            | Backend     | Description                                      |
|------------------|-------------|--------------------------------------------------|
| `backend`        | Both        | `"pouchdb"` or `"typeorm"`                      |
| `mapper`         | Both        | The mapper implementation to use                  |
| `appVersion`     | Both        | Application version stored on created docs        |
| `pouchDb`        | PouchDB     | A PouchDB database instance                       |
| `entityType`     | PouchDB     | Entity type string for document namespacing        |
| `entity`         | TypeORM     | The entity class constructor                      |
| `entityManager`  | TypeORM     | A TypeORM EntityManager (optional with dataSource) |
| `dataSource`     | TypeORM     | A TypeORM DataSource (optional with entityManager)  |

### Example: PouchDB

```typescript
import PouchDB from "pouchdb";
import {DAOFactory, GenericPouchMapper} from "typescript-utils";

const dao = DAOFactory.create({
    backend: "pouchdb",
    mapper: new GenericPouchMapper(),
    appVersion: "1.0.0",
    pouchDb: new PouchDB("mydb"),
    entityType: "User"
});
```

### Example: TypeORM (SQLite)

```typescript
import {DataSource} from "typeorm";
import {DAOFactory, GenericOrmMapper} from "typescript-utils";

const dataSource = new DataSource({
    type: "sqlite",
    database: "./app.db",
    entities: [User],
    synchronize: true
});
await dataSource.initialize();

const dao = DAOFactory.create({
    backend: "typeorm",
    mapper: new GenericOrmMapper(),
    appVersion: "1.0.0",
    entity: User,
    dataSource
});
```

### Swapping Backends

Because both DAO implementations share the `GenericDAO` interface, the same business logic runs
unchanged against either backend:

```typescript
// Configuration at startup — everything else is backend-agnostic
const dao = usePouch
    ? DAOFactory.create({backend: "pouchdb", ...})
    : DAOFactory.create({backend: "typeorm", ...});

// This code is identical regardless of backend
const [created] = await dao.create(doc);
const found = await dao.findByField("email", "alice@example.com");
await dao.delete(created._id!);
```

___

## BaseRepository

The `BaseRepository` abstract class provides a `withTransaction` helper for any repository that
manages a DAO. Extend it, implement `getDAO()`, and get automatic transaction lifecycle management:

```typescript
import {BaseRepository} from "typescript-utils";

class UserRepository extends BaseRepository {
    private dao: GenericDAO<User>;

    constructor(dao: GenericDAO<User>) {
        super();
        this.dao = dao;
    }

    protected getDAO() { return this.dao; }

    async createUser(name: string, email: string) {
        return this.withTransaction(async (tx) => {
            return this.dao.create({name, email} as User, tx);
        });
    }
}
```

`withTransaction` automatically:
1. Creates a transaction and calls `begin()`
2. Executes your action within the transaction
3. Commits on success
4. Rolls back and rethrows on failure

___

## Errors Module

### ChainedError

This class extends JavaScript's native `Error` class. It allows for error chaining, i.e., wrapping one error within another. This is useful for
providing context when exceptions propagate through multiple layers of an application.

- `parentError`: Parent error that caused this chained error.

### CredentialsError

This is a specific type of `ChainedError` used for credential-related errors.

### BulkSaveError

This is a specific type of `ChainedError` used when a bulk save operation fails.

### UserExists

This is a specific type of `ChainedError` used when a user already exists in the system.

### InvalidUserId

This is a specific type of `ChainedError` used when an invalid user ID is provided.

### Database Errors

- 'DatabaseGetError': When there's an issue getting data from the database.
- 'DatabaseUpdateError': When there's an issue updating data in the database.
- 'DatabaseDeleteError': When there's an issue deleting data from the database.
- 'DatabaseCreateError': When there's an issue creating new data in the database.

### ErrorType

This enum lists all available error types.

### Error Factory Function

- 'createError(type, message, parentError)': Factory function to create new error objects.

### Utility Function for Error Handling

- 'handleErrors': A utility function for handling errors in async functions.

___

## Model Module

### Entity

The starting point for a domain model. It has a single field `id`.

### PouchEntity

Extends `Entity` and adds `revision` and `entityType` fields.

___

## Password Module

### PasswordUtils

Utility class for password hashing and verification.

- `hashPassword(password)`: Hashes a password and returns the salt and hashed password.
- `verifyPassword(storedHash, storedSalt, passwordAttempt)`: Verifies a password against a stored hash and salt.

___

## Utils Module

### StringUtils

he `DateUtils` class provides various utility methods for string operations.

#### Methods

- `capitalizeFirstLetter(str: string): string`: Capitalizes the first letter of a given string.
- `truncateWithEllipsis(str: string, length: number): string`: Truncates a string to a specified length and adds an ellipsis at the end.
- `toTitleCase(str: string): string`: Converts a string to title case.
- `padLeft(str: string, length: number, padChar = ' '): string`: Pads a string from the left to a specified length with a given character.
- `padRight(str: string, length: number, padChar = ' '): string`: Pads a string from the right to a specified length with a given character.
- `isNullOrEmpty(str: string | null | undefined): boolean`: Checks if a string is null, undefined, or empty.
- `isValidEmail(str: string): boolean`: Validates an email address using a regex pattern.
- `replaceAll(str: string, find: string, replace: string): string`: Replaces all occurrences of a substring within a string.
- `removeWhitespace(str: string): string`: Removes all whitespace from a string.
- `stripHtmlTags(str: string): string`: Removes all HTML tags from a string.
- `setIfEmpty(value: string | null | undefined, defaultValue: string): string`: Returns the value if it's not null or empty; otherwise, returns the
  default value.

## DateUtils

The `DateUtils` class provides various utility methods for handling dates in ISO format.

#### Methods

- `nowISO()`: Returns the current date and time in ISO format.
- `toISO(date: Date)`: Converts a Date object to an ISO string.
- `fromISO(isoString: string)`: Converts an ISO string to a Date object.
- `addDays(date: Date, days: number)`: Adds a specified number of days to a Date object.
- `addHours(date: Date, hours: number)`: Adds a specified number of hours to a Date object.
- `addMinutes(date: Date, minutes: number)`: Adds a specified number of minutes to a Date object.
- `isPast(date: Date)`: Checks if the date is in the past.
- `isFuture(date: Date)`: Checks if the date is in the future.
- `diffInDays(date1: Date, date2: Date)`: Returns the difference in days between two dates.

