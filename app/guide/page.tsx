/**
 * User Guide - Standalone manual for non-technical users
 * Opens in a separate window/tab from the main app
 */

import Link from 'next/link';

export const metadata = {
  title: 'Inventory App User Guide',
  description: 'Complete guide to using the Inventory Management App',
};

const sections = [
  { id: 'overview', title: 'Overview Tab', icon: '📊' },
  { id: 'planning', title: 'Planning Tab', icon: '📋' },
  { id: 'pos-transfers', title: 'POs & Transfers Tab', icon: '🚚' },
  { id: 'inventory-counts', title: 'Inventory Counts Tab', icon: '📦' },
  { id: 'forecast', title: 'Forecast Tab', icon: '📈' },
  { id: 'data-definitions', title: 'Data Definitions', icon: '📖' },
  { id: 'refresh', title: 'Refreshing Data', icon: '🔄' },
];

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar navigation */}
      <aside className="hidden lg:block w-64 shrink-0 bg-white border-r border-slate-200 sticky top-0 h-screen overflow-y-auto">
        <div className="p-6">
          <Link href="/" className="text-sm text-blue-600 hover:underline mb-6 block">
            ← Back to App
          </Link>
          <h2 className="font-semibold text-slate-800 text-lg mb-4">User Guide</h2>
          <nav className="space-y-1">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="block py-2 px-3 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-md"
              >
                {s.icon} {s.title}
              </a>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 max-w-3xl mx-auto px-6 py-12 lg:py-16">
        <header className="mb-12">
          <h1 className="text-3xl font-bold text-slate-900">Inventory App User Guide</h1>
          <p className="mt-2 text-slate-600">Everything you need to know to use the inventory management system</p>
        </header>

        {/* Overview Tab */}
        <section id="overview" className="mb-16 scroll-mt-8">
          <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <span>📊</span> Overview Tab
          </h2>
          <p className="text-slate-600 mb-6">
            The Overview tab gives you a snapshot of inventory across all your warehouse locations. Use it to see how much stock you have at each location and to drill down into specific warehouses for more detail.
          </p>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">Location Tiles</h3>
          <p className="text-slate-600 mb-4">At the top, you’ll see clickable tiles for each warehouse:</p>
          <ul className="list-disc pl-6 text-slate-600 space-y-1 mb-6">
            <li><strong>LA Office</strong> – Main fulfillment location in Los Angeles</li>
            <li><strong>DTLA WH</strong> – Downtown LA warehouse (secondary storage)</li>
            <li><strong>ShipBob</strong> – Third-party fulfillment center</li>
            <li><strong>China WH</strong> – Warehouse in China</li>
          </ul>
          <p className="text-slate-600 mb-6">Click a tile to filter the table and see only that location’s inventory.</p>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">Main Table</h3>
          <p className="text-slate-600 mb-4">The table shows inventory by product (SKU). When viewing all locations, you see:</p>
          <ul className="list-disc pl-6 text-slate-600 space-y-2 mb-6">
            <li><strong>LA Office, DTLA WH, ShipBob, China WH</strong> – Available inventory at each warehouse location (Shopify available quantity). Click a location tile to filter and see detailed breakdown (On Hand, Available, Committed, In Air, In Sea).</li>
            <li><strong>In Transit</strong> – Units currently being shipped (in the air or by sea)
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                  <p className="font-mono text-slate-800">In Transit = In Air + In Sea</p>
                  <p className="text-slate-500 text-xs">Sum of units from app transfers in transit. Tracked from app transfers, not Shopify.</p>
                </div>
              </div>
            </li>
            <li><strong>In Prod</strong> – Units on order from production (manufacturing)
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                  <p className="text-slate-600">In Prod = Sum of pending quantities from open POs for this SKU</p>
                  <p className="font-mono text-slate-800">Pending = Ordered Qty − Received Qty</p>
                  <p className="text-slate-500 text-xs">(Per PO. Only includes POs with status &quot;In Production&quot; or &quot;Partial&quot;)</p>
                </div>
              </div>
            </li>
            <li><strong>Total</strong> – Total inventory across warehouses
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                  <p className="font-mono text-slate-800">Total = LA Office + DTLA WH + China WH + In Transit</p>
                  <p className="text-slate-500 text-xs">(Excludes ShipBob – 3PL managed separately)</p>
                </div>
              </div>
            </li>
          </ul>
          <p className="text-slate-600 mb-4">When you click a location tile, the table switches to show:</p>
          <ul className="list-disc pl-6 text-slate-600 space-y-2 mb-6">
            <li><strong>On Hand</strong> – Total physical inventory at the location (includes committed units). Comes from Shopify.</li>
            <li><strong>Available</strong> – Units available for sale
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                  <p className="font-mono text-slate-800">Available = On Hand − Committed</p>
                  <p className="text-slate-500 text-xs">Units not reserved for pending orders. Shown when filtering by a specific location.</p>
                </div>
              </div>
            </li>
            <li><strong>Committed</strong> – Units reserved for pending orders (comes from Shopify)</li>
            <li><strong>In Air</strong> – Units in transit via air freight (Air Express or Air Slow transfers). Tracked from app transfers, not Shopify.</li>
            <li><strong>In Sea</strong> – Units in transit via sea freight. Tracked from app transfers, not Shopify.</li>
          </ul>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">Filters</h3>
          <p className="text-slate-600 mb-6">
            Use the product filter to narrow by product type. You can switch between list view (all SKUs) and grouped view (by product family), and use the search box to find specific products.
          </p>
        </section>

        {/* Planning Tab */}
        <section id="planning" className="mb-16 scroll-mt-8">
          <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <span>📋</span> Planning Tab
          </h2>
          <p className="text-slate-600 mb-6">
            The Planning tab helps you decide what to ship from China and what to reorder from production. It shows how many days of stock you have and recommends shipping methods and production actions.
          </p>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">Summary Metrics</h3>
          <p className="text-slate-600 mb-4">At the top, colored badges show how many SKUs fall into each category:</p>
          <ul className="list-disc pl-6 text-slate-600 space-y-1 mb-6">
            <li><strong>Sea</strong> – Should ship by sea freight</li>
            <li><strong>Slow Air</strong> – Should ship by economy air</li>
            <li><strong>Express</strong> – Need express air shipping</li>
            <li><strong>Order More</strong> – Need new production orders</li>
          </ul>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">Planning Table Columns</h3>
          <ul className="list-disc pl-6 text-slate-600 space-y-2 mb-6">
            <li><strong>In Stock</strong> (also shown as LA) – Current LA area inventory
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                  <p className="font-mono text-slate-800">In Stock = LA Office available + DTLA WH available</p>
                  <p className="text-slate-500 text-xs">Available = On Hand − Committed per Shopify. Uses sum of available from each location.</p>
                </div>
              </div>
            </li>
            <li><strong>BR (Burn Rate)</strong> – Average daily sales velocity
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                  <p className="font-mono text-slate-800">BR = Total units sold in period ÷ Number of days</p>
                  <p className="text-slate-500 text-xs">Selectable: 7d, 21d, or 90d from the Burn Period dropdown</p>
                </div>
              </div>
            </li>
            <li><strong>In Air</strong> – Units in transit via air freight (from transfers tagged &quot;air&quot; to LA Office or DTLA WH)</li>
            <li><strong>In Sea</strong> – Units in transit via sea freight (from transfers tagged &quot;sea&quot; to LA Office or DTLA WH)</li>
            <li><strong>China</strong> – Available inventory at China warehouse (from Shopify)</li>
            <li><strong>In Prod</strong> – Pending quantity from production orders (open POs). Same calculation as Overview: Ordered − Received for each PO.</li>
            <li><strong>Need</strong> – Units needed to air-ship to meet target inventory
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-3">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="space-y-3">
                  <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                    <p className="font-medium text-slate-700">1. First check: Is total inventory below target?</p>
                    <p className="font-mono text-slate-800 text-xs">Target = Target Days × Selected Burn Rate</p>
                    <p className="font-mono text-slate-800 text-xs">Total = LA Stock + In Air + In Sea</p>
                    <p className="text-slate-600 text-xs">If Target &gt; Total: Need = Target − Total (simple shortfall)</p>
                  </div>
                  <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                    <p className="font-medium text-slate-700">2. If total meets target, apply sea gap logic:</p>
                    <p className="text-slate-600 text-xs">• Calculate Runway Air date (when LA + Air runs out)</p>
                    <p className="text-slate-600 text-xs">• Check earliest Sea ETA</p>
                    <p className="text-slate-600 text-xs">• If Sea ETA &gt; Runway Air date (gap exists): Need = (Gap Days + 4) × Selected Burn Rate</p>
                    <p className="text-slate-600 text-xs">• If Sea ETA ≤ Runway Air date: Need = 0 (sea arrives before stockout)</p>
                  </div>
                </div>
              </div>
            </li>
            <li><strong>Ship Type</strong> – Recommended shipping method
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-3">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="space-y-3">
                  <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                    <p className="text-slate-600 text-xs">1. Calculate Runway Air date (when LA available + Air runs out)</p>
                    <p className="text-slate-600 text-xs">2. Only include sea inventory if ETA arrives before Runway Air date</p>
                    <p className="font-mono text-slate-800 text-xs mt-1">Days of Stock = (LA available + Air + Effective Sea) ÷ BR</p>
                  </div>
                  <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                    <p className="font-medium text-slate-700 text-xs">With China inventory:</p>
                    <p className="text-slate-600 text-xs">• ≤15 days → Express</p>
                    <p className="text-slate-600 text-xs">• ≤60 days → Slow Air</p>
                    <p className="text-slate-600 text-xs">• ≤90 days → Sea</p>
                    <p className="text-slate-600 text-xs">• &gt;90 days → No Action</p>
                  </div>
                  <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                    <p className="font-medium text-slate-700 text-xs">No China inventory:</p>
                    <p className="text-slate-600 text-xs">• &lt;60 days → No CN Inv</p>
                    <p className="text-slate-600 text-xs">• ≥60 days → No Action</p>
                  </div>
                  <p className="text-slate-500 text-xs">Phase out SKU with no China → Phase Out</p>
                </div>
              </div>
            </li>
            <li><strong>Prod Status</strong> – Production action recommendation
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                  <p className="font-mono text-slate-800 text-xs">CN Runway = (LA available + Air + Sea + China WH) ÷ BR</p>
                  <p className="font-medium text-slate-700 text-xs mt-2">Logic:</p>
                  <p className="text-slate-600 text-xs">• &gt;90 days + active PO → Prod Status</p>
                  <p className="text-slate-600 text-xs">• &gt;90 days + no PO → No Action</p>
                  <p className="text-slate-600 text-xs">• ≤90 days + active PO → Push Vendor</p>
                  <p className="text-slate-600 text-xs">• ≤90 days + no PO → Order More</p>
                  <p className="text-slate-500 text-xs">Phase out SKU → Phase Out</p>
                </div>
              </div>
            </li>
            <li><strong>Runway Air</strong> – Days until stockout based on LA + Air only
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                  <p className="font-mono text-slate-800 text-xs">Runway Air = (LA Office available + DTLA WH available + In Air) ÷ BR</p>
                  <p className="text-slate-600 text-xs">Color: Red if &lt; 60 days</p>
                  <p className="text-slate-500 text-xs">Used to determine if sea shipments will arrive in time.</p>
                </div>
              </div>
            </li>
            <li><strong>LA Runway</strong> – Days until stockout based on LA + incoming shipments
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                  <p className="font-mono text-slate-800 text-xs">LA Runway = (LA Office available + DTLA WH available + In Air + In Sea) ÷ BR</p>
                  <p className="text-slate-600 text-xs">Color: Red if &lt; 90 days</p>
                </div>
              </div>
            </li>
            <li><strong>CN Runway</strong> – Days until stockout including China warehouse inventory
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                  <p className="font-mono text-slate-800 text-xs">CN Runway = (LA Office available + DTLA WH available + In Air + In Sea + China WH) ÷ BR</p>
                  <p className="text-slate-500 text-xs">Shows total runway if all China inventory were shipped.</p>
                </div>
              </div>
            </li>
          </ul>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">Ship Type Quick Reference</h3>
          <p className="text-slate-600 mb-2">Ship Type is based on “days of stock” (LA + air + sea that arrives in time) ÷ Burn Rate:</p>
          <div className="mb-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
            <p className="font-medium text-slate-700">How days of stock is calculated:</p>
            <div className="pl-4 border-l-2 border-slate-200 space-y-1">
              <p className="font-mono text-slate-800">Days of Stock = (In Stock + In Air + Effective Sea) ÷ Burn Rate</p>
              <p className="text-slate-500 text-xs">(Sea shipments only count if their ETA is before you run out of LA + Air)</p>
            </div>
          </div>
          <p className="text-slate-600 mb-4">The app recommends shipping based on how many days of stock you have:</p>
          <ul className="list-disc pl-6 text-slate-600 space-y-1 mb-6">
            <li><strong>Express</strong> (red) – ≤15 days of stock – ship urgently by express air</li>
            <li><strong>Slow Air</strong> (orange) – ≤60 days of stock – ship by economy air</li>
            <li><strong>Sea</strong> (blue) – ≤90 days of stock – ship by sea freight</li>
            <li><strong>No Action</strong> (green) – &gt;90 days – no shipping needed</li>
            <li><strong>No CN Inv</strong> (purple) – No China inventory and &lt;60 days – need production</li>
            <li><strong>Phase Out</strong> (gray) – Product being discontinued</li>
          </ul>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">Prod Status (Production Recommendation)</h3>
          <p className="text-slate-600 mb-2">Prod Status uses CN Runway (days including China) and whether you have an active Production Order:</p>
          <div className="mb-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
            <p className="font-medium text-slate-700">How this is determined:</p>
            <div className="pl-4 border-l-2 border-slate-200">
              <ul className="list-disc pl-4 space-y-1 text-slate-600">
                <li>CN Runway &gt; 90 days + have PO → <strong>Prod Status</strong> (monitor)</li>
                <li>CN Runway &gt; 90 days + no PO → <strong>No Action</strong></li>
                <li>CN Runway ≤ 90 days + have PO → <strong>Push Vendor</strong> (expedite existing order)</li>
                <li>CN Runway ≤ 90 days + no PO → <strong>Order More</strong> (create new order)</li>
                <li>Phase out SKU → <strong>Phase Out</strong></li>
              </ul>
            </div>
          </div>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">Controls</h3>
          <p className="text-slate-600 mb-6">
            Use the <strong>Burn Period</strong> dropdown (7d, 21d, 90d) to change how sales velocity is calculated. Set <strong>Target Days</strong> to your desired days of stock. You can switch between showing runway as days (e.g., 45d) or dates (e.g., Mar 15, 2026).
          </p>
        </section>

        {/* POs & Transfers Tab */}
        <section id="pos-transfers" className="mb-16 scroll-mt-8">
          <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <span>🚚</span> POs & Transfers Tab
          </h2>
          <p className="text-slate-600 mb-6">
            This tab manages Production Orders (manufacturing orders) and Transfers (moving inventory between warehouses). Use the buttons at the top to switch between Production Orders and Transfers.
          </p>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">Production Orders</h3>
          <p className="text-slate-600 mb-4">Production orders track what you’ve ordered from manufacturers:</p>
          <ul className="list-disc pl-6 text-slate-600 space-y-1 mb-6">
            <li><strong>PO#</strong> – Order number (e.g., PO47)</li>
            <li><strong>Ordered</strong> – Total units ordered</li>
            <li><strong>Received</strong> – Units delivered so far</li>
            <li><strong>Pending</strong> – Units still waiting
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="pl-4 border-l-2 border-slate-200">
                  <p className="font-mono text-slate-800">Pending = Ordered − Received</p>
                </div>
              </div>
            </li>
            <li><strong>Vendor</strong> – Manufacturer name</li>
            <li><strong>ETA</strong> – Expected arrival date</li>
            <li><strong>Status</strong> – In Production, Partial, Completed, or Cancelled</li>
          </ul>
          <p className="text-slate-600 mb-6">
            To create a new order, fill in the form and add SKUs with quantities. To record a delivery, use the delivery form and enter what was received.
          </p>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">Transfers</h3>
          <p className="text-slate-600 mb-4">Transfers track inventory moving between locations:</p>
          <ul className="list-disc pl-6 text-slate-600 space-y-1 mb-6">
            <li><strong>Transfer#</strong> – Transfer identifier</li>
            <li><strong>Origin</strong> – Where it’s shipping from</li>
            <li><strong>Destination</strong> – Where it’s going</li>
            <li><strong>Shipment Type</strong> – Air Express, Air Slow, Sea, or Immediate</li>
            <li><strong>Tracking</strong> – Carrier tracking number (clickable)</li>
            <li><strong>Status</strong> – Draft, In Transit, Partial, Delivered, or Cancelled</li>
          </ul>
          <p className="text-slate-600 mb-4">Typical flow:</p>
          <ol className="list-decimal pl-6 text-slate-600 space-y-1 mb-6">
            <li>Create transfer (Draft)</li>
            <li>When shipped, mark it In Transit</li>
            <li>When received, log the delivery</li>
          </ol>
          <p className="text-slate-600 mb-6">
            <strong>Immediate</strong> transfers move stock instantly (no transit time). <strong>Air Express</strong> and <strong>Air Slow</strong> show in the “In Air” column; <strong>Sea</strong> shows in “In Sea.”
          </p>
        </section>

        {/* Inventory Counts Tab */}
        <section id="inventory-counts" className="mb-16 scroll-mt-8">
          <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <span>📦</span> Inventory Counts Tab
          </h2>
          <p className="text-slate-600 mb-6">
            Use this tab to perform physical inventory counts and update the system with what you actually have on the shelf. This keeps your records accurate.
          </p>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">How It Works</h3>
          <ol className="list-decimal pl-6 text-slate-600 space-y-1 mb-6">
            <li>Select the warehouse you’re counting (LA Office, DTLA WH, or China WH)</li>
            <li>Enter the physical count for each SKU in the Counted column</li>
            <li>Review discrepancies (difference between counted and system quantity)</li>
            <li>Optionally save a draft to continue later</li>
            <li>Click Submit to update the system with your counts</li>
          </ol>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">Table Columns</h3>
          <ul className="list-disc pl-6 text-slate-600 space-y-2 mb-6">
            <li><strong>On Hand</strong> – Current quantity in the system (from Shopify)</li>
            <li><strong>Counted</strong> – What you physically counted (you enter this)</li>
            <li><strong>Difference</strong> – Shows how your count compares to the system
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                  <p className="font-mono text-slate-800">Difference = Counted − On Hand</p>
                  <p className="text-slate-500 text-xs">Green if positive (you counted more), red if negative (you counted less)</p>
                </div>
              </div>
            </li>
          </ul>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">Submission Summary</h3>
          <p className="text-slate-600 mb-4">When you submit, the app shows a summary. Key metrics:</p>
          <ul className="list-disc pl-6 text-slate-600 space-y-2 mb-6">
            <li><strong>SKUs Updated</strong> – Number of products you counted</li>
            <li><strong>Discrepancies</strong> – Number of SKUs where Counted ≠ On Hand</li>
            <li><strong>Total Diff</strong> – Net change across all SKUs
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                  <p className="font-mono text-slate-800">Total Diff = Sum of (Counted − On Hand) for each SKU</p>
                  <p className="text-slate-500 text-xs">Positive = more total units, negative = fewer total units</p>
                </div>
              </div>
            </li>
          </ul>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">View Logs</h3>
          <p className="text-slate-600 mb-6">
            Click “View Logs” to see a history of past submissions, including who submitted, when, and what changed. This helps with auditing and tracking.
          </p>
        </section>

        {/* Forecast Tab */}
        <section id="forecast" className="mb-16 scroll-mt-8">
          <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <span>📈</span> Forecast Tab
          </h2>
          <p className="text-slate-600 mb-6">
            The Forecast tab shows how fast products are selling (sales velocity) and when you might run out of stock. Use it to spot trends and plan ahead.
          </p>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">View Modes</h3>
          <ul className="list-disc pl-6 text-slate-600 space-y-2 mb-6">
            <li><strong>Velocity</strong> – Average units sold per day
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                  <p className="font-mono text-slate-800">Velocity = Total units sold in period ÷ Number of days</p>
                  <p className="text-slate-500 text-xs">Uses the time period you select (7, 21, or 90 days)</p>
                </div>
              </div>
            </li>
            <li><strong>Days Left</strong> – Estimated days until you run out
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="pl-4 border-l-2 border-slate-200 space-y-1">
                  <p className="font-mono text-slate-800">Days Left = Current inventory ÷ Velocity</p>
                  <p className="text-slate-500 text-xs">(Units on hand ÷ units sold per day)</p>
                </div>
              </div>
            </li>
            <li><strong>Run Out</strong> – Projected date you run out of stock
              <div className="mt-2 ml-4 p-4 bg-slate-100 rounded-md text-sm space-y-2">
                <p className="font-medium text-slate-700">How this is calculated:</p>
                <div className="pl-4 border-l-2 border-slate-200">
                  <p className="font-mono text-slate-800">Run Out Date = Today + Days Left</p>
                </div>
              </div>
            </li>
          </ul>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">Time Periods</h3>
          <p className="text-slate-600 mb-6">
            Choose the time period for the calculation: <strong>7 Days</strong>, <strong>21 Days</strong>, or <strong>90 Days</strong> of recent sales. You can also select <strong>LY 30D</strong> (same 30-day period from last year) for year-over-year comparison.
          </p>

          <h3 className="text-lg font-medium text-slate-800 mt-6 mb-2">Location Filter</h3>
          <p className="text-slate-600 mb-6">
            Filter by location to see sales velocity for a specific warehouse, or view all locations combined.
          </p>
        </section>

        {/* Data Definitions */}
        <section id="data-definitions" className="mb-16 scroll-mt-8">
          <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <span>📖</span> Data Definitions
          </h2>
          <p className="text-slate-600 mb-6">
            Quick reference for the terms used throughout the app.
          </p>

          <div className="space-y-4">
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h4 className="font-medium text-slate-800">SKU</h4>
              <p className="text-sm text-slate-600">Stock Keeping Unit – unique code for each product (e.g., ACU-BL, SP-IP16PM).</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h4 className="font-medium text-slate-800">On Hand</h4>
              <p className="text-sm text-slate-600">Physical units at a location – what’s actually on the shelf.</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h4 className="font-medium text-slate-800">Available</h4>
              <p className="text-sm text-slate-600">Units available for sale.</p>
              <p className="text-sm text-slate-700 mt-1 font-medium">Formula: Available = On Hand − Committed</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h4 className="font-medium text-slate-800">Committed</h4>
              <p className="text-sm text-slate-600">Units reserved for pending orders – not available for new sales.</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h4 className="font-medium text-slate-800">In Transit / In Air / In Sea</h4>
              <p className="text-sm text-slate-600">Units currently being shipped. In Air = air freight. In Sea = sea freight.</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h4 className="font-medium text-slate-800">Burn Rate (BR)</h4>
              <p className="text-sm text-slate-600">Average units sold per day over a selected period (7, 21, or 90 days).</p>
              <p className="text-sm text-slate-700 mt-1 font-medium">Formula: Burn Rate = Total units sold ÷ Number of days</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h4 className="font-medium text-slate-800">Runway</h4>
              <p className="text-sm text-slate-600">Number of days until you run out of stock, based on current inventory and sales rate.</p>
              <p className="text-sm text-slate-700 mt-1 font-medium">Formula: Runway = (Inventory + Incoming) ÷ Burn Rate</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h4 className="font-medium text-slate-800">Phase Out</h4>
              <p className="text-sm text-slate-600">Product being discontinued – no new production or replenishment planned.</p>
            </div>
          </div>
        </section>

        {/* Refreshing Data */}
        <section id="refresh" className="mb-16 scroll-mt-8">
          <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <span>🔄</span> Refreshing Data
          </h2>
          <p className="text-slate-600 mb-6">
            The app pulls inventory data from Shopify. Data refreshes automatically every hour. You can also click the <strong>Refresh</strong> button to get the latest data on demand. This may take up to 30 seconds.
          </p>
          <p className="text-slate-600 mb-6">
            If you have read-only access, the Refresh button will be grayed out. You can still view all data; it will update automatically on the hourly schedule.
          </p>
        </section>

        <footer className="pt-8 border-t border-slate-200 text-center text-sm text-slate-500">
          <p>Inventory App User Guide</p>
          <Link href="/" className="text-blue-600 hover:underline mt-2 inline-block">Return to App</Link>
        </footer>
      </main>
    </div>
  );
}
