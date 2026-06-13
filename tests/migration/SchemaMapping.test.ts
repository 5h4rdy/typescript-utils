import {
    SchemaMapping,
    SchemaMappingRegistry,
    FieldTransformSpec,
    SubDocumentMapping,
    MigrationDirection,
    resolveFieldTransforms,
    findMappingForRecord,
} from "../../src/services/migration/SchemaMapping";

// ============== SCHEMA MAPPING REGISTRY TESTS ==============

describe("SchemaMappingRegistry", () => {

    describe("Registration", () => {
        it("registers a simple 1:1 mapping", () => {
            const registry = new SchemaMappingRegistry([
                {
                    key: "User",
                    pouchDocTypes: ["user"],
                    ormEntityName: "UserEntity",
                },
            ]);

            expect(registry.getByKey("User")).toBeDefined();
            expect(registry.getByDocType("user")).toBeDefined();
            expect(registry.getByOrmEntity("UserEntity")).toBeDefined();
        });

        it("registers a mapping with multiple PouchDB docTypes → one entity", () => {
            const registry = new SchemaMappingRegistry([
                {
                    key: "Tester",
                    pouchDocTypes: ["tester", "tester_legacy"],
                    ormEntityName: "TesterEntity",
                },
            ]);

            expect(registry.getByDocType("tester")?.key).toBe("Tester");
            expect(registry.getByDocType("tester_legacy")?.key).toBe("Tester");
            expect(registry.getByOrmEntity("TesterEntity")?.key).toBe("Tester");
        });

        it("registers multiple mappings", () => {
            const registry = new SchemaMappingRegistry([
                {key: "User", pouchDocTypes: ["user"], ormEntityName: "UserEntity"},
                {key: "Product", pouchDocTypes: ["product"], ormEntityName: "ProductEntity"},
                {key: "HolidayHome", pouchDocTypes: ["holidayHome"], ormEntityName: "HolidayHomeEntity"},
            ]);

            expect(registry.getAll()).toHaveLength(3);
            expect(registry.hasDocType("user")).toBe(true);
            expect(registry.hasDocType("product")).toBe(true);
            expect(registry.hasDocType("holidayHome")).toBe(true);
            expect(registry.hasDocType("unknown")).toBe(false);
        });

        it("throws on duplicate mapping key", () => {
            expect(() => {
                new SchemaMappingRegistry([
                    {key: "User", pouchDocTypes: ["user"], ormEntityName: "UserEntity"},
                    {key: "User", pouchDocTypes: ["other"], ormEntityName: "OtherEntity"},
                ]);
            }).toThrow("already registered with key: User");
        });

        it("throws on duplicate docType mapping", () => {
            expect(() => {
                new SchemaMappingRegistry([
                    {key: "User", pouchDocTypes: ["user"], ormEntityName: "UserEntity"},
                    {key: "Member", pouchDocTypes: ["user"], ormEntityName: "MemberEntity"},
                ]);
            }).toThrow('docType "user" is already mapped');
        });

        it("throws on duplicate ORM entity mapping", () => {
            expect(() => {
                new SchemaMappingRegistry([
                    {key: "User", pouchDocTypes: ["user"], ormEntityName: "UserEntity"},
                    {key: "Member", pouchDocTypes: ["member"], ormEntityName: "UserEntity"},
                ]);
            }).toThrow('ORM entity "UserEntity" is already mapped');
        });

        it("can register mappings one at a time", () => {
            const registry = new SchemaMappingRegistry();
            registry.register({key: "User", pouchDocTypes: ["user"], ormEntityName: "UserEntity"});
            registry.register({key: "Product", pouchDocTypes: ["product"], ormEntityName: "ProductEntity"});

            expect(registry.getAll()).toHaveLength(2);
        });

        it("allows the same mapping object to be re-registered (idempotent)", () => {
            const mapping: SchemaMapping = {
                key: "User",
                pouchDocTypes: ["user"],
                ormEntityName: "UserEntity",
            };
            const registry = new SchemaMappingRegistry([mapping]);
            // Re-registering the exact same mapping object should be a no-op
            registry.register(mapping);
            expect(registry.getAll()).toHaveLength(1);
        });

        it("rejects a different mapping with the same key", () => {
            const registry = new SchemaMappingRegistry([
                {key: "User", pouchDocTypes: ["user"], ormEntityName: "UserEntity"},
            ]);
            expect(() => {
                registry.register({key: "User", pouchDocTypes: ["other"], ormEntityName: "OtherEntity"});
            }).toThrow("already registered with key: User");
        });
    });

    describe("Lookup", () => {
        it("returns undefined for unknown key", () => {
            const registry = new SchemaMappingRegistry();
            expect(registry.getByKey("NonExistent")).toBeUndefined();
        });

        it("returns undefined for unknown docType", () => {
            const registry = new SchemaMappingRegistry();
            expect(registry.getByDocType("unknown")).toBeUndefined();
        });

        it("returns undefined for unknown ORM entity", () => {
            const registry = new SchemaMappingRegistry();
            expect(registry.getByOrmEntity("Unknown")).toBeUndefined();
        });

        it("hasOrmEntity checks correctly", () => {
            const registry = new SchemaMappingRegistry([
                {key: "User", pouchDocTypes: ["user"], ormEntityName: "UserEntity"},
            ]);

            expect(registry.hasOrmEntity("UserEntity")).toBe(true);
            expect(registry.hasOrmEntity("Unknown")).toBe(false);
        });
    });

    describe("getFieldTransforms", () => {
        it("returns forward transforms for pouch-to-orm direction", () => {
            const registry = new SchemaMappingRegistry([
                {
                    key: "User",
                    pouchDocTypes: ["user"],
                    ormEntityName: "UserEntity",
                    forward: {
                        fieldTransforms: [
                            {sourceField: "firstName", targetField: "name"},
                            {sourceField: "yearsOld", targetField: "age", convert: "stringToNumber"},
                        ],
                    },
                },
            ]);

            const transforms = registry.getFieldTransforms("User", "pouch-to-orm");
            expect(transforms).toHaveLength(2);
            expect(transforms[0].sourceField).toBe("firstName");
            expect(transforms[1].convert).toBe("stringToNumber");
        });

        it("returns reverse transforms for orm-to-pouch direction", () => {
            const registry = new SchemaMappingRegistry([
                {
                    key: "User",
                    pouchDocTypes: ["user"],
                    ormEntityName: "UserEntity",
                    reverse: {
                        fieldTransforms: [
                            {sourceField: "name", targetField: "firstName"},
                            {sourceField: "age", targetField: "yearsOld", convert: "stringToNumber"},
                        ],
                    },
                },
            ]);

            const transforms = registry.getFieldTransforms("User", "orm-to-pouch");
            expect(transforms).toHaveLength(2);
            expect(transforms[0].sourceField).toBe("name");
        });

        it("returns empty array for unknown mapping key", () => {
            const registry = new SchemaMappingRegistry();
            expect(registry.getFieldTransforms("Unknown", "pouch-to-orm")).toEqual([]);
        });

        it("returns empty array when no transforms defined", () => {
            const registry = new SchemaMappingRegistry([
                {key: "User", pouchDocTypes: ["user"], ormEntityName: "UserEntity"},
            ]);
            expect(registry.getFieldTransforms("User", "pouch-to-orm")).toEqual([]);
        });
    });

    describe("getCustomTransform", () => {
        it("returns forward custom transform", () => {
            const fn = (r: any) => ({...r, extra: true});
            const registry = new SchemaMappingRegistry([
                {
                    key: "User",
                    pouchDocTypes: ["user"],
                    ormEntityName: "UserEntity",
                    forward: {customTransform: fn},
                },
            ]);

            expect(registry.getCustomTransform("User", "pouch-to-orm")).toBe(fn);
        });

        it("returns reverse custom transform", () => {
            const fn = (r: any) => ({...r, reverse: true});
            const registry = new SchemaMappingRegistry([
                {
                    key: "User",
                    pouchDocTypes: ["user"],
                    ormEntityName: "UserEntity",
                    reverse: {customTransform: fn},
                },
            ]);

            expect(registry.getCustomTransform("User", "orm-to-pouch")).toBe(fn);
        });

        it("returns undefined when no custom transform", () => {
            const registry = new SchemaMappingRegistry([
                {key: "User", pouchDocTypes: ["user"], ormEntityName: "UserEntity"},
            ]);

            expect(registry.getCustomTransform("User", "pouch-to-orm")).toBeUndefined();
        });
    });
});

