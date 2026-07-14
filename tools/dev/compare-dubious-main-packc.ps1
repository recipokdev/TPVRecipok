$names = @(
  'isSimulatedTicketLike',
  'isSimulatedParkedTicket',
  'loadSafeTrainingRuntimeSnapshot',
  'clearSafeTrainingRuntimeSnapshot',
  'clearSafeTrainingSessionData',
  'captureSafeTrainingRuntimeSnapshot',
  'restoreSafeTrainingRuntimeSnapshot',
  'setProductDiscountPercentForProduct',
  'refreshCustomerPrintCacheByCod',
  'resetCartCustomerToTerminalDefault',
  'buildPackIncludesText',
  'beginParkedCheckoutLock',
  'isParkedTicketLockedByAnotherTerminal',
  'buildParkedDiscountSummarySnapshot',
  'parseParkedDisplayNumber',
  'collectUsedParkedDisplayNumbers',
  'setPedidoTpvStatusByIndex',
  'restorePreParkedCustomerSelection',
  'buildRecibosByFacturaMap',
  'getPrintableLineDiscountType',
  'calcPrintableDiscountTotal',
  'attachPrintableDiscountHintsFromSnapshot',
  'isRetryableQueueSyncError',
  'getParkedDeviceNodeId',
  'resolveRememberedTicketParkingMode',
  'euro2',
  'getSelectedCustomerPrintMeta',
  'remainingToPayCents',
  'deleteSimulatedTicketLocal',
  'refundSimulatedTicketLocal',
  'buildPackChildRefSet',
  'isZeroUnitFsLine',
  'ticketHasOfferByName',
  'looksLikePackChildByRef',
  'buildRefundIndex',
  'getRefundLinePricingBreakdown',
  'formatRefundOriginalPayments',
  'evaluateQueueHealthAndWarn'
)

$main = git show main:renderer.js
$curr = Get-Content renderer.js -Raw

foreach ($n in $names) {
  $inMain = [regex]::Matches($main, "\b$([regex]::Escape($n))\b").Count
  $inCurr = [regex]::Matches($curr, "\b$([regex]::Escape($n))\b").Count
  Write-Output ("{0}|main:{1}|packC:{2}" -f $n, $inMain, $inCurr)
}
