const crypto = require('crypto');
const logger = require('./logger');

// Assigns a correlation identifier and records one structured event per HTTP response.
function requestLogging(req, res, next) {
    const startedAt = process.hrtime.bigint();
    req.requestId = req.get('x-request-id') || crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    logger.event('info', 'http.request.started', 'HTTP request started', {
        requestId:req.requestId, method:req.method, path:req.originalUrl, ip:req.ip,
        userAgent:req.get('user-agent'), query:req.query,
    });
    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        logger.event(level, 'http.request.completed', 'HTTP request completed', {
            requestId:req.requestId, method:req.method, path:req.originalUrl, statusCode:res.statusCode,
            durationMs:Number(durationMs.toFixed(2)), responseBytes:Number(res.getHeader('content-length')) || undefined,
        });
    });
    next();
}

// Records unexpected Express errors and returns a correlation identifier to the caller.
function unhandledErrorLogging(error, req, res, _next) {
    logger.event('error', 'http.request.unhandled_error', 'Unhandled HTTP request failure', {
        requestId:req.requestId, method:req.method, path:req.originalUrl, errorName:error.name,
        errorMessage:error.message, stack:error.stack,
    });
    if (!res.headersSent) res.status(500).json({ message:'Internal server error', requestId:req.requestId });
}

module.exports = { requestLogging, unhandledErrorLogging };