// ============== RESOLVE FIELD TRANSFORMS TESTS ==============

describe("resolveFieldTransforms", () => {
    it("creates a map from FieldTransformSpec array", () => {
        const transforms: FieldTransformSpec[] = [
            {sourceField: "a", targetField: "alpha"},
            {sourceField: "b", targetField: "beta"},
        ];

        const map = resolveFieldTransforms(transforms);

        expect(map.get("a")?.targetField).toBe("alpha");
        expect(map.get("b")?.targetField).toBe("beta");
    });

    it("includes convertFn for function converters", () => {
        const myConverter = (v: any) => String(v);
        const transforms: FieldTransformSpec[] = [
            {sourceField: "count", targetField: "countStr", convert: myConverter},
        ];

        const map = resolveFieldTransforms(transforms);

        expect(map.get("count")?.convertFn).toBe(myConverter);
    });

    it("does not include convertFn for named string converters", () => {
        const transforms: FieldTransformSpec[] = [
            {sourceField: "count", targetField: "countStr", convert: "stringToNumber"},
        ];

        const map = resolveFieldTransforms(transforms);

        expect(map.get("count")?.convertFn).toBeUndefined();
    });

    it("handles empty array", () => {
        const map = resolveFieldTransforms([]);
        expect(map.size).toBe(0);
    });

    it("handles drop field", () => {
        const transforms: FieldTransformSpec[] = [
            {sourceField: "oldField", targetField: "oldField", drop: true},
        ];

        const map = resolveFieldTransforms(transforms);
        expect(map.get("oldField")?.targetField).toBe("oldField");
    });
});

