import {
  type ArrayExpression,
  type Expression,
  type Identifier,
  type MemberExpression,
  type Property,
  type SimpleLiteral,
  type VariableDeclarator
} from 'estree'

/**
 * Create an ESTree identifier node for a given name.
 *
 * @param name
 *   The name of the identifier.
 * @returns
 *   The identifier node.
 */
function identifier(name: string): Identifier {
  return { type: 'Identifier', name }
}

/**
 * Create an ESTree literal node for a given value.
 *
 * @param value
 *   The value for which to create a literal.
 * @returns
 *   The literal node.
 */
function literal(value: SimpleLiteral['value']): SimpleLiteral {
  return { type: 'Literal', value }
}

function memberExpression(object: Expression, property: string): MemberExpression {
  return {
    type: 'MemberExpression',
    computed: false,
    optional: false,
    object,
    property: identifier(property)
  };
}

/**
 * Create an ESTree call expression on an object member.
 *
 * @param object
 *   The object to call the method on.
 * @param property
 *   The name of the method to call.
 * @param args
 *   Arguments to pass to the function call
 * @returns
 *   The call expression node.
 */
function methodCall(object: Expression, property: string, args: Expression[]): Expression {
  return {
    type: 'CallExpression',
    optional: false,
    callee: memberExpression(object, property),
    arguments: args
  }
}

/**
 * Turn a number or bigint into an ESTree expression. This handles positive and negative numbers and
 * bigints as well as special numbers.
 *
 * @param number
 *   The value to turn into an ESTree expression.
 * @returns
 *   An expression that represents the given value.
 */
function processNumber(number: bigint | number): Expression {
  if (number < 0 || Object.is(number, -0)) {
    return {
      type: 'UnaryExpression',
      operator: '-',
      prefix: true,
      argument: processNumber(-number)
    }
  }

  if (typeof number === 'bigint') {
    return { type: 'Literal', bigint: String(number) }
  }

  if (number === Number.POSITIVE_INFINITY || Number.isNaN(number)) {
    return identifier(String(number))
  }

  return literal(number)
}

/**
 * Process an array of numbers. This is a shortcut for iterables whose constructor takes an array of
 * numbers as input.
 *
 * @param numbers
 *   The numbers to add to the array expression.
 * @returns
 *   An ESTree array expression whose elements match the input numbers.
 */
function processNumberArray(numbers: Iterable<bigint | number>): Expression {
  const elements: Expression[] = []

  for (const value of numbers) {
    elements.push(processNumber(value))
  }

  return { type: 'ArrayExpression', elements }
}

/**
 * Check whether a value can be constructed from its string representation.
 *
 * @param value
 *   The value to check
 * @returns
 *   Whether or not the value can be constructed from its string representation.
 */
function isStringReconstructable(value: unknown): value is URL | URLSearchParams {
  return value instanceof URL || value instanceof URLSearchParams
}

/**
 * Check whether a value can be constructed from its `valueOf()` result.
 *
 * @param value
 *   The value to check
 * @returns
 *   Whether or not the value can be constructed from its `valueOf()` result.
 */
// eslint-disable-next-line @typescript-eslint/ban-types
function isValueReconstructable(value: unknown): value is Boolean | Date | Number | String {
  return (
    value instanceof Boolean ||
    value instanceof Date ||
    value instanceof Number ||
    value instanceof String
  )
}

/**
 * Check whether a value is a typed array.
 *
 * @param value
 *   The value to check
 * @returns
 *   Whether or not the value is a typed array.
 */
function isTypedArray(
  value: unknown
): value is
  | BigInt64Array
  | BigUint64Array
  | Float32Array
  | Float64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint8ClampedArray
  | Uint16Array
  | Uint32Array {
  return (
    value instanceof BigInt64Array ||
    value instanceof BigUint64Array ||
    value instanceof Float32Array ||
    value instanceof Float64Array ||
    value instanceof Int8Array ||
    value instanceof Int16Array ||
    value instanceof Int32Array ||
    value instanceof Uint8Array ||
    value instanceof Uint8ClampedArray ||
    value instanceof Uint16Array ||
    value instanceof Uint32Array
  )
}

interface Context {
  /**
   * The assignment expression of the variable.
   */
  assignment?: Expression

