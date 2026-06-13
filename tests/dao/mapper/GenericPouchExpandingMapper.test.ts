import {
    GenericPouchMapper,
    GenericPouchExpandingMapper
} from "../../../src/services/dao/mapper/GenericPouchMapper";
import {GenericPouchDoc} from "../../../src/services/dao/types/DbTypes";
import TestUtils from "../../../src/utils/TestUtils";

describe("GenericPouchExpandingMapper", () => {

    const mapper = new GenericPouchExpandingMapper();

    describe("toDomain", () => {
        it("maps standard fields and carries across extra fields", () => {
            const pouchDoc: GenericPouchDoc = {
                _id: "doc-1",
                _rev: "rev-1",
                entityType: "User",
                createdDate: TestUtils.getRandomDate().toISOString(),
                name: "Alice",
                customField: 42,
                tags: ["a", "b"],
            };

            const domain = mapper.toDomain(pouchDoc);

            // Standard fields
            expect(domain.id).toBe("doc-1");
            expect(domain.revision).toBe("rev-1");
            expect(domain.entityType).toBe("User");
            expect(domain.createdDate).toEqual(new Date(pouchDoc.createdDate!));

            // Extra fields carried across
            expect((domain as any).name).toBe("Alice");
            expect((domain as any).customField).toBe(42);
            expect((domain as any).tags).toEqual(["a", "b"]);
        });

        it("still throws on missing required fields", () => {
            const badDoc: GenericPouchDoc = {
                _id: undefined,
                _rev: "rev-1",
                entityType: "User",
                createdDate: "2024-01-01T00:00:00.000Z",
            };
            expect(() => mapper.toDomain(badDoc)).toThrow("Unable to map");
        });
    });

    describe("toDB", () => {
        it("maps standard fields and carries across extra fields", () => {
            const domain: any = {
                id: "doc-2",
                revision: "rev-2",
                entityType: "Account",
                createdDate: new Date("2024-06-01T12:00:00.000Z"),
                balance: 100,
                active: true,
            };

            const dbDoc = mapper.toDB(domain);

            // Standard fields
            expect(dbDoc._id).toBe("doc-2");
            expect(dbDoc._rev).toBe("rev-2");
            expect(dbDoc.entityType).toBe("Account");
            expect(dbDoc.createdDate).toBe("2024-06-01T12:00:00.000Z");

            // Extra fields
            expect((dbDoc as any).balance).toBe(100);
            expect((dbDoc as any).active).toBe(true);
        });

        it("omits updatedDate if not present", () => {
            const domain: any = {
                id: "doc-3",
                revision: "rev-3",
                entityType: "Thing",
                extra: "data",
            };

            const dbDoc = mapper.toDB(domain);
            expect(dbDoc.updatedDate).toBeUndefined();
            expect((dbDoc as any).extra).toBe("data");
        });
    });
});

describe("GenericPouchMapper (base) does not expand", () => {
    const baseMapper = new GenericPouchMapper();

    it("only returns mapped fields, drops extras", () => {
        const pouchDoc: GenericPouchDoc = {
            _id: "doc-x",
            _rev: "rev-x",
            entityType: "Thing",
            createdDate: "2024-01-01T00:00:00.000Z",
            extraField: "should-be-dropped",
        };

        const domain = baseMapper.toDomain(pouchDoc);
        expect((domain as any).extraField).toBeUndefined();
    });
});
