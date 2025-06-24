const { v4: uuidv4 } = require('uuid');
const Model = require('./model');
const logger = require('./logger');

exports.getMovies = async (req, res) => {
    try {
        const movies = await Model.getMovies();
        logger.info(`Request for Movies list`);
        res.json({ message: "Welcome to my UNIVERSE ,Sire", movies });
    } catch (error) {
        logger.error(`Error during sending Movies list ${error.message}`);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
};

exports.addMovie = async (req, res) => {
    try {
        const movieData = req.body;
        if (!movieData) {
            logger.warn('Adding Movie  failed: Movie data is required');
            return res.status(400).json({ message: 'Movie data is required' });
        }
        const movies = await Model.getMovies();

        const newTitle = Model.normalizeTitle(movieData.title);
        const duplicate = movies.find((m) => Model.normalizeTitle(m.title) === newTitle);

        if (duplicate) {
            return res.status(400).json({ message: 'A movie with this title already exists' });
        }

        const newMovieData = {
            id: uuidv4(),
            ...movieData
        };

        movies.push(newMovieData);
        await Model.saveMovies(movies);
        logger.info(`Movie ${movieData.title} is added to the list`);
        return res.status(200).json({ message: `${movieData.title} is Added Successfully in the list`, movies });
    } catch (error) {
        logger.error(`Error during movie adding: ${error.message}`);
        return res.status(500).json({ message: 'Server error', error: error.message });
    }
}

exports.editMovie = async (req, res) => {
    try {
        const movieDataEdited = req.body;
        if (!movieDataEdited) {
            logger.warn('Adding Movie failed: Movie data is required');
            return res.status(400).json({ message: 'Movie data is required' });
        }
        const movies = await Model.getMovies();

        const index = movies.findIndex(m => m.id === movieDataEdited.id);

        if (index === -1) {
            return res.status(404).json({ message: 'Movie not found' });
        }

        movies[index] = { ...movies[index], ...movieDataEdited };
        await Model.saveMovies(movies);

        logger.info(`Movie ${movieDataEdited.title} is edited in the list.`);
        return res.status(200).json({ message: `${movieDataEdited.title} is updated Successfully in the list`, movies });
    } catch (error) {
        logger.error(`Error during movie editing : ${error.message}`);
        return res.status(500).json({ message: 'Server error', error: error.message });
    }
}

exports.deleteMovie = async (req, res) => {
    try {
        const { movieId } = req.body;

        if (!movieId) {
            logger.warn('Delete Movie failed: Movie ID is required');
            return res.status(400).json({ message: 'Movie ID is required' });
        }

        const movies = await Model.getMovies();

        const index = movies.findIndex(m => m.id === movieId);

        if (index === -1) {
            return res.status(404).json({ message: 'Movie Id is not found' });
        }

        const deletedMovie = movies.splice(index, 1);
        await Model.saveMovies(movies);

        logger.info(`Movie ${deletedMovie[0].title} is deleted from the list`);
        return res.status(200).json({ message: `${deletedMovie[0].title} is deleted Successfully from the list`, movies });
    } catch (error) {
        logger.error(`Error during task deletion: ${error.message}`);
        return res.status(500).json({ message: 'Server error', error: error.message });
    }
}


exports.toggleFavorite = async (req, res) => {
    try {
        const { movieId } = req.body;

        if (!movieId) {
            logger.warn('Toggle Favorite Movie failed: Movie ID is required');
            return res.status(400).json({ message: 'Movie ID is required' });
        }

        const movies = await Model.getMovies();

        const index = movies.findIndex(m => m.id === movieId);

        if (index === -1) {
            return res.status(404).json({ message: 'Movie Id is not found' });
        }

        movies[index].favorite = !movies[index].favorite;
        await Model.saveMovies(movies);

        logger.info(`Movie ${movies[index].title} is upgraded to favorite in the list`);
        res.status(200).json({ message: `${movies[index].title} is upgraded to favorite now`, movies });
    } catch (error) {
        logger.error(`Error during upgrading favorite: ${error.message}`);
        return res.status(500).json({ message: 'Server error', error: error.message });
    }
};
