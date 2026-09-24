import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { FaBell, FaBookmark, FaChartPie, FaFilm, FaHeart, FaSearch, FaTimes, FaTv } from 'react-icons/fa';
import Logo from './Logo';
import MenuItem from './MenuItem';

const API = import.meta.env.VITE_API_URL;

// Renders primary library navigation, global search, and unread notification count.
const Navbar = ({ menu, onSearch, selectedMenu, notificationSignal, busy }) => {
  const [activeNotifications, setActiveNotifications] = useState(0);
  const [searchValue,setSearchValue]=useState('');
  const [searchOpen,setSearchOpen]=useState(false);
  const searchInputRef=useRef(null);

  useEffect(() => {
    const timer=window.setTimeout(() => onSearch(searchValue.trim()),250);
    return () => window.clearTimeout(timer);
  },[searchValue,onSearch]);

  useEffect(() => { if (searchOpen) searchInputRef.current?.focus(); },[searchOpen]);

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
    <nav className={`main-nav ${busy ? 'nav-is-loading' : ''}`} aria-busy={busy}>
      <Logo />
      <div className="nav-links">
        {links.map(([text, icon]) => <MenuItem key={text} icon={icon} text={text} active={selectedMenu === text} onClick={() => menu(text)} />)}
      </div>
      <button type="button" className="mobile-search-toggle" aria-label="Open library search" title="Search the library" onClick={() => setSearchOpen(true)}><FaSearch /></button>
      <label className={`search-box ${searchOpen || searchValue ? 'mobile-search-open' : ''}`} title="Search titles, cast, movie directors, series credits, and production companies"><FaSearch /><input ref={searchInputRef} type="search" value={searchValue} placeholder="Search titles, cast, credits, companies…" onChange={(event) => setSearchValue(event.target.value)} /><button type="button" className="mobile-search-close" aria-label="Close search" title="Close search" onClick={() => { setSearchValue(''); setSearchOpen(false); }}><FaTimes /></button></label>
      <button className={`notification-button ${selectedMenu === 'Notifications' ? 'active' : ''}`} onClick={() => menu(selectedMenu === 'Notifications' ? 'Library' : 'Notifications')} aria-label={selectedMenu === 'Notifications' ? 'Return to library' : `${activeNotifications} unresolved notifications`} title={selectedMenu === 'Notifications' ? 'Return to library' : 'Open unresolved notifications'}>
        <FaBell />{activeNotifications > 0 && <span>{activeNotifications > 99 ? '99+' : activeNotifications}</span>}
      </button>
    </nav>
  );
};

export default Navbar;
