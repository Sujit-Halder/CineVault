import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { FaBell, FaBookmark, FaChartPie, FaFilm, FaHeart, FaSearch, FaTv } from 'react-icons/fa';
import Logo from './Logo';
import MenuItem from './MenuItem';

const API = import.meta.env.VITE_API_URL;

// Renders primary library navigation, global search, and unread notification count.
const Navbar = ({ menu, onSearch, selectedMenu, notificationSignal }) => {
  const [activeNotifications, setActiveNotifications] = useState(0);

  useEffect(() => {
    // Loads the unread notification count for the navigation badge.
    const loadActiveNotifications = async () => {
      try {
        const response = await axios.get(`${API}/api/v1/notifications`);
        setActiveNotifications(response.data.notifications.length);
      } catch { setActiveNotifications(0); }
    };
    loadActiveNotifications();
    const interval = window.setInterval(loadActiveNotifications, 60000);
    return () => window.clearInterval(interval);
  }, [notificationSignal]);

  const links = [
    ['Library', <FaFilm key="library" />], ['Movies', <FaFilm key="movies" />], ['Series', <FaTv key="series" />],
    ['Favorites', <FaHeart key="favorites" />], ['Watch Later', <FaBookmark key="later" />],
    ['Statistics', <FaChartPie key="statistics" />],
  ];

  return (
    <nav className="main-nav">
      <Logo />
      <div className="nav-links">
        {links.map(([text, icon]) => <MenuItem key={text} icon={icon} text={text} active={selectedMenu === text} onClick={() => menu(text)} />)}
      </div>
      <label className="search-box" title="Search titles, cast, movie directors, series credits, and production companies"><FaSearch /><input type="search" placeholder="Search title, cast, director, series credit, production company…" onChange={(event) => onSearch(event.target.value.trim())} /></label>
      <button className={`notification-button ${selectedMenu === 'Notifications' ? 'active' : ''}`} onClick={() => menu(selectedMenu === 'Notifications' ? 'Library' : 'Notifications')} aria-label={selectedMenu === 'Notifications' ? 'Return to library' : `${activeNotifications} unresolved notifications`} title={selectedMenu === 'Notifications' ? 'Return to library' : 'Open unresolved notifications'}>
        <FaBell />{activeNotifications > 0 && <span>{activeNotifications > 99 ? '99+' : activeNotifications}</span>}
      </button>
    </nav>
  );
};

export default Navbar;
