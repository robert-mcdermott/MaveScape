// A checker for the subset of JSON Schema (draft 2020-12) that MaveScape's schemas use, for the
// validation suites: every design MaveScape writes or ships must satisfy docs/schemas/*.json as
// well as validateDesign, so the two cannot drift apart. Supported: $ref (local #/$defs/…), type,
// enum, const, required, properties, additionalProperties (false), items, minItems, minimum,
// minLength, pattern, anyOf. Anything else in a schema is reported, not ignored.

const KNOWN = new Set(['$schema', '$id', '$ref', '$defs', 'title', 'description', 'type', 'enum', 'const', 'required', 'properties', 'additionalProperties', 'items', 'minItems', 'minimum', 'minLength', 'pattern', 'anyOf']);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

// Returns a list of problems, each "path: message"; empty when the value satisfies the schema.
export function checkSchema(schema, value, root = schema, path = '$') {
  const problems = [];
  for (const key of Object.keys(schema)) if (!KNOWN.has(key)) problems.push(`${path}: the schema uses "${key}", which this checker does not support`);
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, '').split('/').reduce((node, part) => node?.[part], root);
    if (!target) return [`${path}: unresolved $ref ${schema.$ref}`];
    return problems.concat(checkSchema(target, value, root, path));
  }
  if (schema.type) {
    const types = [].concat(schema.type);
    const actual = typeOf(value);
    if (!types.some((t) => t === actual || (t === 'number' && actual === 'integer'))) return [...problems, `${path}: expected ${types.join(' or ')}, got ${actual}`];
  }
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) problems.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) problems.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  if (schema.anyOf && !schema.anyOf.some((option) => checkSchema(option, value, root, path).length === 0)) problems.push(`${path}: matches none of the allowed forms`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) problems.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) problems.push(`${path}: does not match ${schema.pattern}`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) problems.push(`${path}: below ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((item, i) => problems.push(...checkSchema(schema.items, item, root, `${path}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) problems.push(`${path}: missing "${key}"`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) problems.push(...checkSchema(schema.properties[key], item, root, `${path}.${key}`));
      else if (schema.additionalProperties === false) problems.push(`${path}: unexpected property "${key}"`);
    }
  }
  return problems;
}
