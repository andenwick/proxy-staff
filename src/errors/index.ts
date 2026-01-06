/**
 * Custom error classes for categorized error handling.
 */

function createErrorClass(name: string) {
  return class extends Error {
    constructor(message: string) {
      super(message);
      this.name = name;
    }
  };
}

export const ClaudeAPIError = createErrorClass('ClaudeAPIError');
export const ClaudeCliError = createErrorClass('ClaudeCliError');
export const ToolExecutionError = createErrorClass('ToolExecutionError');
export const TenantConfigError = createErrorClass('TenantConfigError');
export const WhatsAppDeliveryError = createErrorClass('WhatsAppDeliveryError');
export const SessionError = createErrorClass('SessionError');
