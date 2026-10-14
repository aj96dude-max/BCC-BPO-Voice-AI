function stamp() {
  return new Date().toISOString();
}

function log(level, message, extra) {
  const line = extra ? `${stamp()} [${level}] ${message} ${JSON.stringify(extra)}` : `${stamp()} [${level}] ${message}`;
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  info: (message, extra) => log('info', message, extra),
  warn: (message, extra) => log('warn', message, extra),
  error: (message, extra) => log('error', message, extra),
};
