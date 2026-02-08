const buildManualOrderCreatePayload = ({
  orderNumber,
  storeId = null,
  customer = {},
  shippingAddress = {},
  items = [],
  internalNotes = '',
  shippingMethod = null,
  requestedShippingService = null,
  timeZone,
  timezoneOffsetHours,
}) => {
  const normalizedItems = items
    .map((it) => ({
      sku: (it.sku || '').toString().trim(),
      name: (it.name || it.sku || '').toString().trim(),
      quantity: Number(it.quantity || 1),
      unit_price: it.unit_price != null ? Number(it.unit_price) : null,
    }))
    .filter((it) => it.sku && it.quantity > 0);

  const billToName = (customer?.name || shippingAddress?.name || '').toString().trim() || 'API Order';
  const shipToName = (shippingAddress?.name || customer?.name || '').toString().trim() || billToName || 'API Order';
  const requestedService = (requestedShippingService || shippingMethod || '').toString().trim();

  const nowUtc = new Date();
  let createdIso = nowUtc.toISOString();
  try {
    if (typeof timezoneOffsetHours === 'number' && isFinite(timezoneOffsetHours)) {
      const adj = new Date(nowUtc.getTime() + timezoneOffsetHours * 3600 * 1000);
      createdIso = adj.toISOString();
    } else if (timeZone) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
        .formatToParts(nowUtc)
        .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
      const isoLike = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
      createdIso = new Date(isoLike + 'Z').toISOString();
    }
  } catch (_) {}

  const ssPayload = {
    orderNumber: orderNumber || `API-${Date.now()}`,
    orderDate: createdIso,
    orderStatus: 'awaiting_shipment',
    billTo: {
      name: billToName,
      street1: shippingAddress.line1 || shippingAddress.address1 || '',
      street2: shippingAddress.line2 || shippingAddress.address2 || '',
      city: shippingAddress.city || '',
      state: shippingAddress.state || '',
      postalCode: shippingAddress.postal_code || shippingAddress.postalCode || '',
      country: shippingAddress.country || 'US',
      phone: shippingAddress.phone || customer.phone || '',
    },
    shipTo: {
      name: shipToName,
      street1: shippingAddress.line1 || shippingAddress.address1 || '',
      street2: shippingAddress.line2 || shippingAddress.address2 || '',
      city: shippingAddress.city || '',
      state: shippingAddress.state || '',
      postalCode: shippingAddress.postal_code || shippingAddress.postalCode || '',
      country: shippingAddress.country || 'US',
      phone: shippingAddress.phone || customer.phone || '',
    },
    items: normalizedItems.map((it) => ({
      sku: it.sku,
      name: it.name || it.sku,
      quantity: it.quantity,
      unitPrice: it.unit_price != null ? it.unit_price : 0,
    })),
    amountPaid: 0,
    shippingAmount: 0,
    customerEmail: customer.email || null,
    internalNotes: internalNotes || '',
    advancedOptions: {},
  };

  if (storeId) {
    ssPayload.advancedOptions.storeId = Number(storeId);
  }
  if (requestedService) {
    ssPayload.requestedShippingService = requestedService;
  }

  return {
    ssPayload,
    normalizedItems,
    createdIso,
    requestedService,
  };
};

module.exports = {
  buildManualOrderCreatePayload,
};

