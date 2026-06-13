import {FieldMapping, EntityTypeTransform, TransformFn} from "./MigrationOptions";
import {MigrationWarningEntry} from "./MigrationResult";

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
 * Pluggable transformer that:
 * - Strips source-specific metadata
 * - Maps field names between source and target schemas
 * - Performs data type conversions
 * - Applies custom transformation rules
 * - Validates transformed records
 */
export class MigrationTransformer {
    private readonly stripSet: Set<string>;
    private readonly fieldMap: Map<string, string>;
    private readonly converters: TypeConverter[];
    private readonly customTransform?: TransformFn;
    private readonly validate?: (record: any) => boolean;

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
            const targetKey = this.fieldMap.get(key) ?? key;
            // If multiple source keys map to the same target, merge objects, otherwise overwrite
            if (mapped[targetKey] !== undefined && typeof mapped[targetKey] === "object" && typeof value === "object") {
                mapped[targetKey] = {...mapped[targetKey], ...value};
            } else {
                mapped[targetKey] = value;
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
}
