import {FieldMapping, EntityTypeTransform, TransformFn} from "./MigrationOptions";
import {MigrationWarningEntry} from "./MigrationResult";
import {
    SchemaMapping,
    SchemaMappingRegistry,
    MigrationDirection,
    FieldTransformSpec,
    ResolvedFieldMap,
    resolveFieldTransforms,
    SubDocumentMapping,
} from "./SchemaMapping";

/**
 * Default fields to strip from PouchDB documents.
 */
export const POUCH_STRIP_FIELDS: string[] = ["_id", "_rev", "entityType", "appVersion", "dataVersion", "docType"];

/**
 * Default fields to strip from TypeORM documents.
 */
export const ORM_STRIP_FIELDS: string[] = ["_id", "_rev", "appVersion", "__entity"];

/**
 * Built-in data type conversions.
 */
export type TypeConverter = (value: any) => any;

export const BUILTIN_CONVERTERS: Record<string, TypeConverter> = {
    /** Convert ISO date strings to Date objects. */
    stringToDate: (v: any) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(v) : v),

    /** Convert Date objects to ISO date strings. */
    dateToString: (v: any) => (v instanceof Date ? v.toISOString() : v),

    /** Convert string numbers to actual numbers. */
    stringToNumber: (v: any) => (typeof v === "string" && v !== "" && !isNaN(Number(v)) ? Number(v) : v),

    /** Convert string booleans to actual booleans. */
    stringToBoolean: (v: any) => {
        if (v === "true") return true;
        if (v === "false") return false;
        return v;
    },
};

/**
 * Configuration for the MigrationTransformer.
 */
export interface TransformerConfig {
    /** Fields to strip. */
    stripFields: string[];

    /** Field name mappings. */
    fieldMappings: FieldMapping[];

    /** Named converters to apply (e.g. "stringToDate"). */
    converters?: string[];

    /** Custom transform applied after built-in transforms. */
    customTransform?: TransformFn;

    /** Validation function — returns true if the record is valid. */
    validate?: (record: any) => boolean;
}

/**
 * Result of transforming a record that may contain sub-documents.
 */
export interface TransformResult {
    /** The main transformed record. */
    record: Record<string, any>;

    /** Extracted sub-document records, keyed by target entity type. */
    subDocuments?: Array<{
        entityType: string;
        records: Record<string, any>[];
        foreignKeyField: string;
        parentId?: string;
    }>;

    /** Warnings generated during transform. */
    warnings: MigrationWarningEntry[];
}

/**
 * Pluggable transformer that:
 * - Strips source-specific metadata
 * - Maps field names between source and target schemas
 * - Performs data type conversions
 * - Applies custom transformation rules
 * - Validates transformed records
 * - Handles sub-document extraction (nested → separate tables)
 * - Supports bidirectional mapping via SchemaMapping
 */
export class MigrationTransformer {
    private readonly stripSet: Set<string>;
    private readonly fieldMap: Map<string, string>;
    private readonly converters: TypeConverter[];
    private readonly customTransform?: TransformFn;
    private readonly validate?: (record: any) => boolean;

    // Enhanced fields for SchemaMapping support
    private readonly resolvedFieldMap?: Map<string, ResolvedFieldMap>;
    private readonly subDocumentMappings?: SubDocumentMapping[];

    constructor(config: TransformerConfig) {
        this.stripSet = new Set(config.stripFields);
        this.fieldMap = new Map(config.fieldMappings.map(m => [m.sourceField, m.targetField]));
        this.converters = (config.converters ?? []).map(name => {
            const converter = BUILTIN_CONVERTERS[name];
            if (!converter) throw new Error(`Unknown converter: ${name}`);
            return converter;
        });
        this.customTransform = config.customTransform;
        this.validate = config.validate;
    }

    /**
     * Transform a single source record into target schema.
     * Returns [record, warnings].
     */
    async transform(record: Record<string, any>): Promise<[Record<string, any>, MigrationWarningEntry[]]> {
        const warnings: MigrationWarningEntry[] = [];

        // 1. Strip metadata fields
        let result: Record<string, any> = {};
        for (const [key, value] of Object.entries(record)) {
            if (this.stripSet.has(key)) continue;
            result[key] = value;
        }

        // 2. Apply field name mappings
        const mapped: Record<string, any> = {};
        for (const [key, value] of Object.entries(result)) {
            // Check resolved field map first (from SchemaMapping)
            if (this.resolvedFieldMap && this.resolvedFieldMap.has(key)) {
                const resolved = this.resolvedFieldMap.get(key)!;
                let v = value;
                if (resolved.convertFn) {
                    v = resolved.convertFn(v, record);
                }
                mapped[resolved.targetField] = v;
            } else {
                const targetKey = this.fieldMap.get(key) ?? key;
                // If multiple source keys map to the same target, merge objects, otherwise overwrite
                if (mapped[targetKey] !== undefined && typeof mapped[targetKey] === "object" && typeof value === "object") {
                    mapped[targetKey] = {...mapped[targetKey], ...value};
                } else {
                    mapped[targetKey] = value;
                }
            }
        }
        result = mapped;

        // 3. Apply type converters
        for (const converter of this.converters) {
            for (const [key, value] of Object.entries(result)) {
                result[key] = converter(value);
            }
        }

        // 4. Apply custom transform
        if (this.customTransform) {
            result = await this.customTransform(result);
        }

        // 5. Validate
        if (this.validate && !this.validate(result)) {
            warnings.push({
                message: `Validation failed for transformed record`,
                entityType: result["entityType"] ?? "unknown",
            });
        }

        return [result, warnings];
    }

