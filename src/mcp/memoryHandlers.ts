/**
 * Memory Handlers for MCP Server
 *
 * Database-backed memory operations that persist across Railway deploys.
 * Ports logic from Python life_write.py to TypeScript.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

export interface MemoryReadInput {
  type: string;
  path?: string;
  query?: string;
}

export interface MemoryWriteInput {
  type: string;
  operation: 'set' | 'merge' | 'append' | 'remove';
  path?: string;
  value?: unknown;
  markdown?: string;
}

/**
 * Generate a short unique ID (8 characters)
 */
function generateId(): string {
  return randomUUID().substring(0, 8);
}

/**
 * Get value at a dot-notation path
 */
function getNestedValue(data: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = data;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

/**
 * Set a value in nested object using dot notation path
 */
function setNestedValue(
  data: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  if (!path) {
    if (typeof value === 'object' && value !== null) {
      return value as Record<string, unknown>;
    }
    throw new Error('Cannot set non-object value without path');
  }

  const result = structuredClone(data);
  const keys = path.split('.');
  let current = result;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
  return result;
}

/**
 * Deep merge update into base object
 */
function deepMerge(
  base: Record<string, unknown>,
  update: Record<string, unknown>
): Record<string, unknown> {
  const result = structuredClone(base);

  for (const [key, value] of Object.entries(update)) {
    if (
      key in result &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(result[key]) &&
      !Array.isArray(value)
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      result[key] = structuredClone(value);
    }
  }

  return result;
}

/**
 * Append value to array at path (with dedup by id)
 */
function appendToArray(
  data: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const result = structuredClone(data);
  const keys = path.split('.');
  let current = result;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const finalKey = keys[keys.length - 1];
  if (!(finalKey in current)) {
    current[finalKey] = [];
  }

  const array = current[finalKey];
  if (!Array.isArray(array)) {
    throw new Error(`Path ${path} is not an array`);
  }

  // Check for duplicates by id if value has an id
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const valueId = (value as Record<string, unknown>).id;
    for (let i = 0; i < array.length; i++) {
      const item = array[i];
      if (typeof item === 'object' && item !== null && (item as Record<string, unknown>).id === valueId) {
        // Update existing item instead of appending
        array[i] = value;
        return result;
      }
    }
  }

  array.push(value);
  return result;
}

/**
 * Remove item from array at path (by index or id match)
 */
function removeFromArray(
  data: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const result = structuredClone(data);
  const keys = path.split('.');
  let current = result;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current)) {
      throw new Error(`Path ${path} not found`);
    }
    current = current[key] as Record<string, unknown>;
  }

  const finalKey = keys[keys.length - 1];
  const array = current[finalKey];
  if (!Array.isArray(array)) {
    throw new Error(`Path ${path} is not an array`);
  }

  if (typeof value === 'number') {
    // Remove by index
    if (value >= 0 && value < array.length) {
      array.splice(value, 1);
    }
  } else if (typeof value === 'object' && value !== null && 'id' in value) {
    // Remove by id match
    const valueId = (value as Record<string, unknown>).id;
    current[finalKey] = array.filter(
      (item) => !(typeof item === 'object' && item !== null && (item as Record<string, unknown>).id === valueId)
    );
  } else {
    // Remove by value match
    current[finalKey] = array.filter((item) => item !== value);
  }

  return result;
}

/**
 * Handle memory_read tool call
 */
