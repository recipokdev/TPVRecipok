# Cash Smoke Checklist

Use this checklist before every publish.

## Preconditions

- App is online and company is resolved.
- A valid user can log in.
- At least one TPV terminal exists.

## Company and Login

- Start app with empty config: center hint should guide to email setup.
- Complete email setup and verify login modal opens.
- Log in and verify user name appears in header.

## Open cash

- Click header cash button and open cash with a valid amount.
- Verify header changes from "Abrir caja" to "Cerrar caja".
- Verify remote box id is shown and persisted after reload.
- Cancel opening flow once and verify terminal/agent labels are preserved.

## Close cash

- Add one test ticket and payment.
- Click header cash button and open close dialog.
- Verify parked-ticket behavior:
  - If parked closing is disabled, close should be blocked.
  - If parked closing is enabled, confirmation should appear.
- Confirm close and verify header returns to "Abrir caja".
- Verify remote box id is cleared.

## Cart and Payment Actions

- Add products to cart and verify "Cobrar" button is enabled only when cart has items.
- Complete a payment and verify ticket is generated and cart resets.
- With empty cart, verify payment action is blocked.

## Tickets Modal

- Click "Tickets" button and verify tickets modal opens.
- Verify at least one recent ticket can be opened/printed from modal when available.

## Parked Tickets

- With non-empty cart, click "Aparcar" and verify ticket is parked and cart is cleared.
- With empty cart, verify "Aparcar" is blocked and does not create parked ticket.
- Open "Aparcados" and verify parked ticket can be recovered into cart.

## Mesas/TPV Mode Switch and Parked Context

- In TPV mode, recover one parked ticket and confirm button shows "Actualizar".
- Switch to Mesas mode and recover/open a mesas parked ticket.
- Switch back to TPV mode and verify the TPV parked ticket remains opened (not only cart lines).
- In TPV mode, verify "Editar" is visible for loaded parked ticket and allows updating name/observations.

## Parked Discounts Recovery

- Create parked ticket with global discount only (e.g. 50%) and recover it.
- Open global discount numpad, set to `0`, confirm total and line prices remove global discount.
- Create parked ticket with line discount only and recover it.
- Verify line discount can still be edited/removed independently.
- Create parked ticket with mixed discounts (global + line) and verify both behave consistently after recover.

## Parked Sync Incidents (Multi-TPV)

- Force one conflict scenario (remote newer or remote paid) and verify:
  - "Incidencias sync" button appears in Aparcados toolbar.
  - Mini-log line under toolbar shows latest incident and pending queue count.
  - Detail modal opens and can clear incident history.

## Refresh

- Change TPV-agent mapping in backend.
- Press refresh button in main agent bar.
- Verify terminal/agent data is refreshed in UI.

## Offline End-To-End Checklist

- Start app online once and let data load (products, families, methods, terminals, agents).
- Disconnect internet.
- Open cash and verify warning "apertura en cola/offline" may appear but flow continues.
- Add products and verify all these actions work in cart:
  - change quantity
  - edit line price (admin mode)
  - remove lines
- Open pay modal and verify method list appears from cache.
- Complete payment offline and verify ticket is queued without blocking UI.
- Change agent and, if available, terminal from overlay while offline.
- Open options and verify selected toggles persist after close/reopen:
  - stock visibility toggle
  - stock edition toggle
  - allow close with parked tickets toggle
  - terminal families visibility/mode
- Verify category/folder navigation works and products can be filtered by family/subfamily.
- Verify product tiles show name, price and image (or safe no-image fallback).
- Close app unexpectedly (kill process) with a non-empty cart and reopen:
  - cart snapshot should recover
  - parked tickets should still be recoverable
- Close session and log in again offline using cached users.
- Reconnect internet and wait queue sync:
  - queued cash open (if any) syncs first
  - queued sales sync
  - queued caja totals/close sync

## API Resource Discovery

- With packs plugin disabled, no repeated 404 spam should appear for packs endpoints.
- Enable packs plugin and force refresh/login.
- Verify packs can be loaded again without code changes.

## Pass Criteria

- No blocked UI state after cancel/open/close actions.
- No duplicated open/close actions from rapid clicks.
- Payment, tickets modal and parked flows behave as expected.
- No publish if `npm run test` fails.
