import React, { useState, useMemo } from 'react';
import CustomSelect from './CustomSelect';

/**
 * SchemaField — Renders a form field automatically based on JSON Schema + uiHints
 * from openclaw's config.schema API. Supports:
 * - sensitive fields → password input with visibility toggle
 * - advanced fields → collapsed by default
 * - enum → select dropdown
 * - boolean → toggle switch
 * - number/integer → number input
 * - string → text input (or textarea for long content)
 * - object/array → nested collapsible sections
 */

export interface UiHint {
  label?: string;
  help?: string;
  tags?: string[];
  group?: string;
  order?: number;
  advanced?: boolean;
  sensitive?: boolean;
  placeholder?: string;
}

export type UiHints = Record<string, UiHint>;

interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  enum?: any[];
  default?: any;
  description?: string;
  items?: JsonSchemaNode;
  additionalProperties?: JsonSchemaNode | boolean;
  minimum?: number;
  maximum?: number;
  oneOf?: JsonSchemaNode[];
  anyOf?: JsonSchemaNode[];
}

interface SchemaFieldProps {
  path: string;
  schema: JsonSchemaNode;
  uiHints: UiHints;
  value: any;
  onChange: (path: string[], value: any) => void;
  onDelete?: (path: string[]) => void;
  errors?: Record<string, string>;
  depth?: number;
}

const inputBase = 'h-9 md:h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-[12px] md:text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-600';
const labelBase = 'text-[11px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 select-none';

function resolveType(schema: JsonSchemaNode): string {
  if (schema.enum) return 'enum';
  const t = schema.type;
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) {
    const filtered = t.filter(x => x !== 'null');
    return filtered[0] || 'string';
  }
  if (schema.properties) return 'object';
  if (schema.oneOf || schema.anyOf) return 'string';
  return 'string';
}

function pathToArray(path: string): string[] {
  return path ? path.split('.') : [];
}

