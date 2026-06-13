import {
    MigrationTransformer,
    POUCH_STRIP_FIELDS,
    ORM_STRIP_FIELDS,
    BUILTIN_CONVERTERS,
    TransformResult,
} from "../../src/services/migration/MigrationTransformer";
import {
    SchemaMapping,
    SchemaMappingRegistry,
    MigrationDirection,
} from "../../src/services/migration/SchemaMapping";

// ============== ENHANCED TRANSFORMER: SCHEMA MAPPING TESTS ==============

describe("MigrationTransformer - SchemaMapping Integration", () => {

    describe("fromSchemaMapping", () => {
        it("creates a transformer for forward direction (pouch-to-orm)", async () => {
            const mapping: SchemaMapping = {
                key: "User",
                pouchDocTypes: ["user"],
                ormEntityName: "UserEntity",
                forward: {
                    fieldTransforms: [
                        {sourceField: "firstName", targetField: "name"},
                        {sourceField: "yearsOld", targetField: "age"},
                    ],
                },
            };

            const transformer = MigrationTransformer.fromSchemaMapping(mapping, "pouch-to-orm");

            const [result] = await transformer.transform({
                _id: "123",
                _rev: "1-a",
                docType: "user",
                entityType: "user",
                firstName: "Alice",
                yearsOld: 30,
                email: "alice@test.com",
            });

            // PouchDB metadata stripped
            expect(result).not.toHaveProperty("_id");
            expect(result).not.toHaveProperty("_rev");
            expect(result).not.toHaveProperty("docType");
            expect(result).not.toHaveProperty("entityType");

            // Fields mapped
            expect(result.name).toBe("Alice");
            expect(result.age).toBe(30);
            expect(result.email).toBe("alice@test.com");
        });

        it("creates a transformer for reverse direction (orm-to-pouch)", async () => {
            const mapping: SchemaMapping = {
                key: "User",
                pouchDocTypes: ["user"],
                ormEntityName: "UserEntity",
                reverse: {
                    fieldTransforms: [
                        {sourceField: "name", targetField: "firstName"},
                        {sourceField: "age", targetField: "yearsOld"},
                    ],
                },
            };

            const transformer = MigrationTransformer.fromSchemaMapping(mapping, "orm-to-pouch");

            const [result] = await transformer.transform({
                _id: "uuid-here",
                _rev: "1",
                appVersion: "2.0.0",
                name: "Bob",
                age: 25,
            });

            // ORM metadata stripped
            expect(result).not.toHaveProperty("_id");
            expect(result).not.toHaveProperty("_rev");
            expect(result).not.toHaveProperty("appVersion");

            // Fields mapped
            expect(result.firstName).toBe("Bob");
            expect(result.yearsOld).toBe(25);
        });

        it("applies custom transform from SchemaMapping", async () => {
            const mapping: SchemaMapping = {
                key: "User",
                pouchDocTypes: ["user"],
                ormEntityName: "UserEntity",
                forward: {
                    customTransform: (record: any) => ({
                        ...record,
                        fullName: `${record.name} X`,
                        processed: true,
                    }),
                },
            };

            const transformer = MigrationTransformer.fromSchemaMapping(mapping, "pouch-to-orm");
            const [result] = await transformer.transform({name: "Alice"});

            expect(result.fullName).toBe("Alice X");
            expect(result.processed).toBe(true);
        });

        it("uses custom strip fields from SchemaMapping", async () => {
            const mapping: SchemaMapping = {
                key: "Custom",
                pouchDocTypes: ["custom"],
                ormEntityName: "CustomEntity",
                stripFields: ["_id", "internalFlag", "legacyField"],
            };

            const transformer = MigrationTransformer.fromSchemaMapping(mapping, "pouch-to-orm");
            const [result] = await transformer.transform({
                _id: "1",
                internalFlag: "secret",
                legacyField: "old",
                name: "Keep",
            });

            expect(result).not.toHaveProperty("_id");
            expect(result).not.toHaveProperty("internalFlag");
            expect(result).not.toHaveProperty("legacyField");
            expect(result.name).toBe("Keep");
        });

        it("applies named converters in field transforms", async () => {
            const mapping: SchemaMapping = {
                key: "Event",
                pouchDocTypes: ["event"],
                ormEntityName: "EventEntity",
                forward: {
                    fieldTransforms: [
                        {sourceField: "eventDate", targetField: "date", convert: "stringToDate"},
                    ],
                },
            };

            const transformer = MigrationTransformer.fromSchemaMapping(mapping, "pouch-to-orm");
            const [result] = await transformer.transform({eventDate: "2024-06-15T10:00:00.000Z"});

            expect(result.date).toBeInstanceOf(Date);
        });

        it("applies function converters in field transforms", async () => {
            const mapping: SchemaMapping = {
                key: "Counter",
                pouchDocTypes: ["counter"],
                ormEntityName: "CounterEntity",
                forward: {
                    fieldTransforms: [
                        {sourceField: "count", targetField: "countStr", convert: (v: any) => String(v)},
                    ],
                },
            };

            const transformer = MigrationTransformer.fromSchemaMapping(mapping, "pouch-to-orm");
            const [result] = await transformer.transform({count: 42});

            expect(result.countStr).toBe("42");
            expect(typeof result.countStr).toBe("string");
        });
    });

    describe("fromRegistry", () => {
        it("creates a transformer via registry lookup", async () => {
            const registry = new SchemaMappingRegistry([
                {
                    key: "User",
                    pouchDocTypes: ["user"],
                    ormEntityName: "UserEntity",
                    forward: {
                        fieldTransforms: [
                            {sourceField: "firstName", targetField: "name"},
                        ],
                    },
                },
            ]);

            const transformer = MigrationTransformer.fromRegistry(registry, "User", "pouch-to-orm");
            const [result] = await transformer.transform({firstName: "Alice"});

            expect(result.name).toBe("Alice");
        });

        it("throws on unknown mapping key", () => {
            const registry = new SchemaMappingRegistry();

            expect(() => {
                MigrationTransformer.fromRegistry(registry, "NonExistent", "pouch-to-orm");
            }).toThrow("No SchemaMapping registered with key: NonExistent");
        });
    });

    // ============== SUB-DOCUMENT EXTRACTION TESTS ==============

    describe("transformWithSubDocuments", () => {
        it("extracts nested array as sub-documents", async () => {
            const mapping: SchemaMapping = {
                key: "HolidayHome",
                pouchDocTypes: ["holidayHome"],
                ormEntityName: "HolidayHomeEntity",
                subDocuments: [
                    {
                        sourceField: "circuits",
                        targetEntityType: "Circuit",
                        foreignKeyField: "holidayHomeId",
                    },
                ],
            };

            const transformer = MigrationTransformer.fromSchemaMapping(mapping, "pouch-to-orm");

            const result = await transformer.transformWithSubDocuments({
                _id: "hh-1",
                name: "Seaside Villa",
                circuits: [
                    {name: "Ring Main 1", voltage: 230},
                    {name: "Lighting Circuit", voltage: 230},
                ],
            });

            // Main record should not have circuits anymore
            expect(result.record).not.toHaveProperty("circuits");
            expect(result.record.name).toBe("Seaside Villa");

            // Sub-documents extracted
            expect(result.subDocuments).toHaveLength(1);
            expect(result.subDocuments![0].entityType).toBe("Circuit");
            expect(result.subDocuments![0].records).toHaveLength(2);
            expect(result.subDocuments![0].records[0].name).toBe("Ring Main 1");
            expect(result.subDocuments![0].records[0].holidayHomeId).toBe("hh-1");
            expect(result.subDocuments![0].records[1].name).toBe("Lighting Circuit");
        });

        it("extracts single nested object as sub-document", async () => {
            const mapping: SchemaMapping = {
                key: "Park",
                pouchDocTypes: ["park"],
                ormEntityName: "ParkEntity",
                subDocuments: [
                    {
                        sourceField: "manager",
                        targetEntityType: "Manager",
                        foreignKeyField: "parkId",
                    },
                ],
            };

            const transformer = MigrationTransformer.fromSchemaMapping(mapping, "pouch-to-orm");

            const result = await transformer.transformWithSubDocuments({
                _id: "park-1",
                name: "Sunny Park",
                manager: {name: "Jane", phone: "555-0100"},
            });

            expect(result.record).not.toHaveProperty("manager");
            expect(result.subDocuments).toHaveLength(1);
            expect(result.subDocuments![0].records).toHaveLength(1);
            expect(result.subDocuments![0].records[0].name).toBe("Jane");
            expect(result.subDocuments![0].records[0].parkId).toBe("park-1");
        });

        it("applies field transforms to sub-documents", async () => {
            const mapping: SchemaMapping = {
                key: "HolidayHome",
                pouchDocTypes: ["holidayHome"],
                ormEntityName: "HolidayHomeEntity",
                subDocuments: [
                    {
                        sourceField: "circuits",
                        targetEntityType: "Circuit",
                        foreignKeyField: "holidayHomeId",
                        fieldTransforms: [
                            {sourceField: "name", targetField: "circuitName"},
                            {sourceField: "voltage", targetField: "ratedVoltage"},
                        ],
                    },
                ],
            };

            const transformer = MigrationTransformer.fromSchemaMapping(mapping, "pouch-to-orm");

            const result = await transformer.transformWithSubDocuments({
                _id: "hh-1",
                circuits: [
                    {name: "Ring Main", voltage: 230},
                ],
            });

            const circuit = result.subDocuments![0].records[0];
            expect(circuit.circuitName).toBe("Ring Main");
            expect(circuit.ratedVoltage).toBe(230);
            expect(circuit).not.toHaveProperty("name");
            expect(circuit).not.toHaveProperty("voltage");
        });

        it("handles missing sub-document field gracefully", async () => {
            const mapping: SchemaMapping = {
                key: "HolidayHome",
                pouchDocTypes: ["holidayHome"],
                ormEntityName: "HolidayHomeEntity",
                subDocuments: [
                    {
                        sourceField: "circuits",
                        targetEntityType: "Circuit",
                    },
                ],
            };

            const transformer = MigrationTransformer.fromSchemaMapping(mapping, "pouch-to-orm");

            const result = await transformer.transformWithSubDocuments({
                _id: "hh-1",
                name: "No Circuits Villa",
            });

            expect(result.record.name).toBe("No Circuits Villa");
            expect(result.subDocuments).toHaveLength(0);
        });

        it("handles null sub-document field gracefully", async () => {
            const mapping: SchemaMapping = {
                key: "HolidayHome",
                pouchDocTypes: ["holidayHome"],
                ormEntityName: "HolidayHomeEntity",
                subDocuments: [
                    {
                        sourceField: "circuits",
                        targetEntityType: "Circuit",
                    },
                ],
            };

            const transformer = MigrationTransformer.fromSchemaMapping(mapping, "pouch-to-orm");

            const result = await transformer.transformWithSubDocuments({
                _id: "hh-1",
                circuits: null,
                name: "Null Villa",
            });

            expect(result.record.name).toBe("Null Villa");
            expect(result.subDocuments).toHaveLength(0);
        });

        it("uses default foreign key field when not specified", async () => {
            const mapping: SchemaMapping = {
                key: "Parent",
                pouchDocTypes: ["parent"],
                ormEntityName: "ParentEntity",
                subDocuments: [
                    {
                        sourceField: "children",
                        targetEntityType: "Child",
                        // No foreignKeyField — should default to "parentId"
                    },
                ],
            };

            const transformer = MigrationTransformer.fromSchemaMapping(mapping, "pouch-to-orm");

            const result = await transformer.transformWithSubDocuments({
                _id: "p-1",
                children: [{name: "Child1"}],
            });

            expect(result.subDocuments![0].records[0].parentId).toBe("p-1");
            expect(result.subDocuments![0].foreignKeyField).toBe("parentId");
        });

        it("handles multiple sub-document mappings", async () => {
            const mapping: SchemaMapping = {
                key: "HolidayHome",
                pouchDocTypes: ["holidayHome"],
                ormEntityName: "HolidayHomeEntity",
                subDocuments: [
                    {sourceField: "circuits", targetEntityType: "Circuit", foreignKeyField: "holidayHomeId"},
                    {sourceField: "rooms", targetEntityType: "Room", foreignKeyField: "holidayHomeId"},
                ],
            };

            const transformer = MigrationTransformer.fromSchemaMapping(mapping, "pouch-to-orm");

            const result = await transformer.transformWithSubDocuments({
                _id: "hh-1",
                name: "Big Villa",
                circuits: [{name: "Main"}],
                rooms: [{name: "Living Room", size: 25}],
            });

            expect(result.subDocuments).toHaveLength(2);
            expect(result.subDocuments![0].entityType).toBe("Circuit");
            expect(result.subDocuments![1].entityType).toBe("Room");
            expect(result.subDocuments![0].records[0].holidayHomeId).toBe("hh-1");
            expect(result.subDocuments![1].records[0].holidayHomeId).toBe("hh-1");
        });

        it("returns no sub-documents when no sub-document mappings defined", async () => {
            const mapping: SchemaMapping = {
                key: "Simple",
                pouchDocTypes: ["simple"],
                ormEntityName: "SimpleEntity",
            };

            const transformer = MigrationTransformer.fromSchemaMapping(mapping, "pouch-to-orm");

            const result = await transformer.transformWithSubDocuments({
                name: "Simple Record",
                nested: {a: 1},
            });

            expect(result.subDocuments).toHaveLength(0);
            expect(result.record.name).toBe("Simple Record");
        });
    });
});

