import React, { useState } from 'react';
import Logo from './Logo';
import { FaSearch, FaHome, FaBookmark, FaHeart, FaSignOutAlt } from "react-icons/fa";
import MenuItem from './MenuItem';

const Navbar = ({ menu, onSearch }) => {
    const [activeItem, setActiveItem] = useState('Home');

    const handleMenuClick = (menuName) => {
        setActiveItem(menuName);
        menu(menuName);
    };

    return (
        <div className='sticky top-0 z-30 bg-green-950 text-white font-bold shadow-md px-4 py-3 rounded m-2'>
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                {/* Logo */}
                <Logo />

                {/* Nav Links */}
                <div className='flex gap-4 flex-wrap justify-center'>
                    <MenuItem
                        icon={<FaHome />}
                        text="Home"
                        active={activeItem === 'Home'}
                        onClick={() => handleMenuClick('Home')}
                    />
                    <MenuItem
                        icon={<FaHeart />}
                        text="Favorites"
                        active={activeItem === 'Favorites'}
                        onClick={() => handleMenuClick('Favorites')}
                    />
                    <MenuItem
                        icon={<FaBookmark />}
                        text="Watch Later"
                        active={activeItem === 'Watch Later'}
                        onClick={() => handleMenuClick('Watch Later')}
                    />
                </div>

                {/* Search and Close */}
                <div className='flex items-center gap-4 relative'>
                    <div className="relative bg-white rounded-lg font-light">
                        <FaSearch className="absolute top-1/2 left-3 transform -translate-y-1/2 text-red-400" />
                        <input
                            name="search"
                            type="text"
                            placeholder="Search your movie based on title cast director country production company..."
                            className="pl-10 pr-4 py-2 rounded-lg border text-sm w-200 focus:w-204 transition-all duration-300 text-black"
                            onChange={(e) => onSearch(e.target.value.trim().toLowerCase())}
                        />
                    </div>
                    {/* <MenuItem
                        icon={<FaSignOutAlt />}
                        text="Close"
                        active={activeItem === 'Close'}
                        onClick={() => handleMenuClick('Close')}
                    /> */}
                </div>
            </div>
        </div>
    );
};

export default Navbar;
