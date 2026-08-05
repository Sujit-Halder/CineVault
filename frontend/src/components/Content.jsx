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
  const [orderType, setOrderType] = useState('descending');
  const [showFilter, setShowFilter] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const moviesPerPage = 20;

  const panelRef = useRef();

  // Close filter panel on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        setShowFilter(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch movies on mount
  useEffect(() => {
    handleGetMovies();
  }, []);

  // Reset page when filters/search/sort/menu changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filters, searchTerm, sortType, orderType, selectedMenu]);

  // Fetch movies
  const handleGetMovies = async () => {
    try {
      const response = await axios.get(`${import.meta.env.VITE_API_URL}/api/movie`);
      setMovies(response.data.movies);
      alert(response.data.message);
    } catch (error) {
      alert(error.response?.data?.message || "Failed to fetch movie list. Please try again");
    }
  };

  // Add movie
  const handleAddMovie = async (movieData) => {
    try {
      const response = await axios.post(`${import.meta.env.VITE_API_URL}/api/movie`, movieData);
      setMovies(response.data.movies);
      alert(response.data.message);
    } catch (error) {
      alert(error.response?.data?.message || "Failed to add movie to the list. Please try again");
    }
  };

  // Edit movie
  const handleEditMovie = async (movieDataEdited) => {
    const Movie = movies.find(movie => movie.id === movieDataEdited.id);

    const { modification: _newMod, ...editedRest } = movieDataEdited;
    const { modification: _oldMod, ...originalRest } = Movie || {};
    const isEqual = JSON.stringify(editedRest) === JSON.stringify(originalRest);

    if (isEqual) {
      alert('Nothing to Update');
      return;
    }

    try {
      const response = await axios.put(`${import.meta.env.VITE_API_URL}/api/movie`, movieDataEdited);
      setMovies(response.data.movies);
      alert(response.data.message);
    } catch (error) {
      alert(error.response?.data?.message || "Failed to edit movie in the list. Please try again");
    }
  };

  // Delete movie
  const handleDeleteMovie = async (movieId) => {
    try {
      const response = await axios.delete(`${import.meta.env.VITE_API_URL}/api/movie`, { data: { movieId } });
      setMovies(response.data.movies);
      alert(response.data.message);
    } catch (error) {
      alert(error.response?.data?.message || "Failed to delete movie from the list. Please try again");
    }
  };

  // Toggle favorite
  const handleFavoriteMovie = async (movieId) => {
    try {
      const response = await axios.patch(`${import.meta.env.VITE_API_URL}/api/movie`, { movieId });
      setMovies(response.data.movies);
      alert(response.data.message);
    } catch (error) {
      alert(error.response?.data?.message || "Failed to update favorite status. Please try again");
    }
  };

  // Save movie (add or edit)
  const handleSaveMovie = (movieData) => {
    if (editingMovie) {
      handleEditMovie(movieData);
    } else {
      handleAddMovie(movieData);
    }
    setShowForm(false);
    setEditingMovie(null);
  };

  // Open edit form
  const handleEditForm = (movie) => {
    setEditingMovie(movie);
    setShowForm(true);
  };

  // Filtered movies
  const filteredMovies = movies.filter((movie) => {
    if (selectedMenu === "Favorites" && !movie.favorite) return false;
    if (selectedMenu === "Watch Later" && movie.status === "Watched") return false;

    if (filters.status && (!movie.status || !movie.status.includes(filters.status))) return false;
    if (filters.genre.length > 0 && (!movie.genres || !filters.genre.some(g => movie.genres.includes(g)))) return false;
    if (filters.language.length > 0 && (!movie.language || !filters.language.some(l => movie.language.includes(l)))) return false;
    if (filters.tags.length > 0 && (!movie.tags || !filters.tags.some(t => movie.tags.includes(t)))) return false;
    if (filters.rating && movie.rating !== filters.rating) return false;
    if (filters.award && (!movie.awards || !movie.awards.includes(filters.award))) return false;
    if (filters.releaseYear && (!movie.releaseDate?.trim() || new Date(movie.releaseDate).getFullYear() !== Number(filters.releaseYear))) return false;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const inTitle = movie.title?.toLowerCase().includes(term);
      const inDirector = movie.director?.toLowerCase().includes(term);
      const inCasts = movie.casts?.toLowerCase().includes(term);
      const inProducers = Array.isArray(movie.productionCompany)
        ? movie.productionCompany.some(producer => producer.toLowerCase().includes(term))
        : false;
      const inCountry = Array.isArray(movie.countryOfOrigin)
        ? movie.countryOfOrigin.some(country => country.toLowerCase().includes(term))
        : false;
      if (!inTitle && !inDirector && !inCasts && !inProducers && !inCountry) return false;
    }

    return true;
  });

  // Sorted movies
  const sortedMovies = [...filteredMovies].sort((a, b) => {
    let valA = a[sortType];
    let valB = b[sortType];

    const dateFields = ['creation', 'watchDate', 'releaseDate', 'modification'];

    if (dateFields.includes(sortType)) {
      valA = Date.parse(valA);
      valB = Date.parse(valB);

      if (isNaN(valA)) valA = -Infinity;
      if (isNaN(valB)) valB = -Infinity;
    }

    if (sortType === 'duration') {
      valA = Number(valA);
      valB = Number(valB);
    }

    if (sortType === 'title') {
      valA = (valA || '').trim();
      valB = (valB || '').trim();

      const result = valA.localeCompare(valB, undefined, {
        numeric: true,
        sensitivity: 'base',
        ignorePunctuation: false
      });

      return orderType === 'ascending' ? result : -result;
    }

    if (valA < valB) return orderType === 'ascending' ? -1 : 1;
    if (valA > valB) return orderType === 'ascending' ? 1 : -1;
    return 0;
  });

  // Pagination
  const totalPages = Math.ceil(sortedMovies.length / moviesPerPage);
  const paginatedMovies = sortedMovies.slice(
    (currentPage - 1) * moviesPerPage,
    currentPage * moviesPerPage
  );

  // Condensed pagination (1 … n style)
  const renderPageNumbers = () => {
    const pages = [];
    const maxVisible = 3;

    // Always show first
    if (currentPage > 1) {
      pages.push(renderPageButton(1));
    }

    if (currentPage > maxVisible + 2) pages.push(<span key="left-ellipsis">…</span>);

    const start = Math.max(2, currentPage - maxVisible);
    const end = Math.min(totalPages - 1, currentPage + maxVisible);
    for (let i = start; i <= end; i++) pages.push(renderPageButton(i));

    if (currentPage < totalPages - (maxVisible + 1)) pages.push(<span key="right-ellipsis">…</span>);

    if (currentPage < totalPages) pages.push(renderPageButton(totalPages));

    return pages;
  };

  const renderPageButton = (page) => (
    <button
      key={page}
      onClick={() => setCurrentPage(page)}
      className={`px-3 py-1 rounded ${currentPage === page ? "bg-blue-600 text-white" : "bg-gray-300 hover:bg-gray-400"
        }`}
    >
      {page}
    </button>
  );

  return (
    <div className="p-4 m-2 bg-gray-200 rounded shadow-md flex flex-col gap-4 h-full overflow-auto relative">
      {/* Top Controls */}
      <div className="sticky top-0 z-10 bg-gray-200 pt-2 pb-2 flex justify-between items-center flex-wrap gap-2">
        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <button
              onClick={() => setShowFilter(prev => !prev)}
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

        {/* Add Button */}
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

      {/* Count info */}
      <p className="text-sm text-gray-600 text-right italic">
        Showing {sortedMovies.length} of {movies.length} movies
      </p>

      {/* Movie Cards */}
      {paginatedMovies.length > 0 ? (
        paginatedMovies.map((movie, i) => (
          <MovieCard
            key={movie.id}
            movieData={movie}
            onEdit={handleEditForm}
            onDelete={handleDeleteMovie}
            onToggleFavorite={handleFavoriteMovie}
          />
        ))
      ) : (
        <p className="text-gray-500 italic text-center">No movies yet.</p>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mt-6 flex-wrap">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(p => p - 1)}
            className="px-3 py-1 bg-gray-300 rounded disabled:opacity-50"
          >
            Prev
          </button>

          {renderPageNumbers()}

          <button
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(p => p + 1)}
            className="px-3 py-1 bg-gray-300 rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Movie Form Modal */}
      {showForm && (
        <MovieForm
          onClose={() => { setShowForm(false); setEditingMovie(null); }}
          onSubmit={handleSaveMovie}
          initialData={editingMovie}
        />
      )}
    </div>
  );
};

export default Content;
