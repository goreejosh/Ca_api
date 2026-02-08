const axios = require('axios');
const { getShipStationAuthHeader, SHIPSTATION_PARTNER_HEADER } = require('./shipstationHelpers');

async function getShipStationOrder(orderId) {
  if (!orderId) throw new Error('orderId is required');
  const authHeader = getShipStationAuthHeader();
  const url = `https://ssapi.shipstation.com/orders/${orderId}`;
  const resp = await axios.get(url, {
    headers: { Authorization: authHeader, ...SHIPSTATION_PARTNER_HEADER, Accept: 'application/json' },
    timeout: 20000,
  });
  return resp.data;
}

module.exports = { getShipStationOrder };

