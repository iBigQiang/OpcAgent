const OPCAGENT_DISPLAY_NAME_KEY = '_displayName';
const OPCAGENT_INTENT_KEY = '_intent';

const OPCAGENT_DISPLAY_NAME_SCHEMA = {
  type: 'string',
  description: 'OPCAgent UI metadata: human-friendly action name for display only.',
};

const OPCAGENT_INTENT_SCHEMA = {
  type: 'string',
  description: 'OPCAgent UI metadata: concise tool-call intent for display only.',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneWithDescriptors<T extends object>(value: T): T {
  const clone = Object.create(Object.getPrototypeOf(value));
  Object.defineProperties(clone, Object.getOwnPropertyDescriptors(value));
  return clone;
}

/**
 * Return a Pi tool schema that accepts OPCAgent's root-level metadata fields.
 *
 * Pi validates tool arguments before OPCAgent's pre-tool-use hook can strip
 * `_displayName` / `_intent`. Built-in Pi tools often use strict schemas with
 * `additionalProperties: false`, so we add those fields as optional root
 * properties at the adapter boundary. Unknown schema shapes are returned
 * unchanged, and upstream-defined metadata properties win if Pi adds them later.
 */
export function allowOPCAgentMetadataProperties<T>(schema: T): T {
  if (!isRecord(schema)) return schema;

  const properties = schema.properties;
  if (!isRecord(properties)) return schema;

  const nextSchema = cloneWithDescriptors(schema);
  const nextProperties = cloneWithDescriptors(properties);

  if (!(OPCAGENT_DISPLAY_NAME_KEY in nextProperties)) {
    nextProperties[OPCAGENT_DISPLAY_NAME_KEY] = OPCAGENT_DISPLAY_NAME_SCHEMA;
  }
  if (!(OPCAGENT_INTENT_KEY in nextProperties)) {
    nextProperties[OPCAGENT_INTENT_KEY] = OPCAGENT_INTENT_SCHEMA;
  }

  Object.defineProperty(nextSchema, 'properties', {
    value: nextProperties,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return nextSchema as T;
}

/** Strip OPCAgent-only metadata before invoking the upstream Pi tool implementation. */
export function stripOPCAgentMetadata<T>(input: T): T {
  if (!isRecord(input)) return input;
  if (!(OPCAGENT_DISPLAY_NAME_KEY in input) && !(OPCAGENT_INTENT_KEY in input)) return input;

  const cleanInput = { ...input };
  delete cleanInput[OPCAGENT_DISPLAY_NAME_KEY];
  delete cleanInput[OPCAGENT_INTENT_KEY];

  return cleanInput as T;
}