// ============== BIDIRECTIONAL ROUND-TRIP TESTS ==============

describe("Bidirectional Round-Trip: PouchDB → SQLite → PouchDB", () => {
    it("preserves data through forward and reverse transforms", async () => {
        const registry = new SchemaMappingRegistry([
            {
                key: "Tester",
                pouchDocTypes: ["tester"],
                ormEntityName: "TesterEntity",
                forward: {
                    fieldTransforms: [
                        {sourceField: "fullName", targetField: "name"},
                        {sourceField: "emailAddress", targetField: "email"},
                    ],
                },
                reverse: {
                    fieldTransforms: [
                        {sourceField: "name", targetField: "fullName"},
                        {sourceField: "email", targetField: "emailAddress"},
                    ],
                },
            },
        ]);

        // Forward: PouchDB → SQLite
        const forwardTransformer = MigrationTransformer.fromRegistry(registry, "Tester", "pouch-to-orm");
        const original = {
            fullName: "Jane Doe",
            emailAddress: "jane@test.com",
            active: true,
        };

        const [forwardResult] = await forwardTransformer.transform(original);
        expect(forwardResult.name).toBe("Jane Doe");
        expect(forwardResult.email).toBe("jane@test.com");
        expect(forwardResult.active).toBe(true);

        // Reverse: SQLite → PouchDB
        const reverseTransformer = MigrationTransformer.fromRegistry(registry, "Tester", "orm-to-pouch");
        const [reverseResult] = await reverseTransformer.transform(forwardResult);

        // Should be back to original field names
        expect(reverseResult.fullName).toBe("Jane Doe");
        expect(reverseResult.emailAddress).toBe("jane@test.com");
        expect(reverseResult.active).toBe(true);
    });

    it("handles type conversions bidirectionally", async () => {
        const registry = new SchemaMappingRegistry([
            {
                key: "Event",
                pouchDocTypes: ["event"],
                ormEntityName: "EventEntity",
                forward: {
                    fieldTransforms: [
                        {sourceField: "eventDate", targetField: "date", convert: "stringToDate"},
                    ],
                },
                reverse: {
                    fieldTransforms: [
                        {sourceField: "date", targetField: "eventDate", convert: "dateToString"},
                    ],
                },
            },
        ]);

        const originalDate = "2024-06-15T10:30:00.000Z";

        // Forward: string → Date
        const forward = MigrationTransformer.fromRegistry(registry, "Event", "pouch-to-orm");
        const [ormRecord] = await forward.transform({eventDate: originalDate});
        expect(ormRecord.date).toBeInstanceOf(Date);
        expect((ormRecord.date as Date).toISOString()).toBe(originalDate);

        // Reverse: Date → string
        const reverse = MigrationTransformer.fromRegistry(registry, "Event", "orm-to-pouch");
        const [pouchRecord] = await reverse.transform(ormRecord);
        expect(typeof pouchRecord.eventDate).toBe("string");
        expect(pouchRecord.eventDate).toBe(originalDate);
    });

    it("preserves sub-document data through round-trip", async () => {
        const registry = new SchemaMappingRegistry([
            {
                key: "HolidayHome",
                pouchDocTypes: ["holidayHome"],
                ormEntityName: "HolidayHomeEntity",
                forward: {
                    fieldTransforms: [
                        {sourceField: "homeName", targetField: "name"},
                    ],
                },
                reverse: {
                    fieldTransforms: [
                        {sourceField: "name", targetField: "homeName"},
                    ],
                },
                subDocuments: [
                    {
                        sourceField: "circuits",
                        targetEntityType: "Circuit",
                        foreignKeyField: "holidayHomeId",
                        fieldTransforms: [
                            {sourceField: "circuitName", targetField: "name"},
                        ],
                    },
                ],
            },
        ]);

        // Forward transform with sub-documents
        const forward = MigrationTransformer.fromRegistry(registry, "HolidayHome", "pouch-to-orm");
        const result = await forward.transformWithSubDocuments({
            _id: "hh-1",
            homeName: "Villa",
            circuits: [{circuitName: "Ring Main", voltage: 230}],
        });

        expect(result.record.name).toBe("Villa");
        expect(result.subDocuments![0].records[0].name).toBe("Ring Main");
        expect(result.subDocuments![0].records[0].voltage).toBe(230);
        expect(result.subDocuments![0].records[0].holidayHomeId).toBe("hh-1");
    });
});

