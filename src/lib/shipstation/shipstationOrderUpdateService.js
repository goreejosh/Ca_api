const axios = require('axios');
const { getShipStationAuthHeader, SHIPSTATION_PARTNER_HEADER } = require('./shipstationHelpers');
const { sanitizeOrderForShipStation } = require('./shipstationOrderSanitizer');

function buildCompliantOrderUpdatePayload(ssOrder, overrides = {}) {
  const payload = {
    orderId: parseInt(ssOrder.orderId || ssOrder.order_id, 10),
    orderNumber: ssOrder.orderNumber,
    orderKey: ssOrder.orderKey || undefined,
    orderDate: ssOrder.orderDate,
    // ShipStation requires orderStatus on createorder updates
    orderStatus: ssOrder.orderStatus,
    billTo: ssOrder.billTo,
    shipTo: ssOrder.shipTo,
    items: Array.isArray(ssOrder.items) ? ssOrder.items : undefined,
    advancedOptions: ssOrder.advancedOptions?.storeId ? { storeId: ssOrder.advancedOptions.storeId } : undefined,
    ...overrides,
  };
  sanitizeOrderForShipStation(payload);
  return payload;
}

async function updateShipStationOrder({ orderId, overrides = {} }) {
  if (!orderId) throw new Error('orderId is required');

  const authHeader = getShipStationAuthHeader();

  // Fetch current order
  const getUrl = `https://ssapi.shipstation.com/orders/${orderId}`;
  const ssResp = await axios.get(getUrl, {
    headers: { Authorization: authHeader, ...SHIPSTATION_PARTNER_HEADER, Accept: 'application/json' },
    timeout: 20000,
  });
  if (!ssResp.data) throw new Error('Failed to fetch order from ShipStation');
  const ssOrder = ssResp.data;

  // Build payload
  const payload = buildCompliantOrderUpdatePayload(ssOrder, overrides);

  // POST to createorder
  const updateUrl = 'https://ssapi.shipstation.com/orders/createorder';
  const resp = await axios.post(updateUrl, payload, {
    headers: { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json', ...SHIPSTATION_PARTNER_HEADER },
    timeout: 20000,
  });
  return resp.data || { success: true };
}

module.exports = { updateShipStationOrder, buildCompliantOrderUpdatePayload };