export async function handleMemoryRead(
  args: Record<string, unknown>,
  tenantId: string,
  prisma: PrismaClient
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  try {
    const input: MemoryReadInput = {
      type: args.type as string,
      path: args.path as string | undefined,
      query: args.query as string | undefined,
    };

    if (!input.type) {
      return {
        content: [{ type: 'text', text: 'Error: Missing required field: type' }],
        isError: true,
      };
    }

    const memory = await prisma.tenant_memories.findUnique({
      where: {
        tenant_id_memory_type: {
          tenant_id: tenantId,
          memory_type: input.type,
        },
      },
    });

    if (!memory) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'not_found', type: input.type, data: {} }) }],
      };
    }

    const data = memory.data as Record<string, unknown>;

    // If path specified, get nested value
    if (input.path) {
      const value = getNestedValue(data, input.path);
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'success', type: input.type, path: input.path, value }) }],
      };
    }

    // If query specified, search in data
    if (input.query) {
      const query = input.query.toLowerCase();
      const matches: string[] = [];

      // Search in JSON data
      const searchJson = (obj: unknown, path: string): void => {
        if (typeof obj === 'string' && obj.toLowerCase().includes(query)) {
          matches.push(path);
        } else if (Array.isArray(obj)) {
          obj.forEach((item, i) => searchJson(item, `${path}[${i}]`));
        } else if (typeof obj === 'object' && obj !== null) {
          for (const [key, value] of Object.entries(obj)) {
            searchJson(value, path ? `${path}.${key}` : key);
          }
        }
      };
      searchJson(data, '');

      // Search in markdown
      if (memory.markdown.toLowerCase().includes(query)) {
        matches.push('markdown');
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'success', type: input.type, query: input.query, matches, data, markdown: memory.markdown }) }],
      };
    }

    // Return full data
    return {
      content: [{ type: 'text', text: JSON.stringify({ status: 'success', type: input.type, data, markdown: memory.markdown, version: memory.version }) }],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${errorMsg}` }],
      isError: true,
    };
  }
}

/**
 * Handle memory_write tool call
 */
export async function handleMemoryWrite(
  args: Record<string, unknown>,
  tenantId: string,
  prisma: PrismaClient
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  try {
    const input: MemoryWriteInput = {
      type: args.type as string,
      operation: args.operation as 'set' | 'merge' | 'append' | 'remove',
      path: args.path as string | undefined,
      value: args.value,
      markdown: args.markdown as string | undefined,
    };

    if (!input.type) {
      return {
        content: [{ type: 'text', text: 'Error: Missing required field: type' }],
        isError: true,
      };
    }

    if (!input.operation || !['set', 'merge', 'append', 'remove'].includes(input.operation)) {
      return {
        content: [{ type: 'text', text: 'Error: Invalid operation. Must be set, merge, append, or remove' }],
        isError: true,
      };
    }

    // Get existing memory or create default
    const existing = await prisma.tenant_memories.findUnique({
      where: {
        tenant_id_memory_type: {
          tenant_id: tenantId,
          memory_type: input.type,
        },
      },
    });

    let data: Record<string, unknown> = existing?.data as Record<string, unknown> ?? {};
    let markdown = existing?.markdown ?? '';
    const version = existing?.version ?? 1;

    // Apply operation
    switch (input.operation) {
      case 'set':
        if (input.path) {
          data = setNestedValue(data, input.path, input.value);
        } else if (typeof input.value === 'object' && input.value !== null) {
          data = input.value as Record<string, unknown>;
        } else {
          return {
            content: [{ type: 'text', text: 'Error: set operation requires object value when no path specified' }],
            isError: true,
          };
        }
        break;

      case 'merge':
        if (typeof input.value === 'object' && input.value !== null) {
          if (input.path) {
            const existingValue = getNestedValue(data, input.path);
            if (typeof existingValue === 'object' && existingValue !== null && !Array.isArray(existingValue)) {
              const merged = deepMerge(existingValue as Record<string, unknown>, input.value as Record<string, unknown>);
              data = setNestedValue(data, input.path, merged);
            } else {
              data = setNestedValue(data, input.path, input.value);
            }
          } else {
            data = deepMerge(data, input.value as Record<string, unknown>);
          }
        }
        break;

      case 'append':
        if (!input.path) {
          return {
            content: [{ type: 'text', text: 'Error: append operation requires path to array' }],
            isError: true,
          };
        }
        if (input.value === undefined || input.value === null) {
          return {
            content: [{ type: 'text', text: 'Error: append operation requires value' }],
            isError: true,
          };
        }
        {
          // Auto-generate ID if value is object without id
          let valueToAppend = input.value;
          if (typeof valueToAppend === 'object' && valueToAppend !== null && !('id' in valueToAppend)) {
            valueToAppend = { ...valueToAppend, id: generateId() };
          }
          data = appendToArray(data, input.path, valueToAppend);
          break;
        }

      case 'remove':
        if (!input.path) {
          return {
            content: [{ type: 'text', text: 'Error: remove operation requires path to array' }],
            isError: true,
          };
        }
        if (input.value === undefined || input.value === null) {
          return {
            content: [{ type: 'text', text: 'Error: remove operation requires value (item or index)' }],
            isError: true,
          };
        }
        data = removeFromArray(data, input.path, input.value);
        break;
    }

    // Update lastUpdated timestamp
    data.lastUpdated = new Date().toISOString();

    // Append markdown if provided
    if (input.markdown) {
      if (markdown && !markdown.endsWith('\n')) {
        markdown += '\n';
      }
      markdown += `\n${input.markdown}\n`;
    }

    // Upsert to database
    const result = await prisma.tenant_memories.upsert({
      where: {
        tenant_id_memory_type: {
          tenant_id: tenantId,
          memory_type: input.type,
        },
      },
      update: {
        data: data as Prisma.InputJsonValue,
        markdown,
        version: version + 1,
      },
      create: {
        tenant_id: tenantId,
        memory_type: input.type,
        data: data as Prisma.InputJsonValue,
        markdown,
        version: 1,
      },
    });

    return {
      content: [{ type: 'text', text: JSON.stringify({
        status: 'success',
        type: input.type,
        operation: input.operation,
        message: `Updated ${input.type} successfully`,
        data,
        version: result.version,
      }) }],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${errorMsg}` }],
      isError: true,
    };
  }
}
