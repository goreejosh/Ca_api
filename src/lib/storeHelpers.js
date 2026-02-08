function getStoreIdString(storeId) {
  if (storeId === null || storeId === undefined) return null;
  const s = String(storeId).trim();
  return s ? s : null;
}

module.exports = { getStoreIdString };

