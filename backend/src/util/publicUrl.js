const { config } = require('../config');

function publicWsBase(req) {
  if (config.publicWsUrl) return config.publicWsUrl;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `wss://${host}`;
}

function requestUrl(req) {
  if (config.publicHttpUrl) {
    return `${config.publicHttpUrl}${req.originalUrl || req.url}`;
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}${req.originalUrl || req.url}`;
}

module.exports = { publicWsBase, requestUrl };
