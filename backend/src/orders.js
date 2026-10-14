const crypto = require('crypto');

const MAX_ORDERS = 200;
const orders = [];

function recordOrder(call, campaign) {
  const order = {
    id: crypto.randomUUID(),
    callId: call.id,
    callSid: call.callSid,
    campaignId: campaign.id,
    campaignName: campaign.name,
    vertical: campaign.vertical,
    from: call.from,
    to: call.to,
    fields: { ...call.fields },
    status: call.status === 'transfer' ? 'transferred' : 'complete',
    createdAt: new Date().toISOString(),
  };
  orders.unshift(order);
  if (orders.length > MAX_ORDERS) orders.length = MAX_ORDERS;
  return order;
}

function listOrders() {
  return orders;
}

function getOrder(id) {
  return orders.find((order) => order.id === id) || null;
}

module.exports = { recordOrder, listOrders, getOrder };
