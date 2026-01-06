/**
 * Messaging Service Interface
 *
 * Common interface for all messaging channels (WhatsApp, Telegram, etc.)
 */

export type MessagingChannelType = 'whatsapp' | 'telegram';

export interface MessagingService {
  readonly channel: MessagingChannelType;

  /**
   * Send a text message to a recipient
   * @param to - Recipient identifier (phone number for WhatsApp, chat_id for Telegram)
   * @param text - Message content
   * @returns Message ID from the provider
   */
  sendTextMessage(to: string, text: string): Promise<string>;
}

export interface SendMessageResult {
  messageId: string;
  channel: MessagingChannelType;
  timestamp: Date;
}
