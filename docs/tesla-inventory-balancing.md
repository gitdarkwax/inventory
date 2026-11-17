# Tesla Charger Inventory Balancing

How the inventory app keeps shared Tesla charger SKUs in sync across the
multiple Shopify variants they live on.

**Last updated:** 2026-11-17
**Scope:** Tesla Charger product family (`MBT*`, `Q2T*`, `ADT*`, `CTC-BKC`)
**Covers:** mirror writes, variant pins, and the planning-tab burn-rate rollups

---

## 1. The problem

A Tesla charger is **one physical product**, but it fits multiple Tesla
vehicles. For storefront UX reasons, we publish each fitment as its own
Shopify *variant* (so a customer can pick "Model Y / 2025+" vs
"Model 3 / 2024+" when buying). Because it's the same physical unit on the
shelf, those variants share a SKU.

Example from the Q2T product (ID `15727432826961`):

| Shopify variant | Variant ID | Shared SKU |
|---|---|---|
| Model Y / 2025+ 15.4" Screen / Left | `59208702623825` | **Q2T15** |
| Model 3 / 2024+ 15" Screen / Left | `59208702885969` | **Q2T15** |

**The consequence:** Shopify tracks inventory per *variant*, not per SKU.
If we add 100 units to only one of those two variants, the other one is
unaware. Meanwhile, customers who order the Model 3 fitment decrement
only the Model 3 variant, not the Model Y.

Without mitigation, variants drift out of sync — one variant accumulates,
the other goes negative. This is exactly what we observed in late 2026:
Model Y variants had healthy stock while their Model 3 siblings had
quantities as low as `−823`.

**The fix is a system of "mirror writes":** every time our app changes
inventory for one of these shared SKUs, we write the same quantity (or
delta) to **every Shopify variant that shares that SKU** on the same
product. Variants stay aligned between writes; natural drift from
customer sales between writes is accepted and re-corrected on the next
write.

---

## 2. Shopify data model, concretely

Each Shopify product has many variants. Each variant has a SKU, a
`variant_id`, and an `inventory_item_id`. Inventory levels are tracked
per `(inventory_item_id, location_id)` tuple.

The relationship for a shared-SKU variant looks like this:

```
Product: "MagBak Phone Mount And Charger for Tesla" (15727432826961)
├── Variant 59208702623825 (SKU=Q2T15)  inventory_item_id=A
│   ├── LA Office level
│   ├── DTLA WH level
│   └── China WH level
└── Variant 59208702885969 (SKU=Q2T15)  inventory_item_id=B
    ├── LA Office level
    ├── DTLA WH level
    └── China WH level
```

A mirror write for SKU `Q2T15` at LA Office means writing to **both**
`(inventory_item_A, LA_Office)` and `(inventory_item_B, LA_Office)` with
the same value or delta.

---

## 3. SKUs covered today

### MBT product (first-generation MagBak Charger for Tesla)

| SKU | Pinned variant ID | Variant title |
|---|---|---|
| `MBT3Y-DG`   | `42054672449617` | Model Y / 2020-2024 / Left Hand |
| `MBT3YRH-DG` | `42054672482385` | Model Y / 2020-2024 / Right Hand |

### Q2T product — product ID `15727432826961` (current-generation)

| SKU | Pinned variant ID | Variant title |
|---|---|---|
| `Q2T15`   | `59208702623825` | Model Y / 2025+ 15.4" Screen / Left |
| `Q2T15RH` | `59208702656593` | Model Y / 2025+ 15.4" Screen / Right |
| `Q2TOG`   | `59208702296145` | Model Y / 2020-2024 / Left |
| `Q2TOGRH` | `59208702328913` | Model Y / 2020-2024 / Right |
| `Q2T16`   | `59208702689361` | Model Y / 2025+ 16" Screen / Left |
| `Q2T16RH` | `59208702722129` | Model Y / 2025+ 16" Screen / Right |

**Convention:** every pinned variant is the **Model Y** one. Writes are
mirrored to whichever Model 3 sibling exists on the same product. The
pinned variant is the canonical one for display, cache, and refresh
filtering.

### Q2T product SKUs that are *not* pinned (single-variant)

| SKU | Variant | Why not pinned |
|---|---|---|
| `Q2TCT`, `Q2TCTRH` | Cybertruck only | No sibling variant |
| `Q2TMX`, `Q2TMXRH` | Model X / S only | No sibling variant |

If a Model 3 or Model Y fitment is ever added for the Cybertruck or
Model X charger, these SKUs will need to be pinned too. See §8 for the
playbook.

---

## 4. The mirror-write system

Three pieces work together.

### 4a. The pin registry — [`lib/tesla-fixed-variants.ts`](../lib/tesla-fixed-variants.ts)

