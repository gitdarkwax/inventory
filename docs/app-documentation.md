# Inventory Management App Documentation
## Version 1.2

---

## Table of Contents

1. [Overview Tab](#1-overview-tab)
2. [LA Planning Tab](#2-la-planning-tab)
3. [POs & Transfers Tab](#3-pos--transfers-tab)
4. [Inventory Tracker Tab](#4-inventory-tracker-tab)
5. [Sales Velocity Tab](#5-sales-velocity-tab)
6. [System Features](#6-system-features)

---

# 1. Overview Tab

## Summary
The Overview tab provides a bird's-eye view of inventory levels across all warehouse locations. It displays real-time stock quantities from Shopify and allows users to drill down into specific locations for detailed inventory breakdowns.

## Location Tiles

At the top of the Overview tab, four clickable tiles display total units at each location:

| Location | Description |
|----------|-------------|
| **LA Office** | Primary fulfillment location in Los Angeles |
| **DTLA WH** | Downtown LA Warehouse - secondary storage |
| **ShipBob** | Third-party fulfillment center (syncs separately) |
| **China WH** | Manufacturing/source warehouse in China |

**Interaction**: Clicking a tile filters the table to show only that location's detailed inventory.

---

## Main Inventory Table

### Default View (All Locations)

| Column | Description | Calculation |
|--------|-------------|-------------|
| **SKU** | Product Stock Keeping Unit identifier | Direct from Shopify |
| **LA Office** | Available units at LA Office | Shopify `available` quantity |
| **DTLA WH** | Available units at DTLA Warehouse | Shopify `available` quantity |
| **ShipBob** | Available units at ShipBob | Shopify `available` quantity |
| **China WH** | Available units at China Warehouse | Shopify `available` quantity |
| **In Transit** | Units currently being transferred | `In Air + In Sea` (from app transfers) |
| **In Prod** | Units in production from pending POs | Sum of pending quantities from open Production Orders |
| **Total** | Total available units across all locations | Sum of all location quantities |

### Location Detail View (Single Location Selected)

When a location tile is clicked, the table shows:

| Column | Description | Source |
|--------|-------------|--------|
| **SKU** | Product identifier | Shopify |
| **On Hand** | Physical units at location | Shopify `on_hand` quantity |
| **Available** | Units available for sale | Shopify `available` quantity |
| **Committed** | Units reserved for orders | Shopify `committed` quantity |
| **In Air** | Units in air shipment to this location | App transfer tracking |
| **In Sea** | Units in sea shipment to this location | App transfer tracking |

---

## Filters and Controls

| Control | Options | Description |
|---------|---------|-------------|
| **Product Filter** | Multi-select dropdown | Filter by product category/model |
| **View Mode** | List / Grouped | List shows all SKUs; Grouped organizes by product family |
| **Search** | Text input | Search by SKU or product name |

---

# 2. LA Planning Tab

## Summary
The LA Planning tab is a forecasting and replenishment planning tool focused on the LA area (LA Office + DTLA WH combined). It helps determine which SKUs need to be shipped from China and what production orders should be placed.

---

## Summary Metrics

| Metric | Description | Color |
|--------|-------------|-------|
| **Sea** | SKUs that should ship via sea freight | Blue |
| **Slow Air** | SKUs that should ship via economy air | Orange |
| **Express** | SKUs that need express air shipping | Red |
| **Order More** | SKUs that need new production orders | Yellow |

---

## Planning Table Columns

| Column | Description | Calculation |
|--------|-------------|-------------|
| **SKU** | Product identifier | — |
| **In Stock** | Current LA area inventory | `LA Office available + DTLA WH available` |
| **BR** | Burn Rate (units/day) | Based on selected period (7d/21d/90d average daily sales) |
| **In Air** | Units in air transit to LA area | Sum of air transfers to LA Office + DTLA WH |
| **In Sea** | Units in sea transit to LA area | Sum of sea transfers to LA Office + DTLA WH |
| **China** | Available units at China WH | Shopify `available` at China WH |
| **In Prod** | Pending production quantity | Sum of pending quantities from open POs for this SKU |
| **Need** | Units needed to meet target | `(Target Days × BR) - In Stock` (In Stock is already available = On Hand - Committed) |
| **Ship Type** | Recommended shipping method | See Ship Type Logic below |
| **Prod Status** | Production recommendation | See Prod Status Logic below |
| **Runway Air** | Days of stock with air shipments | `(In Stock + In Air) ÷ BR` |
| **Runway** | Days of stock with all incoming | `(In Stock + In Air + In Sea) ÷ BR` |

---

## Ship Type Logic

The Ship Type is calculated based on days of stock (LA inventory + incoming) and China availability:

```
If China WH has inventory:
  - ≤15 days of stock → "Express" (urgent air)
  - ≤60 days of stock → "Slow Air"
  - ≤90 days of stock → "Sea"
  - >90 days of stock → "No Action"

If China WH is empty:
  - <60 days of stock → "No CN Inv" (needs production)
  - ≥60 days of stock → "No Action"

If SKU is in Phase Out list:
  - Shows "Phase Out" (no replenishment needed)
```

| Ship Type | Color | Meaning |
|-----------|-------|---------|
| Express | Red | Ship immediately via express air |
| Slow Air | Orange | Ship via economy air |
| Sea | Blue | Ship via sea freight |
| No CN Inv | Purple | No China inventory - need production |
| No Action | Green | Sufficient stock, no action needed |
| Phase Out | Gray | SKU being discontinued |

---

## Prod Status Logic

Production Status is determined by runway days and existing PO quantities:

```
If Runway > 90 days:
  - Has PO → "More in Prod"
  - No PO → "No Action"

If Runway 60-90 days:
  - Has PO → "Get Prod Status"
  - No PO → "No Action"

If Runway < 60 days:
  - Has PO → "Push Vendor"
  - No PO → "Order More"
```

| Prod Status | Color | Action Required |
|-------------|-------|-----------------|
| Push Vendor | Red | Contact vendor to expedite existing PO |
| Order More | Orange | Create new production order |
| Get Prod Status | Yellow | Check status of existing PO |
| More in Prod | Purple | Production exists, monitor progress |
| No Action | Green | Sufficient stock/production coverage |
| Phase Out | Gray | SKU being discontinued |

---

## Controls

| Control | Options | Description |
|---------|---------|-------------|
| **Burn Period** | 7d / 21d / 90d | Time period for calculating average daily sales |
| **Target Days** | Numeric input (default: 30) | Target days of stock for "Need" calculation |
| **Runway Display** | Days / Dates | Show runway as "45d" or "Mar 15, '26" |
| **Product Filter** | Multi-select | Filter by product category |
| **View Mode** | List / Grouped | Display format |

---

# 3. POs & Transfers Tab

## Summary
This tab manages two types of inventory movements:
- **Production Orders (POs)**: Track manufacturing orders from vendors
- **Transfers**: Track inventory movements between warehouse locations

Toggle between views using the "Production Orders" / "Transfers" buttons.

---

## Production Orders

### PO List Table

| Column | Description |
|--------|-------------|
| **PO#** | Auto-generated identifier (e.g., "PO47") |
| **PO Date** | Date the order was created |
| **SKUs** | List of SKUs in the order |
| **Ordered** | Total units ordered |
| **Received** | Total units delivered so far |
| **Pending** | Units still awaiting delivery (`Ordered - Received`) |
| **Vendor** | Manufacturing vendor name |
| **ETA** | Expected arrival date |
| **Status** | Current order status |

### PO Statuses

| Status | Color | Description |
|--------|-------|-------------|
| **In Production** | Blue | Order is being manufactured |
| **Partial** | Orange | Some items have been delivered |
| **Completed** | Green | All items delivered |
| **Cancelled** | Gray | Order was cancelled |

### New Production Order Form

| Field | Required | Description | Rules |
|-------|----------|-------------|-------|
| **Vendor** | No | Manufacturing vendor name | Free text |
| **ETA** | No | Expected delivery date | Date picker |
| **SKU** | Yes | Product SKU | Must exist in inventory system |
| **Quantity** | Yes | Number of units | Must be positive integer |
| **Notes** | No | Additional notes | Free text |

**Rules**:
- SKU must be validated against existing inventory SKUs
- Multiple SKUs can be added to a single PO
- PO number is auto-generated (sequential: PO1, PO2, etc.)

### Log Delivery Form

Used to record received inventory from a PO.

| Field | Description |
|-------|-------------|
| **Delivery Location** | Where inventory was received (typically China WH) |
| **SKU** | The SKU being received |
| **Quantity** | Number of units received |

**Behavior**:
- Partial deliveries are supported
- When delivery is logged, Shopify On Hand is updated
- Status changes to "Partial" or "Completed" based on remaining quantities

---

## Transfers

### Transfer List Table

| Column | Description |
|--------|-------------|
| **Transfer#** | Auto-generated identifier (e.g., "T23") |
| **Origin** | Source warehouse location |
| **Destination** | Target warehouse location |
| **Shipment Type** | Method of transport |
| **Tracking** | Carrier tracking number (clickable link) |
| **ETA** | Expected arrival date |
| **Items** | SKUs and quantities being transferred |
| **Status** | Current transfer status |

### Transfer Statuses

| Status | Color | Description |
|--------|-------|-------------|
| **Draft** | Gray | Transfer created but not shipped |
| **In Transit** | Blue | Transfer is in progress |
| **Partial** | Orange | Some items delivered |
| **Delivered** | Green | All items delivered |
| **Cancelled** | Gray | Transfer was cancelled |

### Shipment Types

| Type | Typical Duration | Behavior |
|------|------------------|----------|
| **Air Express** | 3-5 days | Shows in "In Air" column |
| **Air Slow** | 7-14 days | Shows in "In Air" column |
| **Sea** | 30-45 days | Shows in "In Sea" column |
| **Immediate** | Instant | Direct stock transfer, no transit tracking |

---

### New Transfer Form

| Field | Required | Description | Rules |
|-------|----------|-------------|-------|
| **Origin** | Yes | Source location | Must have sufficient stock |
| **Destination** | Yes | Target location | Cannot be same as origin |
| **Shipment Type** | Yes | Transfer method | Air Express, Air Slow, Sea, or Immediate |
| **SKU** | Yes | Product to transfer | Must exist and have stock at origin |
| **Quantity** | Yes | Units to transfer | Cannot exceed available stock |
| **Carrier** | No | Shipping carrier | FedEx, DHL, UPS |
| **Tracking Number** | No | Carrier tracking number | Auto-linked based on carrier |
| **ETA** | No | Expected arrival | Date picker |
| **Notes** | No | Additional notes | Free text |

---

### Transfer Flow Diagrams

#### Standard Transfer (Air/Sea)

```
┌─────────────────────────────────────────────────────────────────┐
│                    STANDARD TRANSFER FLOW                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  CREATE          MARK IN TRANSIT        LOG DELIVERY             │
│    ↓                   ↓                     ↓                   │
│  Draft    →    In Transit    →    Partial/Delivered              │
│                                                                  │
│  • No Shopify      • Subtract from         • Add to destination  │
│    changes           origin On Hand          On Hand in Shopify  │
│                    • Add to app's          • Subtract from app's │
│                      In Air/In Sea           In Air/In Sea       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Immediate Transfer

```
┌─────────────────────────────────────────────────────────────────┐
│                   IMMEDIATE TRANSFER FLOW                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  CREATE + CONFIRM                                                │
│        ↓                                                         │
│    Delivered (instant)                                           │
│                                                                  │
│  • Subtract from origin On Hand in Shopify                       │
│  • Add to destination On Hand in Shopify                         │
│  • No In Transit tracking                                        │
│  • Exception: ShipBob destination skips Shopify update           │
│    (ShipBob syncs its own inventory)                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Stock Validation

Before a transfer can be created or marked in transit:
1. App refreshes inventory data from Shopify
2. Validates that origin location has sufficient stock
3. If insufficient stock, shows error with details

---

# 4. Inventory Tracker Tab

## Summary
The Inventory Tracker is a cycle counting tool that allows warehouse staff to record physical inventory counts and reconcile discrepancies with Shopify.

---

## Features

| Feature | Description |
|---------|-------------|
| **Location Selection** | Choose which warehouse to count (LA Office, DTLA WH, China WH) |
| **Count Entry** | Enter counted quantities for each SKU |
| **Discrepancy View** | See differences between counted and system quantities |
| **Save Draft** | Save progress without submitting to Shopify |
| **Submit** | Push counted quantities to Shopify |
| **Test Mode** | Practice counting without affecting Shopify |

---

## Table Columns

| Column | Description |
|--------|-------------|
| **SKU** | Product identifier |
| **On Hand** | Current Shopify On Hand quantity |
| **Counted** | User-entered physical count |
| **Difference** | `Counted - On Hand` (red if negative, green if positive) |

---

## Workflow

1. Select warehouse location
2. Enter counted quantities for each SKU
3. Review discrepancies
4. Save draft (optional) or Submit
5. Submission updates Shopify On Hand quantities

---

# 5. Sales Velocity Tab

## Summary
The Sales Velocity tab displays historical sales data and forecasting metrics to help predict future demand.

---

## View Modes

| Mode | Description |
|------|-------------|
| **Velocity** | Shows average units sold per day |
| **Days Left** | Shows estimated days until stockout |
| **Run Out** | Shows projected stockout date |

---

## Time Periods

| Period | Description |
|--------|-------------|
| **7 Days** | Average daily sales over last 7 days |
| **21 Days** | Average daily sales over last 21 days |
| **90 Days** | Average daily sales over last 90 days |
| **LY 30D** | Same 30-day period from last year |

---

## Calculations

| Metric | Formula |
|--------|---------|
| **Units/Day** | `Total units sold in period ÷ Number of days` |
| **Days Left** | `Current inventory ÷ Units per day` |
| **Run Out Date** | `Today + Days Left` |

---

## Location Filter

Sales velocity can be filtered by location:
- **All Locations**: Aggregate sales across all locations
- **Individual Location**: Sales from specific location only

---

# 6. System Features

## Data Refresh

| Type | Frequency | Trigger |
|------|-----------|---------|
| **Manual Refresh** | On-demand | Click "Refresh Data" button |
| **Auto Refresh** | Hourly | Vercel Cron job |

**What gets refreshed**:
- Inventory levels from Shopify
- Sales/forecasting data from Shopify

**What is preserved**:
- In Transit quantities (tracked locally)
- Production Order data (tracked locally)
- Low stock alert tracking

---

## Slack Notifications

### Production Channel (`SLACK_CHANNEL_PRODUCTION`)

| Event | Details Included |
|-------|------------------|
| PO Created | PO#, Creator, Vendor, ETA, Items |
| PO Delivered | PO#, Status, Vendor, Receiver, Location, Delivered items, Pending items |
| PO Cancelled | PO#, Cancelled By, Vendor, Items |

### Incoming / Transfers Channel (`SLACK_CHANNEL_INCOMING`)

| Event | Details Included |
|-------|------------------|
| Transfer In Transit | T#, Marked By, Origin, Destination, Shipment Type, Tracking, ETA, Items |
| Transfer Delivered | T#, Status, Receiver, Origin, Destination, Shipment Type, Tracking, Items |
| Transfer Cancelled | T#, Cancelled By, Origin, Destination, Shipment Type, Items |

### Alerts Channel (`SLACK_CHANNEL_ALERTS`)

| Event | Details Included |
|-------|------------------|
| Low Stock Alert | SKUs below 100 units at LA Office |

### Low Inventory Alert Channel (`SLACK_CHANNEL_LOW_INV_ALERT`)

| Event | Details Included |
|-------|------------------|
| Transfer to LA Office | SKUs with <7 days runway at LA Office, DTLA has stock |

**Transfer to LA Office Logic**:
- Uses 7-day burn rate (avgDaily7d) for runway calculation
- Triggers when LA Office runway < 7 days AND DTLA WH has inventory
- Message includes: LA Office qty, units to transfer from DTLA, product title
- Runs on every refresh (manual and hourly cron)

**Low Stock Alert Logic**:
- Triggers when LA Office stock falls below 100 units
- Only alerts once per SKU until restocked above threshold
- If SKU is restocked then falls below again, new alert is sent

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATA SOURCES                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐     ┌──────────────┐     ┌─────────────────┐     │
│   │  Shopify │     │  Google Drive │     │   Local State   │     │
│   │   API    │     │    Cache      │     │   (In-Memory)   │     │
│   └────┬─────┘     └───────┬──────┘     └────────┬────────┘     │
│        │                   │                      │              │
│        ▼                   ▼                      ▼              │
│   • Inventory         • Cached              • Transfer          │
│   • Products            inventory             tracking          │
│   • Sales data        • In Transit          • PO tracking       │
│                         quantities          • UI state          │
│                       • Low stock                               │
│                         alerts                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Locations Reference

| Display Name | Shopify Name | Purpose |
|--------------|--------------|---------|
| LA Office | New LA Office | Primary fulfillment |
| DTLA WH | DTLA Warehouse | Secondary storage |
| ShipBob | ShipBobFulfillment-343151 | 3PL fulfillment |
| China WH | China Warehouse | Manufacturing source |

---

## Carrier Tracking URLs

When a tracking number is entered, clicking it opens the carrier's tracking page:

| Carrier | Tracking URL |
|---------|--------------|
| UPS | ups.com/track |
| FedEx | fedex.com/fedextrack |
| DHL | dhl.com/tracking |
| USPS | tools.usps.com |

---

## Product Categories

SKUs are grouped into product categories based on naming conventions:

| Category | Example SKUs |
|----------|--------------|
| Screen Protectors | SP-IP16PM, SP-IP17PM |
| Lens Protectors | LP-IP16PM |
| Cases | EC-IP16PM, CC-IP16PM |
| Accessories | ACC16E-LG |

---

## Environment Variables Required

| Variable | Purpose |
|----------|---------|
| `SHOPIFY_STORE_URL` | Shopify store domain |
| `SHOPIFY_ACCESS_TOKEN` | Shopify Admin API token |
| `GOOGLE_CREDENTIALS` | Google Drive API credentials |
| `GOOGLE_DRIVE_FOLDER_ID` | Folder for cache storage |
| `NEXTAUTH_SECRET` | Authentication secret |
| `SLACK_BOT_TOKEN` | Slack bot OAuth token |
| `SLACK_CHANNEL_PRODUCTION` | Channel for production order notifications (PO created, delivery, cancelled) |
| `SLACK_CHANNEL_INCOMING` | Channel for transfer notifications (in transit, delivery, cancelled) |
| `SLACK_CHANNEL_ALERTS` | Channel for low stock alerts |
| `SLACK_CHANNEL_LOW_INV_ALERT` | Channel for transfer-to-LA Office alerts (<7 days runway) |
| `CRON_SECRET` | Secret for hourly refresh authorization |

---

*Document generated for Inventory App v1.2*
