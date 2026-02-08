const axios = require('axios');
const { getShipStationAuthHeader, SHIPSTATION_PARTNER_HEADER } = require('./shipstationHelpers');
const { sanitizeOrderForShipStation } = require('./shipstationOrderSanitizer');

async function cancelShipStationOrder({ orderId, previousDbStatus }) {
  const authHeader = getShipStationAuthHeader();
  const getOrderUrl = `https://ssapi.shipstation.com/orders/${orderId}`;

  const getOrderResponse = await axios.get(getOrderUrl, {
    headers: { Authorization: authHeader, ...SHIPSTATION_PARTNER_HEADER, Accept: 'application/json' },
    timeout: 20000,
  });
  if (!getOrderResponse.data) throw new Error('Failed to fetch order details from ShipStation');

  const ssOrder = getOrderResponse.data;
  const previousStatus = ssOrder?.orderStatus;

  // If ShipStation shows shipped/cancelled already, treat as success (caller will update local DB)
  const prevLower = String(previousStatus || '').toLowerCase();
  if (prevLower === 'shipped') {
    return { success: true, shippedButCancelledLocally: true };
  }
  if (prevLower === 'cancelled') {
    return { success: true, alreadyCancelled: true };
  }

  const payload = {
    orderId: parseInt(orderId, 10),
    orderNumber: ssOrder.orderNumber,
    orderKey: ssOrder.orderKey || undefined,
    orderDate: ssOrder.orderDate,
    orderStatus: 'cancelled',
    cancelledDate: new Date().toISOString(),
    billTo: ssOrder.billTo,
    shipTo: ssOrder.shipTo,
    items: Array.isArray(ssOrder.items) ? ssOrder.items : undefined,
    advancedOptions: ssOrder.advancedOptions?.storeId ? { storeId: ssOrder.advancedOptions.storeId } : undefined,
  };
  sanitizeOrderForShipStation(payload);

  try {
    const updateUrl = 'https://ssapi.shipstation.com/orders/createorder';
    const resp = await axios.post(updateUrl, payload, {
      headers: { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json', ...SHIPSTATION_PARTNER_HEADER },
      timeout: 20000,
    });

    if (resp.status === 200) {
      return { success: true };
    }
    return { success: false, status: resp.status, details: 'Unexpected response from ShipStation' };
  } catch (err) {
    const status = err.response?.status || 500;
    const ssData = err.response?.data;
    const message = ssData?.Message || ssData?.message || ssData?.error || err.message;

    // If ShipStation rejects (e.g., shipped or cannot be cancelled), cancel locally anyway
    const nonBlockingStatuses = new Set([400, 404, 409, 422, 423]);
    const msg = String(message || '').toLowerCase();
    const indicatesNonCancellable =
      msg.includes('shipped') ||
      msg.includes('cannot be cancelled') ||
      msg.includes('cannot cancel') ||
      msg.includes('not awaiting shipment') ||
      msg.includes('already') ||
      msg.includes('not found');

    if (nonBlockingStatuses.has(status) || indicatesNonCancellable) {
      const shippedHint = msg.includes('shipped') || String(previousDbStatus || '').toLowerCase() === 'shipped';
      return { success: true, shippedButCancelledLocally: shippedHint };
    }

    // Attempt refetch to confirm status
    try {
      const refetch = await axios.get(getOrderUrl, {
        headers: { Authorization: authHeader, ...SHIPSTATION_PARTNER_HEADER, Accept: 'application/json' },
        timeout: 20000,
      });
      const actualStatus = refetch.data?.orderStatus;
      const actualLower = String(actualStatus || '').toLowerCase();
      if (actualLower === 'cancelled') {
        return { success: true, statusCorrected: true, actualStatus: 'cancelled' };
      }
      if (actualLower === 'shipped') {
        return { success: true, shippedButCancelledLocally: true, actualStatus: 'shipped' };
      }
      return { success: false, status, details: message, actualStatus };
    } catch (refetchErr) {
      const refetchMsg = refetchErr.response?.data?.Message || refetchErr.response?.data?.message || refetchErr.message;
      return { success: false, status, details: `${message} (Also failed to verify actual status: ${refetchMsg})` };
    }
  }
}

module.exports = { cancelShipStationOrder };

