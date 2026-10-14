const crypto = require('crypto');
const { config } = require('../config');
const logger = require('../logger');

async function dispatchOrder(order) {
  if (!config.orderWebhookUrl) return { delivered: false, reason: 'not_configured' };
  const body = JSON.stringify(order);
  const headers = { 'Content-Type': 'application/json' };
  if (config.orderWebhookSecret) {
    const signature = crypto.createHmac('sha256', config.orderWebhookSecret).update(body).digest('hex');
    headers['X-BCC-Signature'] = signature;
  }
  try {
    const response = await fetch(config.orderWebhookUrl, {
      method: 'POST',
      headers,
      body,
    });
    if (!response.ok) {
      logger.warn('Order webhook rejected', { status: response.status, orderId: order.id });
      return { delivered: false, reason: `http_${response.status}` };
    }
    return { delivered: true };
  } catch (error) {
    logger.error('Order webhook failed', { message: error.message, orderId: order.id });
    return { delivered: false, reason: error.message };
  }
}

module.exports = { dispatchOrder };
