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

## Refresh

- Change TPV-agent mapping in backend.
- Press refresh button in main agent bar.
- Verify terminal/agent data is refreshed in UI.

## API Resource Discovery

- With packs plugin disabled, no repeated 404 spam should appear for packs endpoints.
- Enable packs plugin and force refresh/login.
- Verify packs can be loaded again without code changes.

## Pass Criteria

- No blocked UI state after cancel/open/close actions.
- No duplicated open/close actions from rapid clicks.
- No publish if `npm run test` fails.
