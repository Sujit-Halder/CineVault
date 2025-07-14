import React from 'react';

const FilterPanel = ({ filters, onChange }) => {
    const handleMultiChange = (e, name) => {
        const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
        onChange({ ...filters, [name]: selected });
    };

    const handleSingleChange = (e, name) => {
        let value = e.target.value;

        if (e.target.type === 'number') {
            value = parseFloat(value);
            if (value < 0) {
                value = 1;
            }
        }

        onChange({ ...filters, [name]: value });
    };

    return (
        <div className="absolute top-full right-0 mt-1 bg-white border rounded shadow-lg p-4 z-50 w-90">
            <div className="flex flex-col flex-wrap gap-1">
                {/* Status */}
                <label className="block mb font-medium text-gray-700">Status</label>
                <select value={filters.status} onChange={(e) => handleSingleChange(e, 'status')} className="border p-2 rounded">
                    <option value="Announced">Announced</option>
                    <option value="Production Started">Production Started</option>
                    <option value="Trailer Only">Trailer Only</option>
                    <option value="Released">Released</option>
                    <option value="Watched">Watched</option>
                </select>
                {/* Genre */}
                <label className="block mb font-medium text-gray-700">Genre</label>
                <select multiple value={filters.genre} onChange={(e) => handleMultiChange(e, 'genre')} className="border p-2 rounded">
                    <option value="Action">Action</option>
                    <option value="Adventure">Adventure</option>
                    <option value="Animation">Animation</option>
                    <option value="Apocalyptic">Apocalyptic</option>
                    <option value="Biographical">Biographical</option>
                    <option value="Biblical">Biblical</option>
                    <option value="Body Horror">Body Horror</option>
                    <option value="Comedy">Comedy</option>
                    <option value="Crime">Crime</option>
                    <option value="Dystopian">Dystopian</option>
                    <option value="Documentary">Documentary</option>
                    <option value="Drama">Drama</option>
                    <option value="Disaster">Disaster</option>
                    <option value="Erotic">Erotic</option>
                    <option value="Epic">Epic</option>
                    <option value="Family">Family</option>
                    <option value="Fantasy">Fantasy</option>
                    <option value="Historical">Historical</option>
                    <option value="Horror">Horror</option>
                    <option value="Gothic">Gothic</option>
                    <option value="Musical">Musical</option>
                    <option value="Mystery">Mystery</option>
                    <option value="Vampire">Vampire</option>
                    <option value="Superhero">Superhero</option>
                    <option value="Supervillain">Supervillain</option>
                    <option value="Monster">Monster</option>
                    <option value="Martial arts">Martial Arts</option>
                    <option value="Romance">Romance</option>
                    <option value="Zombie">Zombie</option>
                    <option value="Sex">Sex</option>
                    <option value="Spy">Spy</option>
                    <option value="Science Fiction">Science Fiction</option>
                    <option value="Supernatural">Supernatural</option>
                    <option value="Sport">Sport</option>
                    <option value="Sword and Sorcery">Sword and Sorcery</option>
                    <option value="Thriller">Thriller</option>
                    <option value="War">War</option>
                    <option value="Western">Western</option>
                    <option value="Anti-Western">Anti-Western</option>
                </select>

                {/* Language */}
                <label className="block mb font-medium text-gray-700">Language</label>
                <select multiple value={filters.language} onChange={(e) => handleMultiChange(e, 'language')} className="border p-2 rounded">
                    <option value="Bengali">Bengali</option>
                    <option value="Hindi">Hindi</option>
                    <option value="English">English</option>
                </select>

                {/* Tags */}
                <label className="block mb font-medium text-gray-700">Keywords</label>
                <select multiple value={filters.tags} onChange={(e) => handleMultiChange(e, 'tags')} className="border p-2 rounded">
                    <option value="Based on True Story">Based on True Story</option>
                    <option value="Cult Classic">Cult Classic</option>
                    <option value="Underrated">Underrated</option>
                    <option value="Overrated">Overrated</option>
                    <option value="Classic">Classic</option>
                    <option value="Blockbuster">Blockbuster</option>
                    <option value="Slow Burn">Slow Burn</option>
                    <option value="Feel Good">Feel Good</option>
                    <option value="Coming of Age">Coming of Age</option>
                    <option value="Psychological">Psychological</option>
                    <option value="Plot Twist">Plot Twist</option>
                    <option value="Non-linear">Non-linear</option>
                    <option value="Violent">Violent</option>
                    <option value="Dark Humor">Dark Humor</option>
                    <option value="Satirical">Satirical</option>
                    <option value="Award Winning">Award Winning</option>
                    <option value="Oscar Nominated">Oscar Nominated</option>
                    <option value="Festival Favorite">Festival Favorite</option>
                    <option value="Critically Acclaimed">Critically Acclaimed</option>
                    <option value="Hidden Gem">Hidden Gem</option>
                    <option value="Flop">Flop</option>
                    <option value="Indie">Indie</option>
                    <option value="Family Friendly">Family Friendly</option>
                    <option value="Adult Only">Adult Only</option>
                    <option value="Foreign Language">Foreign Language</option>
                    <option value="Binge Worthy">Binge Worthy</option>
                    <option value="Twist Ending">Twist Ending</option>
                    <option value="Character Driven">Character Driven</option>
                    <option value="Visually Stunning">Visually Stunning</option>
                    <option value="Underground">Underground</option>
                </select>

                {/* Rating */}
                <label className="block mb font-medium text-gray-700">Rating</label>
                <select value={filters.rating} onChange={(e) => handleSingleChange(e, 'rating')} className="border p-2 rounded">
                    <option value="Rewatchable">Rewatchable</option>
                    <option value="Must Watch Again">Must Watch Again</option>
                    <option value="Content Less">Content Less</option>
                </select>

                {/* Award */}
                <label className="block mb font-medium text-gray-700">Award</label>
                <select value={filters.award} onChange={(e) => handleSingleChange(e, 'award')} className="border p-2 rounded">
                    <option value="Academy Award">Academy Award</option>
                    <option value="Golden Globe Award">Golden Globe Award</option>
                    <option value="BAFTA Award">BAFTA Award</option>
                    <option value="Cannes Film Festival">Cannes Film Festival</option>
                    <option value="Critics' Choice Award">Critics' Choice Award</option>
                    <option value="Saturn Award">Saturn Award</option>
                    <option value="Satellite Award">Satellite Award</option>
                    <option value="MTV Award">MTV Movie & TV Award</option>
                    <option value="Golden Reel Award">Golden Reel Award</option>
                    <option value="Teen Choice Award">Teen Choice Award</option>
                    <option value="Nickelodeon Kids' Choice Award">Nickelodeon Kids' Choice Award</option>
                    <option value="Golden Trailer Award">Golden Trailer Award</option>
                    <option value="National Film Award">National Film Award</option>
                    <option value="Golden Raspberry Award">Golden Raspberry Award</option>
                    <option value="Annie Award">Annie Award</option>
                    <option value="Scream Award">Scream Award</option>
                    <option value="Filmfare Award">Filmfare Award</option>
                    <option value="Sundance Film Festival">Sundance Film Festival</option>
                    <option value="Venice Film Festival">Venice Film Festival</option>
                    <option value="Berlin International Film Festival">Berlin International Film Festival</option>

                </select>

                {/* Release Year */}
                <label className="block mb font-medium text-gray-700">Release Year</label>
                <input
                    type="number"
                    placeholder="Year"
                    value={filters.releaseYear}
                    onChange={(e) => handleSingleChange(e, 'releaseYear')}
                    className="border p-2 rounded"
                />
            </div>
            <button
                onClick={() => onChange({
                    status: '',
                    tags: [],
                    language: [],
                    genre: [],
                    rating: '',
                    award: '',
                    releaseYear: '',
                })}
                className="mt-2 text-sm text-red-600 underline hover:text-red-800"
            >
                Clear All Filters
            </button>

        </div>
    );
};

export default FilterPanel;
