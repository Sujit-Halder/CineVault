// Normalizes a single-line value while preserving meaningful punctuation.
function normalizeSingleLineText(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
}

// Normalizes independently meaningful comma-separated values.
function normalizeCommaSeparatedText(value) {
    return normalizeSingleLineText(value).split(',').map(normalizeSingleLineText).filter(Boolean).join(', ');
}

// Normalizes spacing within summary lines while preserving paragraph breaks.
function normalizeMultilineText(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n').split('\n')
        .map((line) => line.trim().replace(/[\t ]+/g, ' ')).join('\n').trim();
}

module.exports = { normalizeSingleLineText, normalizeCommaSeparatedText, normalizeMultilineText };
