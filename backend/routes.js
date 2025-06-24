const express = require('express');
const {getMovies,addMovie,editMovie,deleteMovie,toggleFavorite}=require('./controller');
const router = express.Router();


router.get('/movie',getMovies);
router.post('/movie',addMovie);
router.put('/movie',editMovie);
router.delete('/movie',deleteMovie);
router.patch('/movie',toggleFavorite);

module.exports = router;