const SchemaField: React.FC<SchemaFieldProps> = ({ path, schema, uiHints, value, onChange, onDelete, errors, depth = 0 }) => {
  const hint = uiHints[path] || {};
  const label = hint.label || path.split('.').pop() || path;
  const help = hint.help || schema.description;
  const placeholder = hint.placeholder || '';
  const isSensitive = hint.sensitive === true;
  const isAdvanced = hint.advanced === true;
  const error = errors?.[path];
  const fieldType = resolveType(schema);

  const [collapsed, setCollapsed] = useState(isAdvanced);
  const [showPassword, setShowPassword] = useState(false);

  const pathArr = useMemo(() => pathToArray(path), [path]);

  if (isAdvanced && depth === 0) {
    return (
      <div className="border border-slate-200/60 dark:border-white/[0.06] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-white/[0.02] hover:bg-slate-100 dark:hover:bg-white/[0.04] transition-colors"
        >
          <span className={`${labelBase} flex items-center gap-1`}>
            <span className="material-symbols-outlined text-[14px] text-slate-400">tune</span>
            {label}
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-white/40 font-bold uppercase">advanced</span>
          </span>
          <span className="material-symbols-outlined text-[16px] text-slate-400">{collapsed ? 'expand_more' : 'expand_less'}</span>
        </button>
        {!collapsed && (
          <div className="px-3 py-2">
            <SchemaFieldInner
              path={path} schema={schema} uiHints={uiHints} value={value}
              onChange={onChange} onDelete={onDelete} errors={errors}
              label={label} help={help} placeholder={placeholder}
              isSensitive={isSensitive} fieldType={fieldType} error={error}
              showPassword={showPassword} setShowPassword={setShowPassword}
              pathArr={pathArr} depth={depth}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <SchemaFieldInner
      path={path} schema={schema} uiHints={uiHints} value={value}
      onChange={onChange} onDelete={onDelete} errors={errors}
      label={label} help={help} placeholder={placeholder}
      isSensitive={isSensitive} fieldType={fieldType} error={error}
      showPassword={showPassword} setShowPassword={setShowPassword}
      pathArr={pathArr} depth={depth}
    />
  );
};

interface SchemaFieldInnerProps {
  path: string;
  schema: JsonSchemaNode;
  uiHints: UiHints;
  value: any;
  onChange: (path: string[], value: any) => void;
  onDelete?: (path: string[]) => void;
  errors?: Record<string, string>;
  label: string;
  help?: string;
  placeholder: string;
  isSensitive: boolean;
  fieldType: string;
  error?: string;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  pathArr: string[];
  depth: number;
}

const SchemaFieldInner: React.FC<SchemaFieldInnerProps> = ({
  path, schema, uiHints, value, onChange, onDelete, errors,
  label, help, placeholder, isSensitive, fieldType, error,
  showPassword, setShowPassword, pathArr, depth,
}) => {
  // Object type: render nested fields
  if (fieldType === 'object' && schema.properties) {
    const entries = Object.entries(schema.properties).sort((a, b) => {
      const ha = uiHints[`${path}.${a[0]}`]?.order ?? 999;
      const hb = uiHints[`${path}.${b[0]}`]?.order ?? 999;
      return ha - hb;
    });

    return (
      <div className={depth > 0 ? 'pl-3 border-l-2 border-slate-200 dark:border-white/10 space-y-2 mt-1' : 'space-y-2'}>
        {entries.map(([key, subSchema]) => (
          <SchemaField
            key={`${path}.${key}`}
            path={`${path}.${key}`}
            schema={subSchema}
            uiHints={uiHints}
            value={value?.[key]}
            onChange={onChange}
            onDelete={onDelete}
            errors={errors}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  // Enum: select dropdown
  if (fieldType === 'enum' && schema.enum) {
    const options = schema.enum.map(v => ({ value: String(v), label: String(v) }));
    return (
      <div className="flex flex-col md:grid md:grid-cols-12 md:items-start gap-2 md:gap-3 py-1.5">
        <div className="md:col-span-4 lg:col-span-5 flex flex-col">
          <label className={labelBase}>{label}</label>
          {help && <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{help}</span>}
        </div>
        <div className="md:col-span-8 lg:col-span-7">
          <CustomSelect
            value={String(value ?? schema.default ?? '')}
            onChange={v => onChange(pathArr, v)}
            options={[{ value: '', label: '-' }, ...options]}
            className={`${inputBase} w-full md:w-64`}
          />
          {error && <span className="text-[11px] text-red-500 mt-0.5">{error}</span>}
        </div>
      </div>
    );
  }

  // Boolean: toggle switch
  if (fieldType === 'boolean') {
    const checked = value === true;
    return (
      <div className="flex flex-col md:grid md:grid-cols-12 md:items-center gap-2 md:gap-3 py-1.5">
        <div className="md:col-span-4 lg:col-span-5 flex flex-col">
          <label className={labelBase}>{label}</label>
          {help && <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{help}</span>}
        </div>
        <div className="md:col-span-8 lg:col-span-7">
          <button
            type="button"
            onClick={() => onChange(pathArr, !checked)}
            className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${checked ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-600'}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </div>
    );
  }

  // Number/integer
  if (fieldType === 'number' || fieldType === 'integer') {
    return (
      <div className="flex flex-col md:grid md:grid-cols-12 md:items-start gap-2 md:gap-3 py-1.5">
        <div className="md:col-span-4 lg:col-span-5 flex flex-col">
          <label className={labelBase}>{label}</label>
          {help && <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{help}</span>}
        </div>
        <div className="md:col-span-8 lg:col-span-7 flex flex-col gap-1">
          <input
            type="number"
            value={value ?? ''}
            onChange={e => {
              const v = e.target.value;
              onChange(pathArr, v === '' ? undefined : Number(v));
            }}
            min={schema.minimum}
            max={schema.maximum}
            step={fieldType === 'integer' ? 1 : undefined}
            placeholder={placeholder}
            className={`${inputBase} w-full md:w-40 ${error ? 'border-red-400 dark:border-red-500' : ''}`}
          />
          {error && <span className="text-[11px] text-red-500">{error}</span>}
        </div>
      </div>
    );
  }

  // Sensitive string: password field with toggle
  if (isSensitive) {
    return (
      <div className="flex flex-col md:grid md:grid-cols-12 md:items-start gap-2 md:gap-3 py-1.5">
        <div className="md:col-span-4 lg:col-span-5 flex flex-col">
          <label className={labelBase}>{label}</label>
          {help && <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{help}</span>}
        </div>
        <div className="md:col-span-8 lg:col-span-7 flex flex-col gap-1">
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={value ?? ''}
              onChange={e => onChange(pathArr, e.target.value)}
              placeholder={placeholder}
              className={`${inputBase} w-full pr-9 ${error ? 'border-red-400 dark:border-red-500' : ''}`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white/60 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">{showPassword ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
          {error && <span className="text-[11px] text-red-500">{error}</span>}
        </div>
      </div>
    );
  }

  // Default: string text input
  return (
    <div className="flex flex-col md:grid md:grid-cols-12 md:items-start gap-2 md:gap-3 py-1.5">
      <div className="md:col-span-4 lg:col-span-5 flex flex-col">
        <label className={labelBase}>{label}</label>
        {help && <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{help}</span>}
      </div>
      <div className="md:col-span-8 lg:col-span-7 flex flex-col gap-1">
        <input
          type="text"
          value={value ?? ''}
          onChange={e => onChange(pathArr, e.target.value)}
          placeholder={placeholder}
          className={`${inputBase} w-full ${error ? 'border-red-400 dark:border-red-500' : ''}`}
        />
        {error && <span className="text-[11px] text-red-500">{error}</span>}
      </div>
    </div>
  );
};

export default SchemaField;

/**
 * SchemaSection — Renders a top-level config section from schema.
 * Groups fields by schema group + sorts by order from uiHints.
 */
export interface SchemaSectionProps {
  sectionKey: string;
  schema: JsonSchemaNode;
  uiHints: UiHints;
  config: Record<string, any> | null;
  onChange: (path: string[], value: any) => void;
  onDelete?: (path: string[]) => void;
  errors?: Record<string, string>;
  showAdvanced?: boolean;
}

export const SchemaSection: React.FC<SchemaSectionProps> = ({
  sectionKey, schema, uiHints, config, onChange, onDelete, errors, showAdvanced = false,
}) => {
  const [advancedVisible, setAdvancedVisible] = useState(showAdvanced);

  const sectionSchema = schema.properties?.[sectionKey];
  if (!sectionSchema?.properties) return null;

  const entries = Object.entries(sectionSchema.properties).sort((a, b) => {
    const ha = uiHints[`${sectionKey}.${a[0]}`]?.order ?? 999;
    const hb = uiHints[`${sectionKey}.${b[0]}`]?.order ?? 999;
    return ha - hb;
  });

  const regularFields = entries.filter(([key]) => !uiHints[`${sectionKey}.${key}`]?.advanced);
  const advancedFields = entries.filter(([key]) => uiHints[`${sectionKey}.${key}`]?.advanced);

  const sectionValue = config?.[sectionKey] || {};

  return (
    <div className="space-y-1">
      {regularFields.map(([key, subSchema]) => (
        <SchemaField
          key={`${sectionKey}.${key}`}
          path={`${sectionKey}.${key}`}
          schema={subSchema}
          uiHints={uiHints}
          value={sectionValue[key]}
          onChange={onChange}
          onDelete={onDelete}
          errors={errors}
        />
      ))}
      {advancedFields.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setAdvancedVisible(v => !v)}
            className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 dark:text-white/40 hover:text-primary transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">{advancedVisible ? 'expand_less' : 'expand_more'}</span>
            <span>{advancedVisible ? 'Hide' : 'Show'} advanced ({advancedFields.length})</span>
          </button>
          {advancedVisible && (
            <div className="mt-2 space-y-1 rounded-lg border border-dashed border-slate-200 dark:border-white/10 p-3 bg-slate-50/50 dark:bg-white/[0.01]">
              {advancedFields.map(([key, subSchema]) => (
                <SchemaField
                  key={`${sectionKey}.${key}`}
                  path={`${sectionKey}.${key}`}
                  schema={subSchema}
                  uiHints={uiHints}
                  value={sectionValue[key]}
                  onChange={onChange}
                  onDelete={onDelete}
                  errors={errors}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