    /**
     * Transform a record with sub-document extraction.
     * Returns a TransformResult with the main record plus extracted sub-documents.
     */
    async transformWithSubDocuments(
        record: Record<string, any>,
        parentEntityType?: string,
    ): Promise<TransformResult> {
        const [mainRecord, warnings] = await this.transform(record);
        const subDocs: TransformResult["subDocuments"] = [];

        if (!this.subDocumentMappings || this.subDocumentMappings.length === 0) {
            return {record: mainRecord, subDocuments: [], warnings};
        }

        for (const subMapping of this.subDocumentMappings) {
            const fieldValue = mainRecord[subMapping.sourceField];
            if (fieldValue === undefined || fieldValue === null) continue;

            // Remove the sub-document array from the main record
            delete mainRecord[subMapping.sourceField];

            const subRecords: Record<string, any>[] = [];
            const items = Array.isArray(fieldValue) ? fieldValue : [fieldValue];

            for (const item of items) {
                let subRecord: Record<string, any> = {};

                // Apply field transforms for sub-documents
                const subFieldMap = subMapping.fieldTransforms
                    ? resolveFieldTransforms(subMapping.fieldTransforms)
                    : new Map<string, ResolvedFieldMap>();

                for (const [key, value] of Object.entries(item)) {
                    if (subFieldMap.has(key)) {
                        const resolved = subFieldMap.get(key)!;
                        let v = value;
                        if (resolved.convertFn) {
                            v = resolved.convertFn(v, item);
                        }
                        subRecord[resolved.targetField] = v;
                    } else {
                        subRecord[key] = value;
                    }
                }

                // Set foreign key
                const fkField = subMapping.foreignKeyField ?? "parentId";
                subRecord[fkField] = mainRecord["id"] ?? record["_id"];

                subRecords.push(subRecord);
            }

            subDocs!.push({
                entityType: subMapping.targetEntityType,
                records: subRecords,
                foreignKeyField: subMapping.foreignKeyField ?? "parentId",
                parentId: mainRecord["id"] ?? record["_id"],
            });
        }

        return {record: mainRecord, subDocuments: subDocs, warnings};
    }

    /**
     * Transform a batch of records.
     */
    async transformBatch(records: Record<string, any>[]): Promise<[Record<string, any>[], MigrationWarningEntry[]]> {
        const results: Record<string, any>[] = [];
        const allWarnings: MigrationWarningEntry[] = [];

        for (const record of records) {
            const [transformed, warnings] = await this.transform(record);
            results.push(transformed);
            allWarnings.push(...warnings);
        }

        return [results, allWarnings];
    }

    /**
     * Build a TransformerConfig from an EntityTypeTransform.
     */
    static fromEntityType(et: EntityTypeTransform): MigrationTransformer {
        return new MigrationTransformer({
            stripFields: et.stripFields ?? POUCH_STRIP_FIELDS,
            fieldMappings: et.fieldMappings ?? [],
            customTransform: et.customTransform,
            validate: et.validateSchema,
        });
    }

    /**
     * Build a transformer from a SchemaMapping and direction.
     * This enables type-aware, bidirectional transformation.
     */
    static fromSchemaMapping(
        mapping: SchemaMapping,
        direction: MigrationDirection,
        stripFieldsOverride?: string[],
    ): MigrationTransformer {
        const config = direction === "pouch-to-orm" ? mapping.forward : mapping.reverse;

        // Determine strip fields
        const baseStrip = direction === "pouch-to-orm" ? POUCH_STRIP_FIELDS : ORM_STRIP_FIELDS;
        const stripFields = stripFieldsOverride ?? mapping.stripFields ?? baseStrip;

        // Convert FieldTransformSpec[] to FieldMapping[] for the base transformer
        const fieldMappings: FieldMapping[] = (config?.fieldTransforms ?? []).map(t => ({
            sourceField: t.sourceField,
            targetField: t.targetField,
        }));

        const transformer = new MigrationTransformer({
            stripFields,
            fieldMappings,
            customTransform: config?.customTransform,
        });

        // Attach resolved field map for converter support
        if (config?.fieldTransforms) {
            const resolved = resolveFieldTransforms(
                config.fieldTransforms.filter(t => t.convert !== undefined),
            );
            // Also resolve named string converters
            for (const ft of config.fieldTransforms) {
                if (ft.convert && typeof ft.convert === "string") {
                    const builtin = BUILTIN_CONVERTERS[ft.convert];
                    if (builtin) {
                        const entry = resolved.get(ft.sourceField);
                        if (entry) {
                            entry.convertFn = builtin;
                        }
                    }
                }
            }
            (transformer as any).resolvedFieldMap = resolved;
        }

        // Attach sub-document mappings
        if (direction === "pouch-to-orm" && mapping.subDocuments) {
            (transformer as any).subDocumentMappings = mapping.subDocuments;
        }

        return transformer;
    }

    /**
     * Build a transformer from a SchemaMappingRegistry lookup.
     * Finds the mapping by key, then creates a direction-aware transformer.
     */
    static fromRegistry(
        registry: SchemaMappingRegistry,
        mappingKey: string,
        direction: MigrationDirection,
    ): MigrationTransformer {
        const mapping = registry.getByKey(mappingKey);
        if (!mapping) {
            throw new Error(`No SchemaMapping registered with key: ${mappingKey}`);
        }
        return MigrationTransformer.fromSchemaMapping(mapping, direction);
    }
}
