const fs = require('fs');
const path = require('path');
const { createLogger, format, transports } = require('winston');

const LOG_DIRECTORY = path.join(__dirname, 'logs');
fs.mkdirSync(LOG_DIRECTORY, { recursive:true });

// Removes secrets and undefined values from structured logging metadata.
function sanitize(value, key = '') {
    if (['authorization','cookie','password','token','secret'].some((name) => key.toLowerCase().includes(name))) return '[REDACTED]';
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).filter(([,item]) => item !== undefined).map(([name,item]) => [name,sanitize(item,name)]));
    }
    return value;
}

const fileFormat = format.combine(format.timestamp(), format.errors({ stack:true }), format.json());
const consoleFormat = format.combine(
    format.timestamp({ format:'YYYY-MM-DD HH:mm:ss' }),
    format.colorize(),
    format.printf(({ timestamp, level, message, event, requestId, durationMs }) => {
        const context = [event && `event=${event}`,requestId && `request=${requestId}`,durationMs != null && `duration=${durationMs}ms`].filter(Boolean).join(' ');
        return `[${timestamp}] ${level}: ${message}${context ? ` · ${context}` : ''}`;
    }),
);

const logger = createLogger({
    level:process.env.LOG_LEVEL || 'info',
    defaultMeta:{ service:'cinevault-api' },
    transports:[
        new transports.File({ filename:path.join(LOG_DIRECTORY, 'application.jsonl'), format:fileFormat, maxsize:10 * 1024 * 1024, maxFiles:5, tailable:true }),
        new transports.File({ filename:path.join(LOG_DIRECTORY, 'error.jsonl'), level:'error', format:fileFormat, maxsize:10 * 1024 * 1024, maxFiles:5, tailable:true }),
        new transports.Console({ format:consoleFormat }),
    ],
});

// Writes a named structured event at the requested severity.
logger.event = function logEvent(level, event, message, metadata = {}) {
    logger.log(level, message, { event, ...sanitize(metadata) });
};

module.exports = logger;