A static `Record<SKU, {variantId, preferredVariantTitle}>` that declares
which Shopify variant each shared SKU is *canonically* pinned to.

```ts
const TESLA_FIXED_VARIANTS = {
  'Q2T15': {
    variantId: '59208702623825',
    preferredVariantTitle: 'Model Y / 2025+ 15.4" Screen / Left',
  },
  // ...
};
```

Exposed helpers:

| Function | Returns |
|---|---|
| `isTeslaFixedVariantSku(sku)` | `true` if the SKU is in the registry |
| `getTeslaFixedVariantIdForSku(sku)` | the pinned variant ID or `undefined` |
| `getTeslaFixedSkus()` | all pinned SKU keys |
| `matchesTeslaFixedVariant(sku, variantId)` | `true` if variantId is the canonical one (or if SKU isn't pinned at all) |
| `getTeslaPreferredVariantTitleForSku(sku)` | display label for the pinned variant |

### 4b. Runtime sibling discovery — [`lib/tesla-mirror-writes.ts`](../lib/tesla-mirror-writes.ts)

`fetchTeslaMirrorInventoryItemIds({ shop, accessToken })` — for every
pinned SKU in the registry, queries Shopify via GraphQL to:

1. Resolve the pinned variant's product
2. Enumerate every sibling variant on that product
3. Collect inventory item IDs from siblings whose SKU matches (case-insensitive)

Returns `Map<SKU, string[]>` — for each pinned SKU, the list of inventory
item IDs that must receive mirror writes.

This is a **runtime lookup**, not a config file. Add a new sibling variant
to a Shopify product and the next refresh / inventory write picks it up
automatically (as long as the parent SKU is in the registry).

### 4c. The three write paths that honor it

Every inventory-mutating code path checks `isTeslaFixedVariantSku(sku)`
and, if `true`, expands the write to every sibling inventory item ID from
`fetchTeslaMirrorInventoryItemIds`.

| Operation | Route | Shopify mutation |
|---|---|---|
| Count submission | [`app/api/inventory/update/route.ts`](../app/api/inventory/update/route.ts) | `inventorySetQuantities` (absolute set) |
| Transfer mark in transit / delivery / restock | [`app/api/transfers/inventory/route.ts`](../app/api/transfers/inventory/route.ts) | `inventoryAdjustQuantities` (delta) |
| Refresh — inventory cache build | [`app/api/refresh/route.ts`](../app/api/refresh/route.ts) | read-only; filters to the canonical variant via `matchesTeslaFixedVariant` |

The expansion pattern looks the same in all three places:

```ts
const mirrorInventoryItemIds = isTeslaFixedVariantSku(skuUpper)
  ? teslaMirrorInventoryItemsBySku.get(skuUpper) || [fallback]
  : [fallback];

for (const inventoryItemId of mirrorInventoryItemIds) {
  // push one write per sibling inventory item
}
```

---

## 5. Lifecycle of each inventory operation

For a pinned SKU like `Q2T15` with two sibling inventory items (Model Y
and Model 3), this is what actually gets sent to Shopify.

### 5a. Count submission (Inventory Tracker tab)

A warehouse staffer physically counts `Q2T15` at LA Office and submits
`240`. Both variants' LA Office inventory is **set to exactly 240** via
`inventorySetQuantities`. Any pre-existing drift between the two is
erased in this moment.

**Guardrail:** if `fetchTeslaMirrorInventoryItemIds` resolves fewer than
2 inventory items for a pinned SKU, the whole count submission is
rejected with HTTP 400 — prevents silently leaving a sibling un-written.
See [`app/api/inventory/update/route.ts:107-117`](../app/api/inventory/update/route.ts:107).

### 5b. Transfer — mark in transit (Air/Sea)

Transferring 500 units of `Q2T15` from China WH → LA Office via Sea:

1. Both sibling variants' China WH inventory is adjusted by `−500` via
   `inventoryAdjustQuantities`
2. 500 "incoming" units are added to our app's local tracking file
   (destination LA Office). This is not stored in Shopify.

### 5c. Transfer — mark in transit (Immediate)

Immediate transfers move units atomically (no in-transit phase).
For 500 units of `Q2T15` from China WH → LA Office (immediate):

1. Both sibling variants at China WH are adjusted by `−500`
2. Both sibling variants at LA Office are adjusted by `+500`

### 5d. Transfer — log delivery

The Air/Sea counterpart to 5c. When the shipment physically arrives:

1. Both sibling variants at the destination are adjusted by `+received_qty`
2. The app's local incoming cache is decremented

### 5e. PO delivery

Same as 5d but origin is a vendor (external). Only the destination side
hits Shopify; both sibling variants at the destination are adjusted by
`+received_qty`.

### 5f. Transfer cancellation with restock

If a cancellation restocks units back to origin, both sibling variants
at origin are adjusted by `+restocked_qty`.

### 5g. Nightly / hourly refresh

The refresh route does NOT mutate inventory for pinned SKUs. Instead:

- `matchesTeslaFixedVariant` is used to filter the cache so it only
  tracks **one canonical variant** per pinned SKU
- The legacy 35/65 rebalance logic ([`rebalanceMultiVariantSkus`](../app/api/refresh/route.ts)) explicitly
  skips pinned SKUs (see §9)

---

## 6. Post-write drift and how it corrects itself

Between our writes, variants can drift apart because **customer sales
decrement one variant at a time**. If a customer buys the Model 3
fitment, only the Model 3 variant's inventory decrements — Shopify
doesn't know (or care) that another variant shares that SKU.

Example timeline:

| Event | Model Y | Model 3 |
|---|---|---|
| App sets count to 100 (mirror write) | 100 | 100 |
| Customer buys Model 3 | 100 | 99 |
| Customer buys Model Y | 99 | 99 |
| Customer buys Model 3 × 3 | 99 | 96 |
| PO delivery of 50 units (mirror write, +50 each) | 149 | 146 |
| Count submission of 150 (mirror write, SET) | 150 | 150 |

**Drift is expected and acceptable** because:

- It only affects the per-variant Shopify display
- Our app's inventory cache only reads the canonical (Model Y) variant,
  so the dashboard always shows a single coherent number
- The next physical count resyncs both to truth via `inventorySetQuantities`

If drift becomes problematic (e.g. one variant goes negative and blocks
orders), the fix is **a single inventory count submission** on the
affected SKU. Set ≠ adjust — it writes the absolute value to every
sibling and realigns them instantly.

---

## 7. The planning-tab burn-rate rollups (related but separate)

This is a **completely different feature** that happens to apply to the
same Tesla SKU families. Documented here for completeness so readers
don't confuse the two.

In the Planning tab, three "umbrella" SKUs display aggregated burn rates
rolled up from a configured set of child SKUs. Defined inline in
[`components/Dashboard.tsx`](../components/Dashboard.tsx) as `combinedBurnRateSkus`:

| Umbrella SKU | Burn rate aggregates from | Includes self? |
|---|---|---|
| `MBT3Y-DG`   | MBT24-DG, MBT25P-DG, **MBT3Y-DG**, MBTCT-DG, MBTMX-DG | yes |
| `MBT3YRH-DG` | MBT24RH-DG, MBT25PRH-DG, **MBT3YRH-DG**, MBTCTRH-DG, MBTMXRH-DG | yes |
| `CTC-BKC`    | All 8 MBT children (LHD + RHD) | **no** |
| `Q2T16`      | Q2T15, **Q2T16**, Q2TCT, Q2TOG, Q2TMX | yes |
| `Q2T16RH`    | Q2T15RH, **Q2T16RH**, Q2TCTRH, Q2TOGRH, Q2TMXRH | yes |

**This has nothing to do with inventory writes.** It only affects the
"units/day" column on the Planning tab for these specific SKUs. Burn
rate is a signal for *production planning*, not stock keeping. A SKU can
appear in a rollup without being pinned (and vice versa).

---

## 8. Playbook — adding a new dual-variant SKU

When the storefront introduces a new Model 3 or Model Y variant that
reuses an existing Tesla SKU, follow these steps.

### Step 1 — Verify it's actually dual-variant

In Shopify Admin or via a GraphQL query, confirm that at least two
variants on the **same product** share the SKU. If they're on different
products, mirror writes won't touch the second one (see §9 gotcha).

### Step 2 — Pick the canonical variant

Convention: use the **Model Y** variant as canonical if one exists.
Otherwise, use whichever variant should drive display labels in the app.

### Step 3 — Add to `TESLA_FIXED_VARIANTS`

Edit [`lib/tesla-fixed-variants.ts`](../lib/tesla-fixed-variants.ts):

```ts
'NEW-SKU': {
  variantId: '<canonical Shopify variant ID, numeric>',
  preferredVariantTitle: '<label to show in the app>',
},
```

### Step 4 — Add test cases

Edit [`lib/tesla-fixed-variants.test.ts`](../lib/tesla-fixed-variants.test.ts) and add assertions for:

- `getTeslaFixedVariantIdForSku('NEW-SKU')` returns the right ID
- `getTeslaPreferredVariantTitleForSku('NEW-SKU')` returns the right title
- `matchesTeslaFixedVariant('NEW-SKU', <canonical>)` is `true`
- `matchesTeslaFixedVariant('NEW-SKU', <sibling>)` is `false`

### Step 5 — Deploy

Run `npx tsc --noEmit && npx vitest run` to confirm, then push to `main`.
Vercel auto-deploys.

### Step 6 — Decide whether to resync

If the two variants were seeded with similar inventory (ideal) → no
action needed. Mirror writes will keep them aligned from here forward.

If they're out of sync at pin time (e.g. one has 500, the other has 100)
→ the next inventory count submission will realign them via
`inventorySetQuantities` — do a count on that SKU right after deploy, or
just let the first scheduled count catch it.

---

## 9. Known gotchas and legacy code

### 9a. Mirror writes only cover same-product siblings

`fetchTeslaMirrorInventoryItemIds` walks the pinned variant's **own
product** and only picks up siblings on *that* product. If the same SKU
somehow ended up on two different Shopify products, only one would
receive writes.

We assume this never happens because Shopify generally doesn't permit
duplicate SKUs across products without warnings. If it ever does, the
guardrail in `app/api/inventory/update/route.ts` would still fire (fewer
than 2 inventory items resolved), but transfer/PO deliveries might
silently write to only one product.

### 9b. The legacy 35/65 split is dead code

Three files still contain a `MULTI_VARIANT_SKUS` config that splits
inventory 35% Model 3 / 65% Model Y:

- [`app/api/transfers/inventory/route.ts`](../app/api/transfers/inventory/route.ts) — in `createAdjustmentsForItem`
- [`app/api/refresh/route.ts`](../app/api/refresh/route.ts) — in `rebalanceMultiVariantSkus`
- [`lib/inventory-submission.ts`](../lib/inventory-submission.ts) — `DEFAULT_MULTI_VARIANT_SKU_SPLITS`

This was the **original approach** before mirror writes. The
`isTeslaFixedVariantSku` check runs *first* in every code path and
short-circuits the split logic. Because every SKU in the split configs
(`MBT3Y-DG`, `MBT3YRH-DG`) is also in the fixed-variant registry, the
split code **never runs**.

The `rebalanceMultiVariantSkus` function on refresh explicitly logs
`"skipping rebalance because SKU is pinned to a fixed variant"` and
skips. Confirmation that the split path is intentionally dead.

**Cleanup opportunity:** delete the `MULTI_VARIANT_SKUS` constants from
all three files and the dead rebalance function. Not blocking anything,
but confusing when reading the code.

### 9c. Refresh filters display to one variant

Because `matchesTeslaFixedVariant` filters the `variantMap` in
`app/api/refresh/route.ts:458`, the inventory cache only tracks the
canonical (Model Y) variant for each pinned SKU. In the dashboard UI:

- Only the Model Y variant title appears in location-detail views
- The sum / total displayed for the SKU reflects only the Model Y
  variant's inventory

That's correct for the "one canonical number per SKU" story the app tells,
but it does mean the Model 3 sibling's independent inventory is
**invisible in the app** until the next mirror write resyncs them. If
you ever need to inspect per-variant drift, use Shopify Admin directly
or write a one-off query.

### 9d. All write paths must honor the pin

Any new code path that writes inventory to Shopify must:

1. Import `isTeslaFixedVariantSku` from `lib/tesla-fixed-variants`
2. Fetch mirror IDs via `fetchTeslaMirrorInventoryItemIds` before writing
3. Expand its writes across all sibling inventory items

Forgetting this would reintroduce the drift problem for whichever code
path skipped it.

---

## 10. File reference

| File | Role |
|---|---|
| [`lib/tesla-fixed-variants.ts`](../lib/tesla-fixed-variants.ts) | Pin registry + helpers (`isTeslaFixedVariantSku`, etc.) |
| [`lib/tesla-fixed-variants.test.ts`](../lib/tesla-fixed-variants.test.ts) | Unit tests for the pin registry |
| [`lib/tesla-mirror-writes.ts`](../lib/tesla-mirror-writes.ts) | Runtime GraphQL lookup of sibling inventory items |
| [`lib/inventory-submission.ts`](../lib/inventory-submission.ts) | Legacy 35/65 split config (dead for pinned SKUs; see §9b) |
| [`app/api/inventory/update/route.ts`](../app/api/inventory/update/route.ts) | Count-submission write path with guardrail |
| [`app/api/transfers/inventory/route.ts`](../app/api/transfers/inventory/route.ts) | Transfer / PO delivery write paths |
| [`app/api/refresh/route.ts`](../app/api/refresh/route.ts) | Cache build + variant filtering + legacy rebalance (skipped for pins) |
| [`components/Dashboard.tsx`](../components/Dashboard.tsx) | Planning-tab burn-rate rollups (§7, separate from mirror writes) |

---

## 11. Changelog summary

| When | What | Commit |
|---|---|---|
| Mid-2026 | Initial MBT pins + mirror writes | `bbde272` |
| Late 2026 | Q2T15, Q2T15RH, Q2TOG, Q2TOGRH pinned (fixed Model 3 negatives) | `233c6b3` |
| 2026-11 | Q2T16, Q2T16RH pinned (new Model 3 2026+ variants added) | `59a50d7` |
