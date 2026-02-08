// Utility to sanitize a ShipStation order payload prior to createorder updates

function sanitizeOrderForShipStation(orderData) {
  if (!orderData || typeof orderData !== 'object') return orderData;

  // Remove read-only fields
  delete orderData.createDate;
  delete orderData.modifyDate;

  // Fix empty customerEmail - should be null not empty string
  if (orderData.customerEmail === '') {
    orderData.customerEmail = null;
  }

  // Remove shipping method fields if order is not shipped
  const st = String(orderData.orderStatus || '').toLowerCase();
  if (st === 'on_hold' || st === 'awaiting_shipment' || st === 'awaiting_payment') {
    try { delete orderData.carrierCode; } catch (_) {}
    try { delete orderData.serviceCode; } catch (_) {}
    try { delete orderData.packageCode; } catch (_) {}
    try { delete orderData.confirmation; } catch (_) {}

    if (orderData.advancedOptions && orderData.advancedOptions.billToParty === 'my_other_account') {
      delete orderData.advancedOptions.billToParty;
    }
  }

  // Clean up advancedOptions - remove null billTo fields and empty arrays
  if (orderData.advancedOptions) {
    const adv = orderData.advancedOptions;
    if (adv.billToParty === null) delete adv.billToParty;
    if (adv.billToAccount === null) delete adv.billToAccount;
    if (adv.billToPostalCode === null) delete adv.billToPostalCode;
    if (adv.billToCountryCode === null) delete adv.billToCountryCode;
    if (adv.billToMyOtherAccount === null) delete adv.billToMyOtherAccount;
    if (Array.isArray(adv.mergedIds) && adv.mergedIds.length === 0) delete adv.mergedIds;
  }

  // Remove other null/empty fields that might cause issues
  if (orderData.userId === null) delete orderData.userId;
  if (orderData.shipDate === null) delete orderData.shipDate;
  if (orderData.labelMessages === null) delete orderData.labelMessages;
  if (orderData.externallyFulfilled === false) {
    delete orderData.externallyFulfilledBy;
    delete orderData.externallyFulfilledById;
    delete orderData.externallyFulfilledByName;
  }

  return orderData;
}

module.exports = { sanitizeOrderForShipStation };

