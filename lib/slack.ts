/**
 * Slack Notification Service
 * Simple client for sending inventory-related messages to Slack
 */

import { WebClient } from '@slack/web-api';

export class SlackService {
  private client: WebClient;
  private channelId: string;

  constructor() {
    const token = process.env.SLACK_BOT_TOKEN;
    const channelId = process.env.SLACK_CHANNEL_ID;

    if (!token || !channelId) {
      throw new Error('Missing Slack credentials');
    }

    this.client = new WebClient(token);
    this.channelId = channelId;
  }

  /**
   * Send a simple text message
   */
  async sendMessage(text: string): Promise<void> {
    await this.client.chat.postMessage({
      channel: this.channelId,
      text,
    });
  }

  /**
   * Send a formatted block message
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async sendBlocks(text: string, blocks: any[]): Promise<void> {
    await this.client.chat.postMessage({
      channel: this.channelId,
      text, // Fallback text
      blocks,
    });
  }

  /**
   * Send a low stock alert
   */
  async sendLowStockAlert(data: {
    date: string;
    lowStockItems: Array<{ sku: string; quantity: number; threshold: number }>;
  }): Promise<void> {
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `⚠️ Low Stock Alert - ${data.date}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${data.lowStockItems.length} items are below threshold:*`,
        },
      },
      ...data.lowStockItems.slice(0, 10).map(item => ({
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*SKU:*\n${item.sku}`,
          },
          {
            type: 'mrkdwn',
            text: `*Qty:* ${item.quantity} / ${item.threshold}`,
          },
        ],
      })),
    ];

    if (data.lowStockItems.length > 10) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `_...and ${data.lowStockItems.length - 10} more items_`,
        },
        fields: [],
      });
    }

    await this.sendBlocks(
      `Low Stock Alert - ${data.date}: ${data.lowStockItems.length} items below threshold`,
      blocks
    );
  }

  /**
   * Send an inventory summary
   */
  async sendInventorySummary(data: {
    date: string;
    totalSKUs: number;
    totalUnits: number;
    lowStockCount: number;
    outOfStockCount: number;
  }): Promise<void> {
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `📦 Inventory Summary - ${data.date}`,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Total SKUs:*\n${data.totalSKUs.toLocaleString()}`,
          },
          {
            type: 'mrkdwn',
            text: `*Total Units:*\n${data.totalUnits.toLocaleString()}`,
          },
        ],
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Low Stock:*\n${data.lowStockCount} items`,
          },
          {
            type: 'mrkdwn',
            text: `*Out of Stock:*\n${data.outOfStockCount} items`,
          },
        ],
      },
    ];

    await this.sendBlocks(
      `Inventory Summary - ${data.date}: ${data.totalUnits.toLocaleString()} units across ${data.totalSKUs.toLocaleString()} SKUs`,
      blocks
    );
  }
}
