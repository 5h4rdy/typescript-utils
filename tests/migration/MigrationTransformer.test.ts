import {
    MigrationTransformer,
    POUCH_STRIP_FIELDS,
    ORM_STRIP_FIELDS,
    BUILTIN_CONVERTERS,
    TransformerConfig,
} from "../../src/services/migration/MigrationTransformer";

describe("MigrationTransformer", () => {
    describe("constructor", () => {
        it("creates a transformer with default strip fields", () => {
            const t = new MigrationTransformer({
                stripFields: POUCH_STRIP_FIELDS,
                fieldMappings: [],
            });
            expect(t).toBeDefined();
        });

        it("throws on unknown converter name", () => {
            expect(() => {
                new MigrationTransformer({
                    stripFields: [],
                    fieldMappings: [],
                    converters: ["nonExistent"],
                });
            }).toThrow("Unknown converter: nonExistent");
        });
    });

    describe("transform - field stripping", () => {
        it("strips PouchDB metadata fields", async () => {
            const t = new MigrationTransformer({
                stripFields: POUCH_STRIP_FIELDS,
                fieldMappings: [],
            });

            const record = {
                _id: "test123",
                _rev: "1-abc",
                entityType: "User",
                appVersion: "1.0.0",
                dataVersion: 2,
                docType: "user",
                name: "Alice",
                email: "alice@example.com",
            };

            const [result, warnings] = await t.transform(record);

            expect(result).not.toHaveProperty("_id");
            expect(result).not.toHaveProperty("_rev");
            expect(result).not.toHaveProperty("entityType");
            expect(result).not.toHaveProperty("appVersion");
            expect(result).not.toHaveProperty("dataVersion");
            expect(result).not.toHaveProperty("docType");
            expect(result.name).toBe("Alice");
            expect(result.email).toBe("alice@example.com");
            expect(warnings).toHaveLength(0);
        });

        it("strips TypeORM metadata fields", async () => {
            const t = new MigrationTransformer({
                stripFields: ORM_STRIP_FIELDS,
                fieldMappings: [],
            });

            const record = {
                _id: "uuid-here",
                _rev: 1,
                appVersion: "2.0.0",
                __entity: "User",
                name: "Bob",
                email: "bob@example.com",
            };

            const [result] = await t.transform(record);

            expect(result).not.toHaveProperty("_id");
            expect(result).not.toHaveProperty("_rev");
            expect(result).not.toHaveProperty("appVersion");
            expect(result).not.toHaveProperty("__entity");
            expect(result.name).toBe("Bob");
        });

        it("strips custom fields", async () => {
            const t = new MigrationTransformer({
                stripFields: ["legacyId", "oldSystem"],
                fieldMappings: [],
            });

            const [result] = await t.transform({legacyId: 123, oldSystem: "X", name: "Keep"});

            expect(result).not.toHaveProperty("legacyId");
            expect(result).not.toHaveProperty("oldSystem");
            expect(result.name).toBe("Keep");
        });
    });

    describe("transform - field mapping", () => {
        it("maps source field names to target field names", async () => {
            const t = new MigrationTransformer({
                stripFields: [],
                fieldMappings: [
                    {sourceField: "firstName", targetField: "givenName"},
                    {sourceField: "lastName", targetField: "familyName"},
                ],
            });

            const [result] = await t.transform({firstName: "John", lastName: "Doe"});

            expect(result.givenName).toBe("John");
            expect(result.familyName).toBe("Doe");
            expect(result).not.toHaveProperty("firstName");
            expect(result).not.toHaveProperty("lastName");
        });

        it("leaves unmapped fields as-is", async () => {
            const t = new MigrationTransformer({
                stripFields: [],
                fieldMappings: [
                    {sourceField: "old", targetField: "new"},
                ],
            });

            const [result] = await t.transform({old: 1, untouched: 2});
            expect(result.new).toBe(1);
            expect(result.untouched).toBe(2);
        });
    });

    describe("transform - type converters", () => {
        it("converts ISO date strings to Date objects", async () => {
            const t = new MigrationTransformer({
                stripFields: [],
                fieldMappings: [],
                converters: ["stringToDate"],
            });

            const [result] = await t.transform({
                createdDate: "2024-01-15T10:30:00.000Z",
                name: "Test",
            });

            expect(result.createdDate).toBeInstanceOf(Date);
            expect(result.name).toBe("Test");
        });

        it("converts Date objects to ISO strings", async () => {
            const t = new MigrationTransformer({
                stripFields: [],
                fieldMappings: [],
                converters: ["dateToString"],
            });

            const d = new Date("2024-01-15T10:30:00.000Z");
            const [result] = await t.transform({createdDate: d});

            expect(result.createdDate).toBe(d.toISOString());
        });

        it("converts string numbers to actual numbers", async () => {
            const t = new MigrationTransformer({
                stripFields: [],
                fieldMappings: [],
                converters: ["stringToNumber"],
            });

            const [result] = await t.transform({age: "42", name: "Bob", emptyStr: ""});

            expect(result.age).toBe(42);
            expect(typeof result.age).toBe("number");
            expect(result.name).toBe("Bob"); // not a number
            expect(result.emptyStr).toBe(""); // empty string stays
        });

        it("converts string booleans", async () => {
            const t = new MigrationTransformer({
                stripFields: [],
                fieldMappings: [],
                converters: ["stringToBoolean"],
            });

            const [result] = await t.transform({active: "true", deleted: "false", name: "keep"});

            expect(result.active).toBe(true);
            expect(result.deleted).toBe(false);
            expect(result.name).toBe("keep");
        });
    });

    describe("transform - custom transform", () => {
        it("applies custom transform function after built-in transforms", async () => {
            const t = new MigrationTransformer({
                stripFields: ["_id"],
                fieldMappings: [{sourceField: "oldName", targetField: "newName"}],
                customTransform: (record: any) => ({
                    ...record,
                    computed: record.newName.toUpperCase() + "_X",
                }),
            });

            const [result] = await t.transform({_id: "123", oldName: "test"});

            expect(result.newName).toBe("test");
            expect(result.computed).toBe("TEST_X");
            expect(result).not.toHaveProperty("_id");
        });

        it("supports async custom transform functions", async () => {
            const t = new MigrationTransformer({
                stripFields: [],
                fieldMappings: [],
                customTransform: async (record: any) => {
                    await new Promise(r => setTimeout(r, 10));
                    return {...record, asyncProcessed: true};
                },
            });

            const [result] = await t.transform({name: "Alice"});
            expect(result.asyncProcessed).toBe(true);
            expect(result.name).toBe("Alice");
        });
    });

    describe("transform - validation", () => {
        it("adds a warning when validation fails", async () => {
            const t = new MigrationTransformer({
                stripFields: [],
                fieldMappings: [],
                validate: () => false,
            });

            const [, warnings] = await t.transform({name: "Test"});
            expect(warnings).toHaveLength(1);
            expect(warnings[0].message).toContain("Validation failed");
        });

        it("adds no warnings when validation passes", async () => {
            const t = new MigrationTransformer({
                stripFields: [],
                fieldMappings: [],
                validate: () => true,
            });

            const [, warnings] = await t.transform({name: "Test"});
            expect(warnings).toHaveLength(0);
        });
    });

    describe("transformBatch", () => {
        it("transforms multiple records", async () => {
            const t = new MigrationTransformer({
                stripFields: ["_id"],
                fieldMappings: [],
            });

            const records = [
                {_id: "1", name: "Alice"},
                {_id: "2", name: "Bob"},
                {_id: "3", name: "Charlie"},
            ];

            const [results, warnings] = await t.transformBatch(records);

            expect(results).toHaveLength(3);
            expect(results[0].name).toBe("Alice");
            expect(results[1].name).toBe("Bob");
            expect(results[2].name).toBe("Charlie");
            expect(results.every(r => !r.hasOwnProperty("_id"))).toBe(true);
            expect(warnings).toHaveLength(0);
        });

        it("handles empty batch", async () => {
            const t = new MigrationTransformer({
                stripFields: [],
                fieldMappings: [],
            });

            const [results, warnings] = await t.transformBatch([]);
            expect(results).toHaveLength(0);
            expect(warnings).toHaveLength(0);
        });
    });

    describe("BUILTIN_CONVERTERS", () => {
        it("exports converter map", () => {
            expect(BUILTIN_CONVERTERS.stringToDate).toBeDefined();
            expect(BUILTIN_CONVERTERS.dateToString).toBeDefined();
            expect(BUILTIN_CONVERTERS.stringToNumber).toBeDefined();
            expect(BUILTIN_CONVERTERS.stringToBoolean).toBeDefined();
        });

        it("stringToDate does not convert non-date strings", () => {
            expect(BUILTIN_CONVERTERS.stringToDate("hello")).toBe("hello");
            expect(BUILTIN_CONVERTERS.stringToDate(42)).toBe(42);
        });
    });

    describe("fromEntityType", () => {
        it("builds transformer from EntityTypeTransform", async () => {
            const t = MigrationTransformer.fromEntityType({
                entityType: "User",
                sourceDAO: {} as any,
                targetDAO: {} as any,
                fieldMappings: [{sourceField: "a", targetField: "b"}],
                stripFields: ["_id"],
                customTransform: (r: any) => ({...r, added: true}),
            });

            const [result] = await t.transform({_id: "1", a: "value"});
            expect(result.b).toBe("value");
            expect(result.added).toBe(true);
            expect(result).not.toHaveProperty("_id");
        });
    });
});