  /**
   * The number of references to this value.
   */
  count: number

  /**
   * The variable name used to reference the value.
   */
  name?: string

  /**
   * Whether or not this value recursively references itself.
   */
  recursive: boolean

  /**
   * A set of values that reference the value in this context.
   */
  referencedBy: Set<unknown>

  /**
   * The value this context belongs to.
   */
  value: unknown
}

/**
 * Compare two value contexts for sorting them based on reference count.
 *
 * @param a
 *   The first context to compare.
 * @param b
 *   The second context to compare.
 * @returns
 *   The count of context a minus the count of context b.
 */
function compareContexts(a: Context, b: Context): number {
  const aReferencedByB = a.referencedBy.has(b.value)
  const bReferencedByA = b.referencedBy.has(a.value)

  if (aReferencedByB) {
    if (bReferencedByA) {
      return a.count - b.count
    }
    return -1
  }
  if (bReferencedByA) {
    return 1
  }

  return a.count - b.count
}

export interface Options {
  /**
   * If true, treat objects that have a prototype as plain objects.
   *
   * @default false
   */
  instanceAsObject?: boolean

  /**
   * If true, preserve references to the same object found within the input. This also allows to
   * serialize recursive structures. If needed, the resulting expression will be an iife.
   *
   * @default false
   */
  preserveReferences?: boolean

  /**
   * Called before all generate() options to provide custom generation for certain
   * types
   * 
   * @default undefined
   */
  customGenerate?: (val: unknown, isDeclaration?: boolean) => (Expression | undefined)
}

/**
 * Replace the assigned right hand expression with the new expression.
 *
 * If there is no assignment expression, the original expression is returned. Otherwise the
 * assignment is modified and returned,
 *
 * @param expression
 *   The expression to use for the assignment.
 * @param assignment
 *   The existing assignmentexpression
 * @returns
 *   The new expression.
 */
function replaceAssignment(expression: Expression, assignment: Expression | undefined): Expression {
  if (!assignment || assignment.type !== 'AssignmentExpression') {
    return expression
  }

  let node = assignment
  while (node.right.type === 'AssignmentExpression') {
    node = node.right
  }
  node.right = expression
  return assignment
}

/**
 * Convert a value to an ESTree node.
 *
 * @param value
 *   The value to convert.
 * @param options
 *   Additional options to configure the output.
 * @returns
 *   The ESTree node.
 */