// ============== TYPE INFERENCE & EDGE CASES TESTS ==============

describe("Type Inference and Edge Cases", () => {
    it("infers migration direction from source DAO constructor name", () => {
        // This tests the pattern used in DataMigrationPump.inferDirection
        function inferDirection(sourceDAOName: string): MigrationDirection {
            if (sourceDAOName.includes("Pouch")) return "pouch-to-orm";
            return "orm-to-pouch";
        }

        expect(inferDirection("GenericPouchDAO")).toBe("pouch-to-orm");
        expect(inferDirection("GenericOrmDAO")).toBe("orm-to-pouch");
    });

    it("handles unknown docType in mixed document stream", () => {
        const registry = new SchemaMappingRegistry([
            {key: "User", pouchDocTypes: ["user"], ormEntityName: "UserEntity"},
            {key: "Product", pouchDocTypes: ["product"], ormEntityName: "ProductEntity"},
        ]);

        const records = [
            {docType: "user", name: "Alice"},
            {docType: "product", name: "Widget"},
            {docType: "unknown", name: "Mystery"},
            {name: "NoType"},
        ];

        const mapped = records.map(r => ({
            record: r,
            mapping: registry.getByDocType(r.docType ?? ""),
        }));

        expect(mapped[0].mapping?.key).toBe("User");
        expect(mapped[1].mapping?.key).toBe("Product");
        expect(mapped[2].mapping).toBeUndefined();
        expect(mapped[3].mapping).toBeUndefined();
    });

    it("handles empty record in transform", async () => {
        const transformer = new MigrationTransformer({
            stripFields: [],
            fieldMappings: [],
        });

        const [result] = await transformer.transform({});
        expect(Object.keys(result)).toHaveLength(0);
    });

    it("handles record with only metadata fields", async () => {
        const transformer = new MigrationTransformer({
            stripFields: POUCH_STRIP_FIELDS,
            fieldMappings: [],
        });

        const [result] = await transformer.transform({
            _id: "1",
            _rev: "1-a",
            docType: "user",
            entityType: "user",
        });

        expect(Object.keys(result)).toHaveLength(0);
    });

    it("handles custom transform that returns completely different shape", async () => {
        const mapping: SchemaMapping = {
            key: "Transform",
            pouchDocTypes: ["transform"],
            ormEntityName: "TransformEntity",
            forward: {
                customTransform: (record: any) => ({
                    computed: `${record.a}_${record.b}`,
                    source: "migration",
                }),
            },
        };

        const transformer = MigrationTransformer.fromSchemaMapping(mapping, "pouch-to-orm");
        const [result] = await transformer.transform({a: "hello", b: "world"});

        expect(result.computed).toBe("hello_world");
        expect(result.source).toBe("migration");
        expect(result).not.toHaveProperty("a");
        expect(result).not.toHaveProperty("b");
    });
});
