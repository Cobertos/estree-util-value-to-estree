import { Expression } from 'estree';
import isPlainObject = require('is-plain-obj');

// https://github.com/DefinitelyTyped/DefinitelyTyped/issues/34960#issuecomment-576906058
declare const URL: typeof globalThis extends { URL: infer URLCtor }
  ? URLCtor
  : typeof import('url').URL;
declare const URLSearchParams: typeof globalThis extends { URL: infer URLSearchParamsCtor }
  ? URLSearchParamsCtor
  : typeof import('url').URLSearchParams;

/**
 * A value that can be serialized by `estree-util-from-value`.
 */
export type Value =
  | BigInt64Array
  | BigUint64Array
  | Date
  | Float32Array
  | Float64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | RegExp
  | Uint8Array
  | Uint8ClampedArray
  | Uint16Array
  | Uint32Array
  | URL
  | URLSearchParams
  | Value[]
  | ValueMap
  | ValueSet
  | bigint
  | boolean
  | number
  | string
  | symbol
  // eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
  | { [key: string]: Value }
  | null
  | undefined;

type ValueSet = Set<Value>;
type ValueMap = Map<Value, Value>;

export interface Options {
  instanceAsObject?: boolean;
}

/**
 * Convert a value to an ESTree node
 *
 * @param value - The value to convert
 * @param options - Additional options to configure the output.
 * @returns The ESTree node.
 */
export function valueToEstree(value?: unknown, options: Options = {}): Expression {
  if (value === undefined) {
    return { type: 'Identifier', name: 'undefined' };
  }
  if (value == null) {
    return { type: 'Literal', value: null, raw: 'null' };
  }
  if (value === Number.POSITIVE_INFINITY) {
    return { type: 'Identifier', name: 'Infinity' };
  }
  if (Number.isNaN(value)) {
    return { type: 'Identifier', name: 'NaN' };
  }
  if (typeof value === 'boolean') {
    return { type: 'Literal', value, raw: String(value) };
  }
  if (typeof value === 'bigint') {
    return value >= 0
      ? { type: 'Literal', value, raw: `${value}n`, bigint: String(value) }
      : {
          type: 'UnaryExpression',
          operator: '-',
          prefix: true,
          argument: valueToEstree(-value, options),
        };
  }
  if (typeof value === 'number') {
    return value >= 0
      ? { type: 'Literal', value, raw: String(value) }
      : {
          type: 'UnaryExpression',
          operator: '-',
          prefix: true,
          argument: valueToEstree(-value, options),
        };
  }
  if (typeof value === 'string') {
    return { type: 'Literal', value, raw: JSON.stringify(value) };
  }
  if (typeof value === 'symbol') {
    if (value.description && value === Symbol.for(value.description)) {
      return {
        type: 'CallExpression',
        optional: false,
        callee: {
          type: 'MemberExpression',
          computed: false,
          optional: false,
          object: { type: 'Identifier', name: 'Symbol' },
          property: { type: 'Identifier', name: 'for' },
        },
        arguments: [valueToEstree(value.description, options)],
      };
    }
    throw new TypeError(`Only global symbols are supported, got: ${String(value)}`);
  }
  if (Array.isArray(value)) {
    const elements: (Expression | null)[] = [];
    for (let i = 0; i < value.length; i += 1) {
      elements.push(i in value ? valueToEstree(value[i], options) : null);
    }
    return { type: 'ArrayExpression', elements };
  }
  if (value instanceof RegExp) {
    return {
      type: 'Literal',
      value,
      raw: String(value),
      regex: { pattern: value.source, flags: value.flags },
    };
  }
  if (value instanceof Date) {
    return {
      type: 'NewExpression',
      callee: { type: 'Identifier', name: 'Date' },
      arguments: [valueToEstree(value.getTime(), options)],
    };
  }
  if (value instanceof Map) {
    return {
      type: 'NewExpression',
      callee: { type: 'Identifier', name: 'Map' },
      arguments: [valueToEstree([...value.entries()], options)],
    };
  }
  if (
    value instanceof BigInt64Array ||
    value instanceof BigUint64Array ||
    value instanceof Float32Array ||
    value instanceof Float64Array ||
    value instanceof Int8Array ||
    value instanceof Int16Array ||
    value instanceof Int32Array ||
    value instanceof Set ||
    value instanceof Uint8Array ||
    value instanceof Uint8ClampedArray ||
    value instanceof Uint16Array ||
    value instanceof Uint32Array
  ) {
    return {
      type: 'NewExpression',
      callee: { type: 'Identifier', name: value.constructor.name },
      arguments: [valueToEstree([...value], options)],
    };
  }
  if (value instanceof URL || value instanceof URLSearchParams) {
    return {
      type: 'NewExpression',
      callee: { type: 'Identifier', name: value.constructor.name },
      arguments: [valueToEstree(String(value), options)],
    };
  }
  if (options.instanceAsObject || isPlainObject(value)) {
    return {
      type: 'ObjectExpression',
      // @ts-expect-error: looks like an object.
      properties: Object.entries(value).map(([name, val]) => ({
        type: 'Property',
        method: false,
        shorthand: false,
        computed: false,
        kind: 'init',
        key: valueToEstree(name, options),
        value: valueToEstree(val, options),
      })),
    };
  }

  throw new TypeError(`Unsupported value: ${String(value)}`);
}
