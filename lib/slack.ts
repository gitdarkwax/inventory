/**
 * Slack Notification Service for Inventory App
 * Sends notifications to configured channels for PO and Transfer events
 */

import { WebClient } from '@slack/web-api';

// Tracking URL patterns for different carriers
const TRACKING_URLS: Record<string, string> = {
  'UPS': 'https://www.ups.com/track?tracknum=',
  'FedEx': 'https://www.fedex.com/fedextrack/?trknbr=',
  'USPS': 'https://tools.usps.com/go/TrackConfirmAction?tLabels=',
  'DHL': 'https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=',
  'Amazon': 'https://www.amazon.com/progress-tracker/package/ref=ppx_yo_dt_b_track_package?itemId=',
  'Other': '',
};

export class SlackService {
  private client: WebClient;
  private channelId: string;

  constructor(channelOverride?: string) {
    const token = process.env.SLACK_BOT_TOKEN;
    const channelId = channelOverride || process.env.SLACK_CHANNEL_TRANSFERS;

    if (!token) {
      throw new Error('Missing SLACK_BOT_TOKEN');
    }

    if (!channelId) {
      throw new Error('Missing SLACK_CHANNEL_TRANSFERS');
    }

    this.client = new WebClient(token);
    this.channelId = channelId;
  }

  /**
   * Get tracking URL for a carrier and tracking number
   */
  private getTrackingUrl(carrier: string | undefined, trackingNumber: string | undefined): string | null {
    if (!trackingNumber) return null;
    const baseUrl = TRACKING_URLS[carrier || 'Other'] || '';
    return baseUrl ? `${baseUrl}${trackingNumber}` : null;
  }

  /**
   * Format SKU/Qty list for Slack
   */
  private formatSkuList(items: Array<{ sku: string; quantity: number }>): string {
    return items.map(item => `• ${item.sku}: ${item.quantity}`).join('\n');
  }