export function valueToEstree(value: unknown, options: Options = {}): Expression {
  const stack: unknown[] = []
  const collectedContexts = new Map<unknown, Context>()
  const namedContexts: Context[] = []

  /**
   * Analyze a value and collect all reference contexts.
   *
   * @param val
   *   The value to analyze.
   */
  function analyze(val: unknown): undefined {
    if (typeof val === 'function') {
      return
      //throw new TypeError(`Unsupported value: ${val}`, { cause: val })
    }

    if (typeof val !== 'object') {
      return
    }

    if (val == null) {
      return
    }

    const context = collectedContexts.get(val)
    if (context) {
      if (options.preserveReferences) {
        context.count += 1
      }
      for (const ancestor of stack) {
        context.referencedBy.add(ancestor)
      }
      if (stack.includes(val)) {
        if (!options.preserveReferences) {
          throw new Error(`Found circular reference: ${val}`, { cause: val })
        }
        const parent = stack.at(-1)!
        const parentContext = collectedContexts.get(parent)!
        parentContext.recursive = true
        context.recursive = true
      }
      return
    }

    collectedContexts.set(val, {
      count: 1,
      recursive: false,
      referencedBy: new Set(stack),
      value: val
    })

    if (isTypedArray(val)) {
      return
    }

    if (isStringReconstructable(val)) {
      return
    }

    if (isValueReconstructable(val)) {
      return
    }

    if (value instanceof RegExp) {
      return
    }

    stack.push(val)
    if (val instanceof Map) {
      for (const pair of val) {
        analyze(pair[0])
        analyze(pair[1])
      }
    } else if (Array.isArray(val) || val instanceof Set) {
      for (const entry of val) {
        analyze(entry)
      }
    } else {
      const proto = Object.getPrototypeOf(val)
      if (proto != null && proto !== Object.prototype && !options.instanceAsObject) {
        return; // dont handle
        //throw new TypeError(`Unsupported value: ${val}`, { cause: val })
      }

      for (const key of Reflect.ownKeys(val)) {
        analyze((val as Record<string | symbol, unknown>)[key])
      }
    }
    stack.pop()
  }

  /**
   * Recursively generate the ESTree expression needed to reconstruct the value.
   *
   * @param val
   *   The value to process.
   * @param isDeclaration
   *   Whether or not this is for a variable declaration.
   * @returns
   *   The ESTree expression to reconstruct the value.
   */
  function generate(val: unknown, isDeclaration?: boolean): Expression {
    if (options.customGenerate) {
      const ret = options.customGenerate(val);
      if (typeof ret === 'object') {
        return ret;
      }
    }

    if (val === undefined) {
      return identifier(String(val))
    }

    if (val == null || typeof val === 'string' || typeof val === 'boolean') {
      return literal(val)
    }

    if (typeof val === 'bigint' || typeof val === 'number') {
      return processNumber(val)
    }

    if (typeof val === 'symbol') {
      if (val.description && val === Symbol.for(val.description)) {
        return methodCall(identifier('Symbol'), 'for', [literal(val.description)])
      }
      const wellKnownSymbols = [
        Symbol.asyncIterator,
        Symbol.hasInstance,
        Symbol.isConcatSpreadable,
        Symbol.iterator,
        Symbol.match,
        Symbol.matchAll,
        Symbol.replace,
        Symbol.search,
        Symbol.species,
        Symbol.split,
        Symbol.toPrimitive,
        Symbol.toStringTag,
        Symbol.unscopables
      ]
      if (val.description && wellKnownSymbols.includes(val)) {
        // Name is Symbol.xxx
        const [_,name] = val.description.split('.');
        return memberExpression(identifier('Symbol'), name);
      }

      throw new TypeError(`Only global symbols are supported, got: ${String(val)}`, { cause: val })
    }

    const context = collectedContexts.get(val)
    if (!isDeclaration && context?.name) {
      return identifier(context.name)
    }

    if (isValueReconstructable(val)) {
      return {
        type: 'NewExpression',
        callee: identifier(val.constructor.name),
        arguments: [generate(val.valueOf())]
      }
    }

    if (val instanceof RegExp) {
      return {
        type: 'Literal',
        regex: { pattern: val.source, flags: val.flags }
      }
    }

    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) {
      return methodCall(identifier('Buffer'), 'from', [processNumberArray(val)])
    }

    if (isTypedArray(val)) {
      return {
        type: 'NewExpression',
        callee: identifier(val.constructor.name),
        arguments: [processNumberArray(val)]
      }
    }

    if (isStringReconstructable(val)) {
      return {
        type: 'NewExpression',
        callee: identifier(val.constructor.name),
        arguments: [literal(String(val))]
      }
    }

    if (Array.isArray(val)) {
      const elements: (Expression | null)[] = Array.from({ length: val.length })
      let trimmable: number | undefined

      for (let index = 0; index < val.length; index += 1) {
        if (!(index in val)) {
          elements[index] = null
          trimmable = undefined
          continue
        }

        const child = val[index]
        const childContext = collectedContexts.get(child)
        if (
          context &&
          childContext &&
          namedContexts.indexOf(childContext) >= namedContexts.indexOf(context)
        ) {
          elements[index] = null
          trimmable ||= index
          childContext.assignment = {
            type: 'AssignmentExpression',
            operator: '=',
            left: {
              type: 'MemberExpression',
              computed: true,
              optional: false,
              object: identifier(context.name!),
              property: literal(index)
            },
            right: childContext.assignment || identifier(childContext.name!)
          }
        } else {
          elements[index] = generate(child)
          trimmable = undefined
        }
      }

      if (trimmable != null) {
        elements.splice(trimmable)
      }

      return {
        type: 'ArrayExpression',
        elements
      }
    }

    if (val instanceof Set) {
      const elements: Expression[] = []
      let finalizer: Expression | undefined

      for (const child of val) {
        if (finalizer) {
          finalizer = methodCall(finalizer, 'add', [generate(child)])
        } else {
          const childContext = collectedContexts.get(child)
          if (
            context &&
            childContext &&
            namedContexts.indexOf(childContext) >= namedContexts.indexOf(context)
          ) {
            finalizer = methodCall(identifier(context.name!), 'add', [generate(child)])
          } else {
            elements.push(generate(child))
          }
        }
      }

      if (context && finalizer) {
        context.assignment = replaceAssignment(finalizer, context.assignment)
      }

      return {
        type: 'NewExpression',
        callee: identifier('Set'),
        arguments: elements.length ? [{ type: 'ArrayExpression', elements }] : []
      }
    }

    if (val instanceof Map) {
      const elements: ArrayExpression[] = []
      let finalizer: Expression | undefined

      for (const [key, item] of val) {
        if (finalizer) {
          finalizer = methodCall(finalizer, 'set', [generate(key), generate(item)])
        } else {
          const keyContext = collectedContexts.get(key)
          const itemContext = collectedContexts.get(item)

          if (
            context &&
            ((keyContext && namedContexts.indexOf(keyContext) >= namedContexts.indexOf(context)) ||
              (itemContext && namedContexts.indexOf(itemContext) >= namedContexts.indexOf(context)))
          ) {
            finalizer = methodCall(identifier(context.name!), 'set', [
              generate(key),
              generate(item)
            ])
          } else {
            elements.push({
              type: 'ArrayExpression',
              elements: [generate(key), generate(item)]
            })
          }
        }
      }

      if (context && finalizer) {
        context.assignment = replaceAssignment(finalizer, context.assignment)
      }

      return {
        type: 'NewExpression',
        callee: identifier('Map'),
        arguments: elements.length ? [{ type: 'ArrayExpression', elements }] : []
      }
    }

    const properties: Property[] = []
    if (Object.getPrototypeOf(val) == null) {
      properties.push({
        type: 'Property',
        method: false,
        shorthand: false,
        computed: false,
        kind: 'init',
        key: identifier('__proto__'),
        value: literal(null)
      })
    }

    const object = val as Record<string | symbol, unknown>
    for (const key of Reflect.ownKeys(val)) {
      const computed = typeof key !== 'string'
      const keyExpression = generate(key)
      const child = object[key]
      const childContext = collectedContexts.get(child)
      if (
        context &&
        childContext &&
        namedContexts.indexOf(childContext) >= namedContexts.indexOf(context)
      ) {
        childContext.assignment = {
          type: 'AssignmentExpression',
          operator: '=',
          left: {
            type: 'MemberExpression',
            computed: true,
            optional: false,
            object: identifier(context.name!),
            property: keyExpression
          },
          right: childContext.assignment || generate(child)
        }
      } else {
        properties.push({
          type: 'Property',
          method: false,
          shorthand: false,
          computed,
          kind: 'init',
          key: keyExpression,
          value: generate(child)
        })
      }
    }

    return {
      type: 'ObjectExpression',
      properties
    }
  }

  analyze(value)

  for (const [val, context] of collectedContexts) {
    if (context.recursive || context.count > 1) {
      // Assign reused or recursive references to a variable.
      context.name = `$${namedContexts.length}`
      namedContexts.push(context)
    } else {
      // Otherwise don’t treat it as a reference.
      collectedContexts.delete(val)
    }
  }

  if (!namedContexts.length) {
    return generate(value)
  }

  const declarations = namedContexts.sort(compareContexts).map<VariableDeclarator>((context) => ({
    type: 'VariableDeclarator',
    id: identifier(context.name!),
    init: generate(context.value, true)
  }))

  const rootContext = collectedContexts.get(value)
  const finalizers: Expression[] = []
  for (const context of collectedContexts.values()) {
    if (context !== rootContext && context.assignment) {
      finalizers.push(context.assignment)
    }
  }
  finalizers.push(
    rootContext ? rootContext.assignment || identifier(rootContext.name!) : generate(value)
  )

  return {
    type: 'CallExpression',
    optional: false,
    arguments: [],
    callee: {
      type: 'ArrowFunctionExpression',
      expression: false,
      params: [],
      body: {
        type: 'BlockStatement',
        body: [
          {
            type: 'VariableDeclaration',
            kind: 'const',
            declarations
          },
          {
            type: 'ReturnStatement',
            argument: {
              type: 'SequenceExpression',
              expressions: finalizers
            }
          }
        ]
      }
    }
  }
}
