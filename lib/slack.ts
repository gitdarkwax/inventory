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
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📦 New Production Order Created*\n*PO#:* ${data.poNumber}    *Created By:* ${data.createdBy}\n*Vendor:* ${data.vendor || 'N/A'}    *ETA:* ${data.eta || 'Not set'}`,
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
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${statusEmoji} PO Delivery Logged*\n*PO#:* ${data.poNumber}    *Status:* ${statusText}\n*Vendor:* ${data.vendor || 'N/A'}    *Received By:* ${data.receivedBy}\n*Location:* ${data.location}`,
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
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🚚 New Transfer Created*\n*Transfer#:* ${data.transferId}    *Created By:* ${data.createdBy}\n*Origin:* ${data.origin}    *Destination:* ${data.destination}\n*Shipment Type:* ${data.shipmentType}    *ETA:* ${data.eta || 'Not set'}\n*Tracking:* ${trackingText}`,
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
    items: Array<{ sku: string; totalQty: number; delivered: number; pending: number }>;
  }): Promise<void> {
    const statusEmoji = data.status === 'delivered' ? '✅' : '📬';
    const statusText = data.status === 'delivered' ? 'Fully Delivered' : 'Partial Delivery';
    const trackingUrl = this.getTrackingUrl(data.carrier, data.trackingNumber);
    const trackingText = data.trackingNumber
      ? (trackingUrl ? `<${trackingUrl}|${data.trackingNumber}>` : data.trackingNumber)
      : 'N/A';

    // Format items with delivery progress
    // e.g., "• ACU-BL: 1,000 of 1,000" or "• ACU-RD: 500 of 1,000 [Pending 500]"
    const itemsList = data.items
      .map(item => {
        const deliveredText = `${item.delivered.toLocaleString()} of ${item.totalQty.toLocaleString()}`;
        const pendingText = item.pending > 0 ? ` [Pending ${item.pending.toLocaleString()}]` : '';
        return `• *${item.sku}*: ${deliveredText}${pendingText}`;
      })
      .join('\n');

    const blocks: any[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${statusEmoji} Transfer Delivery Logged*\n*Transfer#:* ${data.transferId}    *Status:* ${statusText}\n*Received By:* ${data.receivedBy}    *Shipment Type:* ${data.shipmentType}\n*Origin:* ${data.origin}    *Destination:* ${data.destination}\n*Tracking:* ${trackingText}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Delivered Items:*\n${itemsList}`,
        },
      },
    ];

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
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*❌ Production Order Cancelled*\n*PO#:* ${data.poNumber}    *Cancelled By:* ${data.cancelledBy}\n*Vendor:* ${data.vendor || 'N/A'}`,
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
    restockedItems?: Array<{ sku: string; quantity: number }>;
  }): Promise<void> {
    let headerText = `*❌ Transfer Cancelled*\n*Transfer#:* ${data.transferId}    *Cancelled By:* ${data.cancelledBy}\n*Origin:* ${data.origin}    *Destination:* ${data.destination}\n*Shipment Type:* ${data.shipmentType}`;
    
    const blocks: any[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: headerText,
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

    // Add restocked items section if any were restocked
    if (data.restockedItems && data.restockedItems.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📦 Restocked to ${data.origin}:*\n${this.formatSkuList(data.restockedItems)}`,
        },
      });
    }

    await this.client.chat.postMessage({
      channel: this.channelId,
      text: `Transfer Cancelled: ${data.transferId}`,
      blocks,
    });
  }

  /**
   * Send notification for low stock alert
   */
  async notifyLowStock(data: {
    items: Array<{ sku: string; variantName: string; quantity: number }>;
    location: string;
    threshold: number;
  }): Promise<void> {
    const itemsList = data.items
      .map(item => `• *${item.sku}*: ${item.quantity} units${item.variantName ? ` (${item.variantName})` : ''}`)
      .join('\n');

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*⚠️ Low Stock Alert - ${data.location}*\nThe following SKUs have fallen below *${data.threshold} units*:`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: itemsList,
        },
      },
    ];

    await this.client.chat.postMessage({
      channel: this.channelId,
      text: `Low Stock Alert: ${data.items.length} SKU(s) below ${data.threshold} units at ${data.location}`,
      blocks,
    });
  }
}

/**
 * Helper to safely send Slack notification (doesn't throw on failure)
 */
export async function sendSlackNotification(
  notifyFn: () => Promise<void>,
  channelEnvVar: string = 'SLACK_CHANNEL_TRANSFERS'
): Promise<void> {
  // Check if required env vars exist before attempting
  if (!process.env.SLACK_BOT_TOKEN) {
    console.error('⚠️ SLACK_BOT_TOKEN not set - skipping Slack notification');
    return;
  }
  if (!process.env[channelEnvVar]) {
    console.error(`⚠️ ${channelEnvVar} not set - skipping Slack notification`);
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
