const getShipStationAuthHeader = () => {
  const apiKey = process.env.SHIPSTATION_API_KEY;
  const apiSecret = process.env.SHIPSTATION_API_SECRET;

  if (!apiKey) {
    console.error('[CA_api ShipStation] SHIPSTATION_API_KEY is missing');
  }
  if (!apiSecret) {
    console.error('[CA_api ShipStation] SHIPSTATION_API_SECRET is missing');
  }

  if (!apiKey || !apiSecret) {
    throw new Error('ShipStation API Key/Secret not configured');
  }

  const encoded = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  return `Basic ${encoded}`;
};

const SHIPSTATION_PARTNER_HEADER = { 'x-partner': '6a23ce72-08b6-45cf-b9cb-e59ac4aa4cc5' };

module.exports = {
  getShipStationAuthHeader,
  SHIPSTATION_PARTNER_HEADER,
};

