import React, { useState, useEffect } from 'react';

const MovieForm = ({ onClose, onSubmit, initialData }) => {
    const [form, setForm] = useState({
        title: '',
        status: 'Announced',
        releaseDate: '',
        watchDate: '',
        genres: [],
        director: '',
        casts: '',
        rating: '',
        language: [],
        duration: '',
        awards: [],
        tags: [],
        countryOfOrigin: [],
        productionCompany: '',
        contentRating: [],
        posterUrl: '',
        trailerUrl: '',
        summary: '',
        sourceOfWatch: [],
        sourceReference: '',
        favorite: false,
        creation: '',
        modification: '',
    });

    useEffect(() => {
        if (initialData) {
            setForm(initialData);
        }
    }, [initialData]);

    const handleChange = (e) => {
        const { name, value, type, checked, multiple, options } = e.target;

        let newValue;

        if (type === 'checkbox') {
            newValue = checked;
        } else if (multiple) {
            newValue = Array.from(options)
                .filter(option => option.selected)
                .map(option => option.value);
        } else {
            newValue = value;
        }

        setForm({
            ...form,
            [name]: newValue,
        });
    };

    const handleCommaSeparatedArrayChange = (e, fieldName) => {
        const value = e.target.value;

        const arrayValue = value
            .split(',')
            .map(item => item.trim())
        //   .filter(item => item.length > 0);

        setForm(prevForm => ({
            ...prevForm,
            [fieldName]: arrayValue,
        }));
    };


    const handleSubmit = (e) => {
        e.preventDefault();
        if (initialData) {
            form.modification = new Date();
        }
        else {
            form.creation = new Date();
            form.modification = form.creation;
        }
        onSubmit(form);
        onClose();
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-md max-h-screen overflow-y-auto">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <h2 className="text-xl font-semibold text-center">
                        {!initialData ? 'Add Latest Watched Movie' : 'Edit Movie'}
                    </h2>

                    <div>
                        <label className="block mb-1 font-medium text-gray-700">Movie Title</label>
                        <input
                            name="title"
                            type="text"
                            placeholder="Movie Title"
                            className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                            value={form.title}
                            onChange={handleChange}
                            required
                        />
                    </div>

                    <div>
                        <label className="block mb-1 font-medium text-gray-700">Status</label>
                        <select
                            name="status"
                            className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                            value={form.status}
                            onChange={handleChange}
                        >
                            <option value="Announced">📢 Announced</option>
                            <option value="Production Started">🎬 Production Started</option>
                            <option value="Trailer Only">🎞️ Trailer Only</option>
                            <option value="Released">📽️ Released</option>
                            <option value="Watched">✅ Watched</option>

                        </select>
                    </div>

                    {["Released", "Watched"].includes(form.status) && (
                        <div>
                            <label className="block mb-1 font-medium text-gray-700">Release Date</label>
                            <input
                                name="releaseDate"
                                type="date"
                                className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                                value={form.releaseDate}
                                onChange={handleChange}
                                required
                            />
                        </div>
                    )}

                    {form.status === "Watched" && (
                        <div>
                            <label className="block mb-1 font-medium text-gray-700">Watch Date</label>
                            <input
                                name="watchDate"
                                type="date"
                                className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                                value={form.watchDate}
                                onChange={handleChange}
                                required
                            />
                        </div>
                    )}

                    <div>
                        <label className="block mb-1 font-medium text-gray-700">Genres</label>
                        <select
                            multiple
                            name="genres"
                            className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                            value={form.genres}
                            onChange={handleChange}
                            required
                        >
                            <option value="Action">🔫 Action</option>
                            <option value="Adventure">🧭 Adventure</option>
                            <option value="Animation">🎨 Animation</option>
                            <option value="Apocalyptic">🌍💥 Apocalyptic</option>
                            <option value="Biblical">📖 Biblical</option>
                            <option value="Body Horror">🧟‍♂️ Body Horror</option>
                            <option value="Biographical">👤 Biographical</option>
                            <option value="Comedy">😂 Comedy</option>
                            <option value="Crime">🕵️ Crime</option>
                            <option value="Dystopian">🧬 Dystopian</option>
                            <option value="Documentary">🎥 Documentary</option>
                            <option value="Disaster">🌪️ Disaster</option>
                            <option value="Erotic">💋 Erotic</option>
                            <option value="Epic">👑 Epic</option>
                            <option value="Family">👨‍👩‍👧‍👦 Family</option>
                            <option value="Fantasy">🧙 Fantasy</option>
                            <option value="Historical">🏰 Historical</option>
                            <option value="Horror">👻 Horror</option>
                            <option value="Gothic">🏰 Gothic</option>
                            <option value="Monster">👹 Monster</option>
                            <option value="Musical">🎶 Musical</option>
                            <option value="Mystery">🔍 Mystery</option>
                            <option value="Vampire">🧛‍♂️ Vampire</option>
                            <option value="Superhero">🦸 Superhero</option>
                            <option value="Supervillain">🦹‍♂️ Supervillain</option>
                            <option value="Martial arts">🥋 Martial Arts</option>
                            <option value="Romance">❤️ Romance</option>
                            <option value="Zombie">🧟 Zombie</option>
                            <option value="Sex">🔞 Sex</option>
                            <option value="Science Fiction">👽 Science Fiction</option>
                            <option value="Supernatural">👻 Supernatural</option>
                            <option value="Sport">🏅 Sport</option>
                            <option value="Drama">🎭 Drama</option>
                            <option value="Thriller">😱 Thriller</option>
                            <option value="War">⚔️ War</option>
                            <option value="Western">🤠 Western</option>
                            <option value="Anti-Western">🤠🚫 Anti-Western</option>
                        </select>
                    </div>

                    <div>
                        <label className="block mb-1 font-medium text-gray-700">Director</label>
                        <input
                            name="director"
                            type="text"
                            placeholder="Movie Director"
                            className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                            value={form.director}
                            onChange={handleChange}
                        />
                    </div>

                    <div>
                        <label className="block mb-1 font-medium text-gray-700">Casts</label>
                        <input
                            name="casts"
                            type="text"
                            placeholder="Movie Casts (e.g., A, B, C)"
                            className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                            value={form.casts}
                            onChange={handleChange}
                        />
                    </div>

                    {form.status === "Watched" && (
                        <div>
                            <label className="block mb-1 font-medium text-gray-700">Rating</label>
                            <select
                                name="rating"
                                className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                                value={form.rating}
                                onChange={handleChange}
                            >
                                <option value="Rewatchable">🔁 Rewatchable – 7/10</option>
                                <option value="Must Watch Again">🌟 Must Watch Again – 9/10</option>
                                <option value="Content Less">😐 Content Less – 4/10</option>

                            </select>
                        </div>
                    )}

                    {form.status === "Watched" && (
                        <div>
                            <label className="block mb-1 font-medium text-gray-700">Language</label>
                            <select
                                multiple
                                name="language"
                                className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                                value={form.language}
                                onChange={handleChange}
                                required
                            >
                                <option value="Bengali">🌺 Bengali</option>
                                <option value="Hindi">🕌 Hindi</option>
                                <option value="English">🇬🇧 English</option>
                            </select>
                        </div>
                    )}

                    {["Released", "Watched"].includes(form.status) && (
                        <div>
                            <label className="block mb-1 font-medium text-gray-700">Duration (in minutes)</label>
                            <input
                                name="duration"
                                type="number"
                                placeholder="Duration"
                                className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                                value={form.duration}
                                min={1}
                                onChange={handleChange}
                                required
                            />
                        </div>
                    )}

                    {["Released", "Watched"].includes(form.status) && (
                        <div>
                            <label className="block mb-1 font-medium text-gray-700">Awards</label>
                            <select
                                multiple
                                name="awards"
                                className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                                value={form.awards}
                                onChange={handleChange}
                            >
                                <option value="Academy Award">🏆 Academy Award</option>
                                <option value="Golden Globe Award">🌐 Golden Globe Award</option>
                                <option value="BAFTA Award">🎬 BAFTA Award</option>
                                <option value="Cannes Film Festival">🌟 Cannes Film Festival</option>
                                <option value="Critics' Choice Award">📝 Critics' Choice Award</option>
                                <option value="Saturn Award">🪐 Saturn Award</option>
                                <option value="Satellite Award">📡 Satellite Award</option>
                                <option value="MTV Award">🍿 MTV Movie & TV Award</option>
                                <option value="Golden Reel Award">🎧 Golden Reel Award</option>
                                <option value="Teen Choice Award">📱 Teen Choice Award</option>
                                <option value="Nickelodeon Kids' Choice Award">🟠 Nickelodeon Kids' Choice Award</option>
                                <option value="Golden Trailer Award">🎺 Golden Trailer Award</option>
                                <option value="National Film Award">🎞️ National Film Award</option>
                                <option value="Filmfare Award">🎤 Filmfare Award</option>
                                <option value="Golden Raspberry Award">🍇 Golden Raspberry Award</option>
                                <option value="Annie Award">🎨 Annie Award</option>
                                <option value="Scream Award">🎭🩸 Scream Award</option>
                                <option value="Sundance Film Festival">🎥 Sundance Film Festival</option>
                                <option value="Venice Film Festival">🎭 Venice Film Festival</option>
                                <option value="Berlin International Film Festival">🐻 Berlin International Film Festival</option>

                            </select>
                        </div>
                    )}

                    {form.status === "Watched" && (
                        <div>
                            <label className="block mb-1 font-medium text-gray-700">Tags</label>
                            <select
                                multiple
                                name="tags"
                                className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                                value={form.tags}
                                onChange={handleChange}
                            >
                                <option value="Based on True Story">📖 Based on True Story</option>
                                <option value="Cult Classic">🌀 Cult Classic</option>
                                <option value="Underrated">📉 Underrated</option>
                                <option value="Overrated">📈 Overrated</option>
                                <option value="Classic">🎞️ Classic</option>
                                <option value="Blockbuster">💥 Blockbuster</option>
                                <option value="Slow Burn">🔥 Slow Burn</option>
                                <option value="Feel Good">😊 Feel Good</option>
                                <option value="Coming of Age">🧒 Coming of Age</option>
                                <option value="Psychological">🧠 Psychological</option>
                                <option value="Plot Twist">🔀 Plot Twist</option>
                                <option value="Non-linear">🧩 Non-linear</option>
                                <option value="Violent">🩸 Violent</option>
                                <option value="Dark Humor">😈 Dark Humor</option>
                                <option value="Satirical">🪞 Satirical</option>
                                <option value="Award Winning">🏅 Award Winning</option>
                                <option value="Oscar Nominated">🥇 Oscar Nominated</option>
                                <option value="Festival Favorite">🎟️ Festival Favorite</option>
                                <option value="Critically Acclaimed">📢 Critically Acclaimed</option>
                                <option value="Hidden Gem">💎 Hidden Gem</option>
                                <option value="Flop">💔 Flop</option>
                                <option value="Indie">🎬 Indie</option>
                                <option value="Family Friendly">👨‍👩‍👧‍👦 Family Friendly</option>
                                <option value="Adult Only">🔞 Adult Only</option>
                                <option value="Foreign Language">🌍 Foreign Language</option>
                                <option value="Binge Worthy">📺 Binge Worthy</option>
                                <option value="Twist Ending">🎭 Twist Ending</option>
                                <option value="Character Driven">🧍 Character Driven</option>
                                <option value="Visually Stunning">🌈 Visually Stunning</option>
                                <option value="Underground">🌑 Underground</option>

                            </select>
                        </div>
                    )}

                    {["Released", "Watched"].includes(form.status) && (
                        <div>
                            <label className="block mb-1 font-medium text-gray-700">Country of Origin</label>
                            <select
                                multiple
                                name="countryOfOrigin"
                                className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                                value={form.countryOfOrigin}
                                onChange={handleChange}
                            >
                                <option value="United States">🇺🇸 United States</option>
                                <option value="United Kingdom">🇬🇧 United Kingdom</option>
                                <option value="India">🇮🇳 India</option>
                                <option value="Canada">🇨🇦 Canada</option>
                                <option value="Australia">🇦🇺 Australia</option>
                                <option value="France">🇫🇷 France</option>
                                <option value="Germany">🇩🇪 Germany</option>
                                <option value="Japan">🇯🇵 Japan</option>
                                <option value="China">🇨🇳 China</option>
                                <option value="South Korea">🇰🇷 South Korea</option>
                                <option value="Italy">🇮🇹 Italy</option>
                                <option value="Spain">🇪🇸 Spain</option>
                                <option value="Mexico">🇲🇽 Mexico</option>
                                <option value="Brazil">🇧🇷 Brazil</option>
                                <option value="Russia">🇷🇺 Russia</option>
                                <option value="Sweden">🇸🇪 Sweden</option>
                                <option value="Netherlands">🇳🇱 Netherlands</option>
                                <option value="Argentina">🇦🇷 Argentina</option>
                                <option value="Belgium">🇧🇪 Belgium</option>
                                <option value="Switzerland">🇨🇭 Switzerland</option>
                                <option value="Poland">🇵🇱 Poland</option>
                                <option value="Turkey">🇹🇷 Turkey</option>
                                <option value="Iran">🇮🇷 Iran</option>
                                <option value="Thailand">🇹🇭 Thailand</option>
                                <option value="South Africa">🇿🇦 South Africa</option>
                                <option value="New Zealand">🇳🇿 New Zealand</option>
                                <option value="Nigeria">🇳🇬 Nigeria</option>
                                <option value="Colombia">🇨🇴 Colombia</option>
                                <option value="Denmark">🇩🇰 Denmark</option>
                                <option value="Norway">🇳🇴 Norway</option>
                                <option value="Finland">🇫🇮 Finland</option>
                                <option value="Chile">🇨🇱 Chile</option>
                                <option value="Czech Republic">🇨🇿 Czech Republic</option>
                                <option value="Portugal">🇵🇹 Portugal</option>
                                <option value="Austria">🇦🇹 Austria</option>
                                <option value="Greece">🇬🇷 Greece</option>
                                <option value="Israel">🇮🇱 Israel</option>
                                <option value="Hungary">🇭🇺 Hungary</option>
                                <option value="Ukraine">🇺🇦 Ukraine</option>
                                <option value="Romania">🇷🇴 Romania</option>
                                <option value="Malaysia">🇲🇾 Malaysia</option>
                                <option value="Philippines">🇵🇭 Philippines</option>
                                <option value="Indonesia">🇮🇩 Indonesia</option>
                                <option value="Vietnam">🇻🇳 Vietnam</option>
                                <option value="Egypt">🇪🇬 Egypt</option>
                                <option value="Pakistan">🇵🇰 Pakistan</option>
                                <option value="Bangladesh">🇧🇩 Bangladesh</option>
                                <option value="Chile">🇨🇱 Chile</option>
                                <option value="Ireland">🇮🇪 Ireland</option>
                                <option value="Iceland">🇮🇸 Iceland</option>
                                <option value="Peru">🇵🇪 Peru</option>
                                <option value="Venezuela">🇻🇪 Venezuela</option>
                            </select>
                        </div>
                    )}

                    {["Released", "Watched", "Production Started"].includes(form.status) && (
                        <div>
                            <label className="block mb-1 font-medium text-gray-700">Production Companies (',' seperated)</label>
                            <input
                                name="productionCompany"
                                type="text"
                                placeholder="Production Company"
                                className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                                value={form.productionCompany}
                                onChange={handleChange}
                            />
                        </div>
                    )}

                    {["Released", "Watched"].includes(form.status) && (
                        <div>
                            <label className="block mb-1 font-medium text-gray-700">Standard Content Rating</label>
                            <select
                                multiple
                                name="contentRating"
                                className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                                value={form.contentRating}
                                onChange={handleChange}
                            >
                                <option value="G">🟢 G – General Audiences</option>
                                <option value="PG">🟡 PG – Parental Guidance</option>
                                <option value="PG-13">🟠 PG-13 – Parents Strongly Cautioned</option>
                                <option value="R">🔴 R – Restricted</option>
                                <option value="NC-17">⚫ NC-17 – Adults Only</option>
                                <option value="U">🟢 U – Universal (All Ages)</option>
                                <option value="U/A">🟡 U/A – Parental Guidance (Indian)</option>
                                <option value="A">🔴 A – Adults Only (Indian)</option>
                                <option value="S">⚫ S – Special Audience (Doctors, Lawyers)</option>
                                <option value="TV-Y">🧒 TV-Y – All Children</option>
                                <option value="TV-Y7">👦 TV-Y7 – Children 7 and Older</option>
                                <option value="TV-G">👨‍👩‍👧 TV-G – General Audience</option>
                                <option value="TV-PG">👨‍👧‍👦 TV-PG – Parental Guidance Suggested</option>
                                <option value="TV-14">🔞 TV-14 – Parents Strongly Cautioned</option>
                                <option value="TV-MA">🚫 TV-MA – Mature Audience Only</option>

                            </select>
                        </div>
                    )}

                    {!["Production Started", "Announced","Trailer Only"].includes(form.status) && (
                        <div>
                            <label className="block mb-1 font-medium text-gray-700">Poster URL</label>
                            <input
                                name="posterUrl"
                                type="text"
                                placeholder="Poster URL"
                                className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                                value={form.posterUrl}
                                onChange={handleChange}
                            />
                        </div>
                    )}

                    {!["Production Started", "Announced"].includes(form.status) && (
                        <div>
                            <label className="block mb-1 font-medium text-gray-700">Trailer URL (YouTube)</label>
                            <input
                                name="trailerUrl"
                                type="text"
                                placeholder="Trailer URL in Youtube"
                                className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                                value={form.trailerUrl}
                                onChange={handleChange}
                            />
                        </div>
                    )}

                    {["Released", "Watched"].includes(form.status) && (
                        <div>
                            <label className="block mb-1 font-medium text-gray-700">Summary</label>
                            <textarea
                                name="summary"
                                placeholder="Brief summary"
                                className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner resize-y min-h-[100px]"
                                value={form.summary}
                                onChange={handleChange}
                            />
                        </div>
                    )}

                    {form.status === "Watched" && (
                        <div>
                            <label className="block mb-1 font-medium text-gray-700">Source Names</label>
                            <select
                                multiple
                                name="sourceOfWatch"
                                className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                                value={form.sourceOfWatch}
                                onChange={handleChange}
                                required
                            >
                                <option value="Cinema">🎥 Cinema</option>
                                <option value="OTT Platform">📱 OTT Platform (e.g., Netflix, Prime)</option>
                                <option value="YouTube">▶️ YouTube</option>
                                <option value="Free Streaming Site">🆓 Free Streaming Site</option>
                                <option value="Torrent Download">💾 Torrent Download</option>
                                <option value="Piracy Website">⚠️ Piracy Website</option>
                                <option value="File Transfer">📂 File Transfer (USB/Drive)</option>
                                <option value="TV Broadcast">📺 TV Broadcast</option>
                                <option value="Blu-ray / DVD">📀 Blu-ray / DVD</option>
                                <option value="Online Rental">🛒 Online Rental</option>
                                <option value="Friend's Account">👥 Friend's Account</option>
                                <option value="Screening Event">🎟️ Screening Event / Festival</option>
                                <option value="School / Institution">🏫 School / Institution</option>
                                <option value="Hotel / Flight Entertainment">🛏️ Hotel / ✈️ Flight Entertainment</option>
                                <option value="Other">❓ Other</option>
                            </select>
                        </div>
                    )}

                    {Array.isArray(form.sourceOfWatch) &&
                        form.sourceOfWatch.some(source =>
                            ["YouTube", "Free Streaming Site", "Piracy Website", "File Transfer", "Torrent Download", "Blu-ray / DVD", "Other"].includes(source)
                        ) && (
                            <div>
                                <label className="block mb-1 font-medium text-gray-700">Reference</label>
                                <input
                                    name="sourceReference"
                                    type="text"
                                    placeholder='Link, USB, Webite.....'
                                    className="w-full p-2 border rounded bg-white text-gray-800 shadow-inner"
                                    value={form.sourceReference}
                                    onChange={handleChange}
                                    required
                                />
                            </div>
                        )}


                    <div className="flex justify-between">
                        <button type="button" onClick={onClose} className="text-gray-500">
                            Cancel
                        </button>
                        <button type="submit" className="bg-red-400 text-white px-4 py-2 rounded">
                            {!initialData ? 'Add Movie' : 'Update Movie'}
                        </button>
                    </div>
                </form>

            </div>
        </div>

    );
};

export default MovieForm;