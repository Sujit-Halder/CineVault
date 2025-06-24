const { createLogger, format, transports } = require('winston');
const path = require('path');

// Define the log format
const logFormat = format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)
);

// Create the logger instance
const logger = createLogger({
    level: 'info', // Default log level
    format: logFormat,
    transports: [
        // Log to a file for general logs
        new transports.File({ filename: path.join(__dirname, '/logs/general.log') }),
        // Log errors to a separate file
        new transports.File({ filename: path.join(__dirname, '/logs/error.log'), level: 'error' }),
        // Log to the console
        new transports.Console(),
    ],
});

module.exports = logger;