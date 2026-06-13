import {TransformFn, FieldMapping} from "./MigrationOptions";
import {MigrationWarningEntry} from "./MigrationResult";

/**
 * Direction of migration.
 */
export type MigrationDirection = "pouch-to-orm" | "orm-to-pouch";

/**
 * Field-level transform specification for a single direction.
 */
export interface FieldTransformSpec {
    /** Source field name in the source store. */
    sourceField: string;
    /** Target field name in the target store. */
    targetField: string;

    /**
     * Optional type conversion applied during this mapping.
     * Can be a named built-in converter (e.g. "stringToDate")
     * or a custom function.
     */
    convert?: string | ((value: any, record?: any) => any);

    /**
     * If true, the field is dropped entirely (useful for conditional stripping).
     */
    drop?: boolean;
}

/**
 * Sub-document mapping: a nested object inside a source document that
 * should be extracted into a separate target table/collection.
 */
export interface SubDocumentMapping {
    /** Field in the source document that holds the nested array/object. */
    sourceField: string;

    /** Entity type name for the extracted sub-documents. */
    targetEntityType: string;

    /**
     * Foreign key field name on the sub-document that will reference
     * the parent document's ID. Default: "parentId".
     */
    foreignKeyField?: string;

    /** Optional field-level transforms for the sub-documents. */
    fieldTransforms?: FieldTransformSpec[];

    /**
     * If the sub-documents should themselves be processed by a
     * SchemaMapping, provide its key in the registry.
     */
    mappingKey?: string;
}

/**
 * A complete bidirectional mapping between one source docType/entity
 * and one (or more) target entities.
 */
export interface SchemaMapping {
    /** Unique key for this mapping (e.g. "User", "HolidayHome"). */
    key: string;

    /** PouchDB docType values that map to this entity. */
    pouchDocTypes: string[];

    /** TypeORM entity class name (or table name). */
    ormEntityName: string;

    /** Fields to always strip, regardless of direction. */
    stripFields?: string[];

    /** Forward transforms: PouchDB → TypeORM. */
    forward?: {
        fieldTransforms?: FieldTransformSpec[];
        customTransform?: TransformFn;
    };

    /** Reverse transforms: TypeORM → PouchDB. */
    reverse?: {
        fieldTransforms?: FieldTransformSpec[];
        customTransform?: TransformFn;
    };

    /** Sub-document mappings for nested objects → separate tables. */
    subDocuments?: SubDocumentMapping[];
}

/**
 * Registry of all schema mappings for a migration.
 * Provides lookup by PouchDB docType, ORM entity name, or mapping key.
 */
export class SchemaMappingRegistry {
    private readonly byKey = new Map<string, SchemaMapping>();
    private readonly byDocType = new Map<string, SchemaMapping>();
    private readonly byOrmEntity = new Map<string, SchemaMapping>();

    constructor(mappings: SchemaMapping[] = []) {
        for (const m of mappings) {
            this.register(m);
        }
    }

    /**
     * Register a mapping.
     * Re-registering the exact same mapping object is a no-op.
     */
    register(mapping: SchemaMapping): void {
        if (this.byKey.get(mapping.key) === mapping) {
            // Idempotent re-registration of the same object
            return;
        }
        if (this.byKey.has(mapping.key)) {
            throw new Error(`SchemaMapping already registered with key: ${mapping.key}`);
        }
        this.byKey.set(mapping.key, mapping);

        for (const docType of mapping.pouchDocTypes) {
            if (this.byDocType.has(docType) && this.byDocType.get(docType) !== mapping) {
                throw new Error(
                    `PouchDB docType "${docType}" is already mapped to "${this.byDocType.get(docType)!.key}"`,
                );
            }
            this.byDocType.set(docType, mapping);
        }

        if (mapping.ormEntityName) {
            if (this.byOrmEntity.has(mapping.ormEntityName) && this.byOrmEntity.get(mapping.ormEntityName) !== mapping) {
                throw new Error(
                    `ORM entity "${mapping.ormEntityName}" is already mapped to "${this.byOrmEntity.get(mapping.ormEntityName)!.key}"`,
                );
            }
            this.byOrmEntity.set(mapping.ormEntityName, mapping);
        }
    }

    /**
     * Look up a mapping by its key.
     */
    getByKey(key: string): SchemaMapping | undefined {
        return this.byKey.get(key);
    }

    /**
     * Look up a mapping by PouchDB docType.
     */
    getByDocType(docType: string): SchemaMapping | undefined {
        return this.byDocType.get(docType);
    }

    /**
     * Look up a mapping by TypeORM entity name.
     */
    getByOrmEntity(entityName: string): SchemaMapping | undefined {
        return this.byOrmEntity.get(entityName);
    }

    /**
     * Get all registered mappings.
     */
    getAll(): SchemaMapping[] {
        return Array.from(this.byKey.values());
    }

    /**
     * Check if a docType is registered.
     */
    hasDocType(docType: string): boolean {
        return this.byDocType.has(docType);
    }

    /**
     * Check if an ORM entity is registered.
     */
    hasOrmEntity(entityName: string): boolean {
        return this.byOrmEntity.has(entityName);
    }

    /**
     * Get the appropriate field transforms for a direction.
     */
    getFieldTransforms(mappingKey: string, direction: MigrationDirection): FieldTransformSpec[] {
        const mapping = this.getByKey(mappingKey);
        if (!mapping) return [];

        const config = direction === "pouch-to-orm" ? mapping.forward : mapping.reverse;
        return config?.fieldTransforms ?? [];
    }

    /**
     * Get the custom transform for a direction.
     */
    getCustomTransform(mappingKey: string, direction: MigrationDirection): TransformFn | undefined {
        const mapping = this.getByKey(mappingKey);
        if (!mapping) return undefined;

        const config = direction === "pouch-to-orm" ? mapping.forward : mapping.reverse;
        return config?.customTransform;
    }
}

/**
 * Resolve field-level transforms for a given mapping and direction.
 * Returns a map of sourceField → { targetField, convertFn? }.
 */
export interface ResolvedFieldMap {
    targetField: string;
    convertFn?: (value: any, record?: any) => any;
}

export function resolveFieldTransforms(
    transforms: FieldTransformSpec[],
): Map<string, ResolvedFieldMap> {
    const map = new Map<string, ResolvedFieldMap>();
    for (const t of transforms) {
        let convertFn: ((value: any, record?: any) => any) | undefined;

        if (t.convert) {
            if (typeof t.convert === "function") {
                convertFn = t.convert;
            }
            // Named converters are resolved by the MigrationTransformer
        }

        map.set(t.sourceField, {
            targetField: t.targetField,
            convertFn,
        });
    }
    return map;
}

/**
 * Check if a record's docType field matches any registered mapping.
 * Useful for filtering mixed-document streams.
 */
export function findMappingForRecord(
    record: Record<string, any>,
    registry: SchemaMappingRegistry,
): SchemaMapping | undefined {
    const docType = record["docType"] ?? record["entityType"];
    if (docType) {
        return registry.getByDocType(docType);
    }
    return undefined;
}
