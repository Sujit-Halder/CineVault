import React, { useState, useEffect } from 'react';
import { FaEdit, FaTrash, FaHeart, FaRegHeart, FaInfoCircle } from 'react-icons/fa';

const MovieCard = ({ movieData, onEdit, onDelete, onToggleFavorite }) => {
    const [isHovered, setIsHovered] = useState(false);
    const [isTouchDevice, setIsTouchDevice] = useState(false);


    // Inside your MovieCard component...

    const [showFullSummary, setShowFullSummary] = useState(false);

    const toggleSummary = () => setShowFullSummary(!showFullSummary);

    // Extract release year from releaseDate (if present and valid)
    const getReleaseYear = (date) => {
        const parsed = new Date(date);
        return !isNaN(parsed) ? parsed.getFullYear() : null;
    };

    const releaseYear = movieData.releaseDate ? getReleaseYear(movieData.releaseDate) : null;
    const summaryLimit = 200; // characters to show before truncation
    const isLongSummary = movieData.summary && movieData.summary.length > summaryLimit;

    useEffect(() => {
        const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        setIsTouchDevice(isTouch);
    }, []);

    const handleHover = (state) => {
        if (!isTouchDevice) {
            setIsHovered(state);
        }
    };

    const formatDate = (date) => {
        const parsedDate = new Date(date);

        if (isNaN(parsedDate)) {
            console.error(`Invalid date: ${date}`);
            return date;
        }

        const day = parsedDate.getDate();
        const month = parsedDate.toLocaleString('en-US', { month: 'long' });
        const year = parsedDate.getFullYear();

        const suffix =
            day % 10 === 1 && day !== 11
                ? 'st'
                : day % 10 === 2 && day !== 12
                    ? 'nd'
                    : day % 10 === 3 && day !== 13
                        ? 'rd'
                        : 'th';

        return `${day}${suffix} ${month} ${year}`;
    };

    const formatTime = (time) => {
        const [hours, minutes] = time.split(':');
        const date = new Date();
        date.setHours(hours);
        date.setMinutes(minutes);
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
    };

    const formatDateTime = (dateTime) => {
        const parsedDateTime = new Date(dateTime);

        if (isNaN(parsedDateTime)) {
            console.error(`Invalid dateTime: ${dateTime}`);
            return dateTime;
        }

        const formattedDate = formatDate(parsedDateTime);
        const formattedTime = parsedDateTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });

        return `${formattedDate}, ${formattedTime}`;
    };

    return (
        <div
            className={`relative bg-white p-4 rounded-xl shadow-md transition duration-300 transform-gpu 
            ${isHovered ? 'ring-2 ring-blue-400 shadow-xl -translate-y-1' : 'ring-0 translate-y-0'}
          `}
            onMouseEnter={() => handleHover(true)}
            onMouseLeave={() => handleHover(false)}
            onClick={() => isTouchDevice && setIsHovered(!isHovered)}
        >

            {/* Responsive layout container */}
            <div className="flex flex-col lg:flex-row gap-4">
                {/* Poster Image */}
                <div className="lg:w-1/4 w-full flex justify-center items-center">
                    {movieData.posterUrl ? (
                        <img
                            src={movieData.posterUrl}
                            alt={movieData.title}
                            className="rounded-lg object-cover max-h-full w-full"
                            loading="lazy"
                        />
                    ) : (
                        <div className="w-full h-64 bg-gray-200 rounded-lg flex items-center justify-center text-gray-500">
                            No Poster Available
                        </div>
                    )}
                </div>

                {/* Movie Details */}
                <div className="flex-1 space-y-2 text-gray-800 ">
                    {/* Title + Tags + Favorite + Status */}
                    <div className="flex flex-wrap items-center gap-4">
                        <h3
                            className={`text-2xl font-extrabold text-gray-900 ${movieData.favorite ? 'text-green-600' : ''
                                } flex items-center gap-2`}
                        >
                            🎬 {movieData.title}
                            {releaseYear && (
                                <span className="text-sm text-gray-500 font-medium">({releaseYear})</span>
                            )}
                            <FaInfoCircle
                                className="text-blue-400 hover:text-blue-600 cursor-pointer"
                                title="Movie title with release year"
                            />
                        </h3>

                        {/* Tags */}
                        {movieData.tags?.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {movieData.tags.map((tag, index) => (
                                    <span
                                        key={index}
                                        className="px-3 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded-full shadow-sm"
                                    >
                                        #{tag.toLowerCase().replace(/\s+/g, '_')}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Favorite */}
                        <button
                            onClick={() => onToggleFavorite(movieData.id)}
                            className={`text-xl transition-transform duration-200 hover:scale-110 ${movieData.favorite ? 'text-red-500' : 'text-gray-400'
                                }`}
                            title={movieData.favorite ? 'Unfavorite' : 'Mark as Favorite'}
                            aria-label="Toggle Favorite"
                        >
                            {movieData.favorite ? <FaHeart /> : <FaRegHeart />}
                        </button>

                        {/* Status */}
                        {movieData.status && (
                            <div className="px-3 py-1 text-sm font-medium bg-red-400 text-white rounded-full shadow-md">
                                {movieData.status}
                            </div>
                        )}
                    </div>
                    <div className='flex flex-row flex-wrap space-x-4 space-y-2 font-bold text-lg items-center'>
                        {movieData.releaseDate && (
                            <p className="">
                                <span className="text-gray-600">🎬 Release Date:</span>{' '}
                                <span className="text-blue-700">{formatDate(movieData.releaseDate)}</span>
                            </p>
                        )}

                        {movieData.genres?.length > 0 && (
                            <p className="">
                                <span className="text-gray-600">🎭 Genres:</span>{' '}
                                <span className="text-indigo-700">{movieData.genres.join(', ')}</span>
                            </p>
                        )}

                        {movieData.language?.length > 0 && (
                            <p className="">
                                <span className="text-gray-600">🗣️ Languages:</span>{' '}
                                <span className="text-purple-700">{movieData.language.join(', ')}</span>
                            </p>
                        )}

                        {movieData.duration && (
                            <p className="">
                                <span className="text-gray-600">⏱ Duration:</span>{' '}
                                <span className="text-green-700">{movieData.duration} min</span>
                            </p>
                        )}

                        {movieData.director && (
                            <p className="">
                                <span className="text-gray-600">🎬 Director:</span>{' '}
                                <span className="text-rose-700">{movieData.director}</span>
                            </p>
                        )}

                        {movieData.rating && (
                            <p className="">
                                <span className="text-gray-600">⭐ Rating:</span>{' '}
                                <span className="text-yellow-600">{movieData.rating}</span>
                            </p>
                        )}

                        {movieData.awards?.length > 0 && (
                            <p className="">
                                <span className="text-gray-600">🏆 Awards:</span>{' '}
                                <span className="text-orange-600">{movieData.awards.join(', ')}</span>
                            </p>
                        )}

                        {movieData.casts && (
                            <p className="">
                                <span className="text-gray-600">🎭 Cast:</span>{' '}
                                <span className="text-gray-800">{movieData.casts}</span>
                            </p>
                        )}

                        {movieData.countryOfOrigin?.length > 0 && (
                            <p className="">
                                <span className="text-gray-600">🗺️ Country:</span>{' '}
                                <span className="text-blue-800">{movieData.countryOfOrigin.join(', ')}</span>
                            </p>
                        )}

                        {movieData.productionCompany?.length > 0 && (
                            <p className="">
                                <span className="text-gray-600">🏢 Producers:</span>{' '}
                                <span className="text-indigo-600">{movieData.productionCompany}</span>
                            </p>
                        )}

                        {movieData.contentRating?.length > 0 && (
                            <p className="">
                                <span className="text-gray-600">🔴 Ratings:</span>{' '}
                                <span className="text-red-600">{movieData.contentRating.join(', ')}</span>
                            </p>
                        )}

                        {movieData.sourceOfWatch?.length > 0 && (
                            <p className="">
                                <span className="text-gray-600">📡▶️ Source:</span>{' '}
                                <span className="text-cyan-700">{movieData.sourceOfWatch.join(', ')}</span>
                            </p>
                        )}

                        {movieData.sourceReference && (
                            <p className="">
                                <span className="text-gray-600">🔗 Source:</span>{' '}
                                {movieData.sourceReference
                                    .split(',')
                                    .map((ref, idx, arr) => {
                                        const trimmedRef = ref.trim();
                                        const isLink = trimmedRef.startsWith('http://') || trimmedRef.startsWith('https://');

                                        return (
                                            <span key={idx}>
                                                {isLink ? (
                                                    <a
                                                        href={trimmedRef}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-blue-600 hover:underline break-all"
                                                    >
                                                        {trimmedRef}
                                                    </a>
                                                ) : (
                                                    <span className="text-gray-700">{trimmedRef}</span>
                                                )}
                                                {/* Add separator ' | ' between items except the last */}
                                                {idx < arr.length - 1 && <span className="text-gray-400"> | </span>}
                                            </span>
                                        );
                                    })}
                            </p>
                        )}


                    </div>

                    {/* Summary Section with Toggle */}
                    {movieData.summary && (
                        <div className="mt-4 bg-gray-100 rounded-lg p-3 shadow-inner">
                            <p className="font-semibold text-gray-700 mb-1">📝 Summary:</p>
                            <p className="text-sm text-gray-800 text-justify leading-relaxed">
                                {isLongSummary && !showFullSummary
                                    ? `${movieData.summary.slice(0, summaryLimit)}...`
                                    : movieData.summary}
                            </p>
                            {isLongSummary && (
                                <button
                                    onClick={toggleSummary}
                                    className="text-blue-600 text-xs mt-1 hover:underline focus:outline-none"
                                >
                                    {showFullSummary ? 'Show Less ▲' : 'Read More ▼'}
                                </button>
                            )}
                        </div>
                    )}
                    <div className='flex flex-row gap-4 pt-2'>
                        {movieData.creation && (
                            <p className="text-xs text-gray-400">📅 Created: {formatDateTime(movieData.creation)}</p>
                        )}
                        {movieData.modification && (
                            <p className="text-xs text-gray-400">📅 Modified: {formatDateTime(movieData.modification)}</p>
                        )}
                        {movieData.watchDate && (
                            <p className="text-xs text-gray-400">📅 Watched: {formatDate(movieData.watchDate)}</p>
                        )}
                    </div>
                </div>

                {/* Trailer Video */}
                <div className="lg:w-1/3 w-full flex justify-center items-center">
                    {movieData.trailerUrl ? (
                        <div className="relative w-full h-full rounded-lg overflow-hidden">
                            {/* Thumbnail */}
                            <img
                                src={`https://img.youtube.com/vi/${movieData.trailerUrl.split("v=")[1]}/hqdefault.jpg`}
                                alt={`Trailer thumbnail for ${movieData.title}`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                            />

                            {/* Play Button Overlay */}
                            <button
                                onClick={(e) => {
                                    const container = e.currentTarget.parentElement;
                                    container.innerHTML = `
          <iframe
            class="w-full h-full rounded-lg"
            src="${movieData.trailerUrl.replace("watch?v=", "embed/")}?autoplay=1"
            title="Trailer for ${movieData.title}"
            allowfullscreen
          ></iframe>
        `;
                                }}
                                className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-40 text-white text-3xl"
                            >
                                ▶
                            </button>
                        </div>
                    ) : (
                        <div className="w-full h-full bg-gray-200 rounded-lg flex items-center justify-center text-gray-500">
                            No Trailer Available
                        </div>
                    )}

                </div>
            </div>

            {/* Hover Edit/Delete Buttons */}
            {isHovered && (
                <div className="absolute top-3 right-14 flex space-x-2 opacity-100 transition-opacity duration-300">
                    <button
                        className="p-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 shadow-md transition-transform duration-300 hover:scale-110"
                        onClick={() => onEdit(movieData)}
                        aria-label="Edit movie"
                        title="Edit movie"
                    >
                        <FaEdit />
                    </button>

                    <button
                        className="p-2 bg-red-500 text-white rounded-full hover:bg-red-600 shadow-md transition-transform duration-300 hover:scale-110"
                        onClick={() => onDelete(movieData.id)}
                        aria-label="Delete movie"
                        title="Delete movie"
                    >
                        <FaTrash />
                    </button>
                </div>
            )}
        </div>
    );

};

export default MovieCard;