// ============== FIND MAPPING FOR RECORD TESTS ==============

describe("findMappingForRecord", () => {
    it("finds mapping by docType field", () => {
        const registry = new SchemaMappingRegistry([
            {key: "User", pouchDocTypes: ["user"], ormEntityName: "UserEntity"},
        ]);

        const mapping = findMappingForRecord({docType: "user", name: "Alice"}, registry);
        expect(mapping?.key).toBe("User");
    });

    it("finds mapping by entityType field", () => {
        const registry = new SchemaMappingRegistry([
            {key: "User", pouchDocTypes: ["user"], ormEntityName: "UserEntity"},
        ]);

        const mapping = findMappingForRecord({entityType: "user", name: "Bob"}, registry);
        expect(mapping?.key).toBe("User");
    });

    it("returns undefined for unknown docType", () => {
        const registry = new SchemaMappingRegistry([
            {key: "User", pouchDocTypes: ["user"], ormEntityName: "UserEntity"},
        ]);

        const mapping = findMappingForRecord({docType: "unknown"}, registry);
        expect(mapping).toBeUndefined();
    });

    it("returns undefined when no docType or entityType", () => {
        const registry = new SchemaMappingRegistry([
            {key: "User", pouchDocTypes: ["user"], ormEntityName: "UserEntity"},
        ]);

        const mapping = findMappingForRecord({name: "NoType"}, registry);
        expect(mapping).toBeUndefined();
    });
});

// ============== SCHEMA MAPPING STRUCTURE TESTS ==============

describe("SchemaMapping Structure", () => {
    it("supports sub-document mappings", () => {
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

        expect(mapping.subDocuments).toHaveLength(1);
        expect(mapping.subDocuments![0].targetEntityType).toBe("Circuit");
        expect(mapping.subDocuments![0].foreignKeyField).toBe("holidayHomeId");
    });

    it("supports bidirectional field transforms", () => {
        const mapping: SchemaMapping = {
            key: "Park",
            pouchDocTypes: ["park"],
            ormEntityName: "ParkEntity",
            forward: {
                fieldTransforms: [
                    {sourceField: "parkName", targetField: "name"},
                    {sourceField: "createdAt", targetField: "createdDate", convert: "stringToDate"},
                ],
            },
            reverse: {
                fieldTransforms: [
                    {sourceField: "name", targetField: "parkName"},
                    {sourceField: "createdDate", targetField: "createdAt", convert: "dateToString"},
                ],
            },
        };

        expect(mapping.forward?.fieldTransforms).toHaveLength(2);
        expect(mapping.reverse?.fieldTransforms).toHaveLength(2);
    });

    it("supports custom strip fields", () => {
        const mapping: SchemaMapping = {
            key: "Custom",
            pouchDocTypes: ["custom"],
            ormEntityName: "CustomEntity",
            stripFields: ["_id", "_rev", "internalFlag", "legacyField"],
        };

        expect(mapping.stripFields).toContain("internalFlag");
        expect(mapping.stripFields).toContain("legacyField");
    });

    it("supports multiple docTypes for one entity (tester + tester_legacy)", () => {
        const mapping: SchemaMapping = {
            key: "Tester",
            pouchDocTypes: ["tester", "tester_legacy"],
            ormEntityName: "TesterEntity",
        };

        expect(mapping.pouchDocTypes).toHaveLength(2);
        expect(mapping.pouchDocTypes).toContain("tester");
        expect(mapping.pouchDocTypes).toContain("tester_legacy");
    });

    it("supports inheritance through field mapping (HolidayHome extends Entity)", () => {
        // In PouchDB, HolidayHome has all Entity fields plus its own.
        // In TypeORM, HolidayHomeEntity extends GenericOrmDoc.
        // The SchemaMapping handles this through field transforms — no special
        // inheritance mechanism needed since both sides share the base fields.
        const mapping: SchemaMapping = {
            key: "HolidayHome",
            pouchDocTypes: ["holidayHome"],
            ormEntityName: "HolidayHomeEntity",
            forward: {
                fieldTransforms: [
                    // Entity base fields pass through unchanged
                    // HolidayHome-specific fields get mapped
                    {sourceField: "homeName", targetField: "name"},
                    {sourceField: "parkRef", targetField: "parkId"},
                ],
                customTransform: (record: any) => ({
                    ...record,
                    // Ensure inherited fields are preserved
                    entityType: "HolidayHome",
                }),
            },
        };

        expect(mapping.forward?.fieldTransforms).toHaveLength(2);
        expect(mapping.forward?.customTransform).toBeDefined();
    });
});
