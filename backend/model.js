const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

const MOVIES_FILE = path.join(__dirname, 'movies.json');
const MOVIES_BACKUP_FILE = `${MOVIES_FILE}.backup`;


// Ensuring File creation before operations
const ensureFileExists = async (filePath, initialData) => {
    try {
        await fs.access(filePath);
        console.log('File exists');
    } catch (err) {
        console.log('File does not exist');
        await fs.writeFile(filePath, JSON.stringify(initialData, null, 2));
    }
};

ensureFileExists(MOVIES_FILE, []);

// Read movies from file
const getMovies = async () => {
    try {
        const data = await fs.readFile(MOVIES_FILE, 'utf8');
        const movies = data ? JSON.parse(data) : [];
        return movies;
    } catch (err) {
        logger.error(`Error reading users file: ${err.message}`);
        return [];
    }
};

exports.getMovies = getMovies;

// Save movies to file
const saveMovies = async (movies) => {
    if (!Array.isArray(movies)) {
        logger.error('Invalid movies data. Aborting save operation.');
        return;
    }

    try {
        await fs.copyFile(MOVIES_FILE, MOVIES_BACKUP_FILE);
        await fs.writeFile(MOVIES_FILE, JSON.stringify(movies, null, 2));
    } catch (err) {
        logger.error(`Error saving movies: ${err.message}`);
    }
};

exports.saveMovies = saveMovies;

const normalizeTitle = (title) =>
    title.toLowerCase().replace(/\s+/g, ' ').trim();

exports.normalizeTitle = normalizeTitle;
