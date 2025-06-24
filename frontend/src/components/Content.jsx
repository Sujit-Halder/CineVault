import React, { useState, useEffect, useRef } from 'react';
import { FaPlus, FaFilter } from 'react-icons/fa';
import axios from 'axios';
import MovieForm from './MovieForm';
import MovieCard from './MovieCard';
import FilterPanel from './FilterPanel';

const Content = ({ selectedMenu, searchTerm }) => {
    const [showForm, setShowForm] = useState(false);
    const [movies, setMovies] = useState([]);
    const [editingMovie, setEditingMovie] = useState(null);
    const [filters, setFilters] = useState({
        status: '',
        tags: [],
        language: [],
        genre: [],
        rating: '',
        award: '',
        releaseYear: '',
    });
    const [sortType, setSortType] = useState('modification');
    const [orderType, setOrderType] = useState('ascending');

    const [showFilter, setShowFilter] = useState(false);

    // Close panel when clicking outside
    const panelRef = useRef();
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (panelRef.current && !panelRef.current.contains(event.target)) {
                setShowFilter(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        handleGetMovies();
    }, []);



    const handleGetMovies = async (isMounted) => {
        const response = await axios.get('http://localhost:5000/api/movie');
        if (response.status === 200) {
            setMovies(response.data.movies);
            alert(response.data.message);
        }
        else {
            alert("Failed to fetch movie list. Please try again")
        }
    };


    const handleAddMovie = async (movieData) => {
        const response = await axios.post('http://localhost:5000/api/movie', movieData);
        if (response.status === 200) {
            setMovies(response.data.movies);
            alert(response.data.message);
        }
        else {
            alert("Failed to add movie  to the list. Please try again");
        }
    };

    const handleEditMovie = async (movieDataEdited) => {
        const Movie = movies.find(movie => movie.id === movieDataEdited.id);
        const isEqual = JSON.stringify(movieDataEdited) === JSON.stringify(Movie);

        if (isEqual) {
            alert('Nothing to Update');
            return;
        }

        const response = await axios.put('http://localhost:5000/api/movie', movieDataEdited);
        if (response.status === 200) {
            setMovies(response.data.movies);
            alert(response.data.message);
        }
        else {
            alert("Failed to edit movie in the list. Please try again");
        }
    };

    const handleDeleteMovie = async (movieId) => {
        const response = await axios.delete('http://localhost:5000/api/movie', { data: { movieId } });
        if (response.status === 200) {
            setMovies(response.data.movies);
            alert(response.data.message);
        }
        else {
            alert("Failed to delete movie from the list. Please try again");
        }
    };

    const handleFavoriteMovie = async (movieId) => {
        const response = await axios.patch('http://localhost:5000/api/movie', { movieId });
        if (response.status === 200) {
            setMovies(response.data.movies);
            if (response.status !== 200) alert(response.data.message);
        }
        else {
            alert("Failed to delete movie from the list. Please try again");
        }
    };

    const handleSaveMovie = (movieData) => {
        if (editingMovie) {
            handleEditMovie(movieData);
        } else {
            handleAddMovie(movieData);
        }
        setShowForm(false);
        setEditingMovie(null);
    };

    const handleEditForm = (movie) => {
        setEditingMovie(movie);
        setShowForm(true);
    };

    return (
        <div className="p-4 m-2 bg-gray-200 rounded shadow-md flex flex-col gap-4 h-full overflow-auto relative">
            <div className="sticky top-0 z-10 bg-gray-200 pt-2 pb-2 flex justify-between items-center flex-wrap gap-2">
                {/* Left: Filters */}
                <div className="flex flex-wrap gap-2 items-center">
                    <div className="relative">
                        <button
                            onClick={() => setShowFilter((prev) => !prev)}
                            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-900 text-white font-semibold py-2 px-4 rounded-full shadow"
                        >
                            <FaFilter />
                        </button>

                        {showFilter && (
                            <div
                                ref={panelRef}
                                className="fixed top-25 left-15 z-50 bg-white border rounded shadow-xl p-4 w-80"
                            >
                                <FilterPanel filters={filters} onChange={setFilters} />
                            </div>
                        )}
                    </div>

                    <select
                        value={sortType}
                        onChange={(e) => setSortType(e.target.value)}
                        className="p-2 border rounded bg-white shadow-inner"
                    >
                        <option value="title">Movie Title</option>
                        <option value="creation">Created Date</option>
                        <option value="releaseDate">Release Date</option>
                        <option value="duration">Duration</option>
                        <option value="watchDate">Watch Date</option>
                        <option value="modification">Last Modified Date</option>
                    </select>

                    <select
                        value={orderType}
                        onChange={(e) => setOrderType(e.target.value)}
                        className="p-2 border rounded bg-white shadow-inner"
                    >
                        <option value="ascending">Ascending</option>
                        <option value="descending">Descending</option>
                    </select>
                </div>

                {/* Right: Add Button */}
                <div className="ml-auto">
                    <button
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-full shadow"
                        onClick={() => setShowForm(true)}
                    >
                        <FaPlus />
                        Add
                    </button>
                </div>
            </div>



            {movies.length > 0 ? (
                movies
                    .filter((movie) => {
                        // ----- selectedMenu conditions -----
                        if (selectedMenu === "Favorites" && !movie.favorite) return false;
                        if (selectedMenu === "Watch Later" && movie.status === "Watched") return false;
                        // (For "Home", allow all movies — no early return.)

                        // ----- custom filter conditions -----

                        // Status
                        if (filters.status && (!movie.status || !movie.status.includes(filters.status)))
                            return false;

                        // Genre
                        if (
                            filters.genre.length > 0 &&
                            (!movie.genres || !filters.genre.some(g => movie.genres.includes(g)))
                        ) return false;

                        // Language
                        if (
                            filters.language.length > 0 &&
                            (!movie.language || !filters.language.some(l => movie.language.includes(l)))
                        ) return false;

                        // Tags
                        if (
                            filters.tags.length > 0 &&
                            (!movie.tags || !filters.tags.some(t => movie.tags.includes(t)))
                        ) return false;

                        // Rating
                        if (filters.rating && movie.rating !== filters.rating) return false;

                        // Award
                        if (
                            filters.award &&
                            (!movie.awards || !movie.awards.includes(filters.award))
                        ) return false;

                        // Release year
                        if (
                            filters.releaseYear &&
                            (!movie.releaseDate ||
                                new Date(movie.releaseDate).getFullYear().toString() !== filters.releaseYear)
                        ) return false;

                        // Search Filter
                        if (searchTerm) {
                            const inTitle = movie.title?.toLowerCase().includes(searchTerm);
                            const inDirector = movie.director?.toLowerCase().includes(searchTerm);
                            const inCasts = movie.casts?.toLowerCase().includes(searchTerm);
                            const inpProducers = Array.isArray(movie.productionCompany)
                                ? movie.productionCompany.some(producer => producer.toLowerCase().includes(searchTerm))
                                : false;
                            const inCountry = Array.isArray(movie.countryOfOrigin)
                                ? movie.countryOfOrigin.some(country => country.toLowerCase().includes(searchTerm))
                                : false;

                            if (!inTitle && !inDirector && !inCasts && !inpProducers && !inCountry) return false;
                        }

                        return true; // passed all filters
                    })
                    .sort((a, b) => {
                        let valA = a[sortType];
                        let valB = b[sortType];

                        // Parse dates
                        const dateFields = ['creation', 'watchDate', 'releaseDate', 'modification'];
                        if (dateFields.includes(sortType)) {
                            valA = new Date(valA);
                            valB = new Date(valB);
                        }

                        // Parse numeric
                        if (sortType === 'duration') {
                            valA = Number(valA);
                            valB = Number(valB);
                        }

                        // Title (string)
                        if (sortType === 'title') {
                            valA = valA?.toLowerCase() || '';
                            valB = valB?.toLowerCase() || '';
                        }

                        if (valA < valB) return orderType === 'ascending' ? -1 : 1;
                        if (valA > valB) return orderType === 'ascending' ? 1 : -1;
                        return 0;
                    })
                    .map((movie, i) => (
                        <MovieCard
                            key={i}
                            movieData={movie}
                            onEdit={handleEditForm}
                            onDelete={handleDeleteMovie}
                            onToggleFavorite={handleFavoriteMovie}
                        />
                    ))
            ) : (
                <p className="text-gray-500 italic text-center">No movies yet.</p>
            )}


            {showForm &&
                <MovieForm
                    onClose={() => {
                        setShowForm(false);
                        setEditingMovie(null);
                    }}
                    onSubmit={handleSaveMovie}
                    initialData={editingMovie}
                />
            }
        </div>
    );
};

export default Content;