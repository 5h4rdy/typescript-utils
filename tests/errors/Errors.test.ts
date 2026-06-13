import {
    ChainedError,
    VerificationError,
    MappingError,
    HashingError,
    BulkSaveError,
    UserExists,
    InvalidUserId,
    DatabaseGetError,
    DatabaseUpdateError,
    DatabaseDeleteError,
    DatabaseCreateError,
    DatabaseError,
    RollbackError,
    ValidationError,
    ErrorType,
    createError,
    handleErrors
} from "../../src/errors/Errors";

describe("Errors Module", () => {

    describe("ChainedError", () => {
        it("creates an error with a message", () => {
            const err = new ChainedError("something went wrong");
            expect(err.message).toBe("something went wrong");
            expect(err.name).toBe("ChainedError");
            expect(err.parentError).toBeUndefined();
            expect(err instanceof Error).toBe(true);
        });

        it("creates an error with a parent error", () => {
            const parent = new Error("root cause");
            const err = new ChainedError("wrapper", parent);
            expect(err.message).toContain("wrapper");
            expect(err.message).toContain("Caused by: root cause");
            expect(err.parentError).toBe(parent);
            expect(err.stack).toContain("### Caused by: ###");
        });

        it("preserves the prototype chain", () => {
            const err = new DatabaseGetError("fail");
            expect(err instanceof DatabaseGetError).toBe(true);
            expect(err instanceof ChainedError).toBe(true);
            expect(err instanceof Error).toBe(true);
        });
    });

    describe("Error subclasses", () => {
        it("each subclass sets the correct name", () => {
            const cases = [
                [VerificationError, "VerificationError"],
                [MappingError, "MappingError"],
                [HashingError, "HashingError"],
                [BulkSaveError, "BulkSaveError"],
                [UserExists, "UserExists"],
                [InvalidUserId, "InvalidUserId"],
                [DatabaseGetError, "DatabaseGetError"],
                [DatabaseUpdateError, "DatabaseUpdateError"],
                [DatabaseDeleteError, "DatabaseDeleteError"],
                [DatabaseCreateError, "DatabaseCreateError"],
                [DatabaseError, "DatabaseError"],
                [RollbackError, "RollbackError"],
                [ValidationError, "ValidationError"],
            ] as const;

            for (const [Cls, expectedName] of cases) {
                const err = new (Cls as any)("test message");
                expect(err.name).toBe(expectedName);
                expect(err.message).toBe("test message");
                expect(err instanceof ChainedError).toBe(true);
            }
        });

        it("each subclass chains parent errors", () => {
            const parent = new Error("parent");
            const err = new MappingError("child", parent);
            expect(err.parentError).toBe(parent);
            expect(err.message).toContain("Caused by:");
        });
    });

    describe("ErrorType enum", () => {
        it("has a value for every error class", () => {
            expect(ErrorType.ChainedError).toBe("ChainedError");
            expect(ErrorType.DatabaseGetError).toBe("DatabaseGetError");
            expect(ErrorType.MappingError).toBe("MappingError");
            expect(ErrorType.VerificationError).toBe("VerificationError");
            expect(ErrorType.ValidationError).toBe("ValidationError");
            // ... all present
        });
    });

    describe("createError factory", () => {
        it("creates the correct error subclass from ErrorType", () => {
            const err = createError(ErrorType.DatabaseDeleteError, "deleted failed");
            expect(err).toBeInstanceOf(DatabaseDeleteError);
            expect(err.message).toBe("deleted failed");
            expect(err.name).toBe("DatabaseDeleteError");
        });

        it("creates a ChainedError for unknown/fallback types", () => {
            const err = createError(ErrorType.ChainedError, "generic");
            expect(err).toBeInstanceOf(ChainedError);
            expect(err.message).toBe("generic");
        });

        it("chains parent error when provided", () => {
            const parent = new Error("inner");
            const err = createError(ErrorType.HashingError, "outer", parent);
            expect(err).toBeInstanceOf(HashingError);
            expect((err as HashingError).parentError).toBe(parent);
        });
    });

    describe("handleErrors utility", () => {
        it("returns the result when the function succeeds", async () => {
            const result = await handleErrors(
                async () => 42,
                "should not matter",
                ErrorType.DatabaseError
            );
            expect(result).toBe(42);
        });

        it("wraps thrown Errors into the specified ChainedError type", async () => {
            await expect(
                handleErrors(
                    async () => { throw new Error("original"); },
                    "wrapped message",
                    ErrorType.DatabaseGetError
                )
            ).rejects.toThrow("wrapped message");

            try {
                await handleErrors(
                    async () => { throw new Error("original"); },
                    "wrapped",
                    ErrorType.DatabaseGetError
                );
                fail("Should have thrown");
            } catch (e: any) {
                expect(e).toBeInstanceOf(DatabaseGetError);
                expect(e.parentError).toBeInstanceOf(Error);
                expect(e.parentError.message).toBe("original");
            }
        });

        it("re-throws non-Error values as-is", async () => {
            await expect(
                handleErrors(
                    async () => { throw "string error"; },
                    "wrapped",
                    ErrorType.DatabaseError
                )
            ).rejects.toBe("string error");
        });
    });
});
