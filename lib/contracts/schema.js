import { createRequire } from 'node:module';
import path from 'node:path';
import { losslessSanitize } from './lossless.js';

async function resolveSchema() {
  for (const base of [null, process.env.DSH_INSTALL_DIR, process.env.DSH_PROFILE_DIR, process.cwd()]) {
    for (const spec of ['@deepseek-ai/schemastery', 'schemastery']) {
      try {
        const mod = base ? createRequire(path.join(base, 'package.json'))(spec) : await import(spec);
        const schema = mod.default || mod.Schema || mod;
        if (typeof schema.object === 'function') return { schema, via: base || spec };
      } catch { /* Standalone tests need no installed DSH packages. */ }
    }
  }
  return { schema: null, via: 'standalone' };
}
const resolved = await resolveSchema();
export const z = resolved.schema;
export const schemaDiagnostic = Object.freeze({ available: Boolean(z), schemaVia: resolved.via });

// Tool parameters are JSON Schema, not the Host's configuration Schema functions.
function node(json, optional = false) {
  const fn = (value) => validate(json, value);
  fn.json = json;
  fn.isOptional = optional;
  fn.description = (description) => node({ ...json, description }, optional);
  fn.default = (value) => node({ ...json, default: value }, true);
  fn.optional = () => node(json, true);
  fn.min = (minimum) => node({ ...json, minimum }, optional);
  fn.max = (maximum) => node({ ...json, maximum }, optional);
  return fn;
}
export const zSafe = {
  string: () => node({ type: 'string' }),
  number: () => node({ type: 'number' }),
  natural: () => node({ type: 'integer', minimum: 0 }),
  boolean: () => node({ type: 'boolean' }),
  any: () => node({}),
  literal: (value) => node({ const: value }),
  array: (item) => node({ type: 'array', items: item.json }),
  union: (items) => node({ anyOf: items.map((item) => item.json) }),
  object: (shape) => node({
    type: 'object',
    properties: Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, value.json])),
    required: Object.entries(shape).filter(([, value]) => !value.isOptional).map(([key]) => key),
    additionalProperties: false,
  }),
};

function validate(schema, input, label = 'arguments') {
  if (input === undefined && Object.hasOwn(schema, 'default')) return structuredClone(schema.default);
  if (schema.anyOf) {
    for (const option of schema.anyOf) {
      try { return validate(option, input, label); } catch { /* Try the next alternative. */ }
    }
    throw new Error(`${label}: value is not one of the allowed alternatives`);
  }
  if (Object.hasOwn(schema, 'const') && input !== schema.const) throw new Error(`${label}: expected ${schema.const}`);
  if (schema.type === 'object') {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${label}: expected object`);
    const output = {};
    for (const key of Object.keys(input)) {
      if (!Object.hasOwn(schema.properties, key)) throw new Error(`${label}: unknown property ${key}`);
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      if (input[key] !== undefined || Object.hasOwn(child, 'default')) output[key] = validate(child, input[key], `${label}.${key}`);
      else if (schema.required.includes(key)) throw new Error(`${label}.${key}: required`);
    }
    return output;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(input)) throw new Error(`${label}: expected array`);
    return input.map((value, index) => validate(schema.items, value, `${label}[${index}]`));
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof input !== 'number' || !Number.isFinite(input) || (schema.type === 'integer' && !Number.isInteger(input))) throw new Error(`${label}: expected finite ${schema.type}`);
    if (input < schema.minimum || input > schema.maximum) throw new Error(`${label}: out of range`);
  } else if (schema.type && typeof input !== schema.type) throw new Error(`${label}: expected ${schema.type}`);
  return input;
}

export function buildToolRegistration(spec) {
  const parameters = spec.parameters.json;
  if (!parameters) throw new Error(`Missing JSON Schema for ${spec.name}`);
  return {
    name: spec.name,
    description: spec.description,
    parameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(losslessSanitize(value), null, 2) }],
    },
    async execute(args, execution) {
      const normalized = validate(parameters, args || {});
      return losslessSanitize(await spec.execute(normalized, execution));
    },
  };
}
