const axios = require('axios');
const { getShipStationAuthHeader, SHIPSTATION_PARTNER_HEADER } = require('./shipstationHelpers');
const { sanitizeOrderForShipStation } = require('./shipstationOrderSanitizer');

async function createShipStationOrder({ payload }) {
  if (!payload) throw new Error('payload is required');
  const authHeader = getShipStationAuthHeader();
  const toSend = { ...payload };
  delete toSend.orderId; // creating new order: do not send orderId
  sanitizeOrderForShipStation(toSend);

  const url = 'https://ssapi.shipstation.com/orders/createorder';
  const resp = await axios.post(url, toSend, {
    headers: { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json', ...SHIPSTATION_PARTNER_HEADER },
    timeout: 20000,
  });
  return resp.data;
}

module.exports = { createShipStationOrder };