  /**
   * Send notification when a PO is created
   */
  async notifyPOCreated(data: {
    poNumber: string;
    createdBy: string;
    vendor: string;
    eta: string | null;
    items: Array<{ sku: string; quantity: number }>;
  }): Promise<void> {
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `📦 New Production Order Created`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*PO#:* ${data.poNumber}    *Created By:* ${data.createdBy}`,
            `*Vendor:* ${data.vendor || 'N/A'}    *ETA:* ${data.eta || 'Not set'}`,
          ].join('\n'),
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Items:*\n${this.formatSkuList(data.items)}`,
        },
      },
    ];

    await this.client.chat.postMessage({
      channel: this.channelId,
      text: `New PO Created: ${data.poNumber}`,
      blocks,
    });
  }

  /**
   * Send notification when a PO delivery is logged
   */
  async notifyPODelivery(data: {
    poNumber: string;
    status: 'partial' | 'delivered';
    vendor: string;
    receivedBy: string;
    location: string;
    deliveredItems: Array<{ sku: string; quantity: number }>;
    pendingItems?: Array<{ sku: string; quantity: number }>;
  }): Promise<void> {
    const statusEmoji = data.status === 'delivered' ? '✅' : '📬';
    const statusText = data.status === 'delivered' ? 'Fully Delivered' : 'Partial Delivery';

    const blocks: any[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${statusEmoji} PO Delivery Logged`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*PO#:* ${data.poNumber}    *Status:* ${statusText}`,
            `*Vendor:* ${data.vendor || 'N/A'}    *Received By:* ${data.receivedBy}`,
            `*Location:* ${data.location}`,
          ].join('\n'),
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Delivered Items:*\n${this.formatSkuList(data.deliveredItems)}`,
        },
      },
    ];

    // Add pending items if partial delivery
    if (data.status === 'partial' && data.pendingItems && data.pendingItems.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*⏳ Pending Items:*\n${this.formatSkuList(data.pendingItems)}`,
        },
      });
    }

    await this.client.chat.postMessage({
      channel: this.channelId,
      text: `PO Delivery: ${data.poNumber} - ${statusText}`,
      blocks,
    });
  }

  /**
   * Send notification when a Transfer is created
   */
  async notifyTransferCreated(data: {
    transferId: string;
    createdBy: string;
    origin: string;
    destination: string;
    shipmentType: string;
    carrier?: string;
    trackingNumber?: string;
    eta: string | null;
    items: Array<{ sku: string; quantity: number }>;
  }): Promise<void> {
    const trackingUrl = this.getTrackingUrl(data.carrier, data.trackingNumber);
    const trackingText = data.trackingNumber
      ? (trackingUrl ? `<${trackingUrl}|${data.trackingNumber}>` : data.trackingNumber)
      : 'N/A';

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `🚚 New Transfer Created`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*Transfer#:* ${data.transferId}    *Created By:* ${data.createdBy}`,
            `*Origin:* ${data.origin}    *Destination:* ${data.destination}`,
            `*Shipment Type:* ${data.shipmentType}    *ETA:* ${data.eta || 'Not set'}`,
            `*Tracking:* ${trackingText}`,
          ].join('\n'),
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Items:*\n${this.formatSkuList(data.items)}`,
        },
      },
    ];

    await this.client.chat.postMessage({
      channel: this.channelId,
      text: `New Transfer: ${data.transferId} - ${data.origin} → ${data.destination}`,
      blocks,
    });
  }

  /**
   * Send notification when a Transfer delivery is logged
   */
  async notifyTransferDelivery(data: {
    transferId: string;
    status: 'partial' | 'delivered';
    receivedBy: string;
    origin: string;
    destination: string;
    shipmentType: string;
    carrier?: string;
    trackingNumber?: string;
    deliveredItems: Array<{ sku: string; quantity: number }>;
    pendingItems?: Array<{ sku: string; quantity: number }>;
  }): Promise<void> {
    const statusEmoji = data.status === 'delivered' ? '✅' : '📬';
    const statusText = data.status === 'delivered' ? 'Fully Delivered' : 'Partial Delivery';
    const trackingUrl = this.getTrackingUrl(data.carrier, data.trackingNumber);
    const trackingText = data.trackingNumber
      ? (trackingUrl ? `<${trackingUrl}|${data.trackingNumber}>` : data.trackingNumber)
      : 'N/A';

    const blocks: any[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${statusEmoji} Transfer Delivery Logged`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*Transfer#:* ${data.transferId}    *Status:* ${statusText}`,
            `*Received By:* ${data.receivedBy}    *Shipment Type:* ${data.shipmentType}`,
            `*Origin:* ${data.origin}    *Destination:* ${data.destination}`,
            `*Tracking:* ${trackingText}`,
          ].join('\n'),
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Delivered Items:*\n${this.formatSkuList(data.deliveredItems)}`,
        },
      },
    ];

    // Add pending items if partial delivery
    if (data.status === 'partial' && data.pendingItems && data.pendingItems.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*⏳ Pending Items:*\n${this.formatSkuList(data.pendingItems)}`,
        },
      });
    }

    await this.client.chat.postMessage({
      channel: this.channelId,
      text: `Transfer Delivery: ${data.transferId} - ${statusText}`,
      blocks,
    });
  }

  /**
   * Send notification when a PO is cancelled
   */
  async notifyPOCancelled(data: {
    poNumber: string;
    cancelledBy: string;
    vendor: string;
    items: Array<{ sku: string; quantity: number }>;
  }): Promise<void> {
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `❌ Production Order Cancelled`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*PO#:* ${data.poNumber}    *Cancelled By:* ${data.cancelledBy}`,
            `*Vendor:* ${data.vendor || 'N/A'}`,
          ].join('\n'),
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Items:*\n${this.formatSkuList(data.items)}`,
        },
      },
    ];

    await this.client.chat.postMessage({
      channel: this.channelId,
      text: `PO Cancelled: ${data.poNumber}`,
      blocks,
    });
  }

  /**
   * Send notification when a Transfer is cancelled
   */
  async notifyTransferCancelled(data: {
    transferId: string;
    cancelledBy: string;
    origin: string;
    destination: string;
    shipmentType: string;
    items: Array<{ sku: string; quantity: number }>;
  }): Promise<void> {
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `❌ Transfer Cancelled`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*Transfer#:* ${data.transferId}    *Cancelled By:* ${data.cancelledBy}`,
            `*Origin:* ${data.origin}    *Destination:* ${data.destination}`,
            `*Shipment Type:* ${data.shipmentType}`,
          ].join('\n'),
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Items:*\n${this.formatSkuList(data.items)}`,
        },
      },
    ];

    await this.client.chat.postMessage({
      channel: this.channelId,
      text: `Transfer Cancelled: ${data.transferId}`,
      blocks,
    });
  }
}

/**
 * Helper to safely send Slack notification (doesn't throw on failure)
 */
export async function sendSlackNotification(
  notifyFn: () => Promise<void>
): Promise<void> {
  // Check if required env vars exist before attempting
  if (!process.env.SLACK_BOT_TOKEN) {
    console.error('⚠️ SLACK_BOT_TOKEN not set - skipping Slack notification');
    return;
  }
  if (!process.env.SLACK_CHANNEL_TRANSFERS) {
    console.error('⚠️ SLACK_CHANNEL_TRANSFERS not set - skipping Slack notification');
    return;
  }
  
  try {
    await notifyFn();
    console.log('✅ Slack notification sent successfully');
  } catch (error: any) {
    // Log detailed error info for debugging
    console.error('⚠️ Failed to send Slack notification:', {
      message: error?.message,
      code: error?.code,
      data: error?.data,
    });
  }
}
