import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { FaHeartbeat, FaHistory, FaMoon, FaSun, FaTrashAlt } from 'react-icons/fa';

const API = import.meta.env.VITE_API_URL;

// Presents the product identity, local-library context, and appearance preferences.
const Header = ({ theme, fontFamily, onThemeChange, onFontChange, onNavigate, selectedMenu, trashSignal }) => {
  const [trashCount,setTrashCount] = useState(0);

  useEffect(() => {
    // Loads the recoverable-trash count for the header utility badge.
    const loadTrashCount = async () => {
      try { const response=await axios.get(`${API}/api/v1/content`,{ params:{ trashed:true,limit:1 } }); setTrashCount(response.data.total); }
      catch { setTrashCount(0); }
    };
    loadTrashCount();
    const interval=window.setInterval(loadTrashCount,60000);
    return () => window.clearInterval(interval);
  },[trashSignal]);

  return <header className="hero-header">
    <div><span className="eyebrow">YOUR PRIVATE SCREENING ROOM</span><h1>Cine<span>Vault</span></h1></div>
    <div className="header-preferences">
      <p>Films, series, seasons and every story you want to remember.</p>
      <div className="appearance-controls">
        <label className="font-control" title="Choose the interface font family"><span className="font-symbol" aria-hidden="true">A</span><select aria-label="Font family" value={fontFamily} onChange={(event) => onFontChange(event.target.value)}><option value="modern">Modern</option><option value="editorial">Editorial</option><option value="readable">Readable</option></select></label>
        <button type="button" onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? <FaSun /> : <FaMoon />}</button>
        <button type="button" className={`header-trash ${selectedMenu === 'Trash' ? 'active' : ''}`} onClick={() => onNavigate(selectedMenu === 'Trash' ? 'Library' : 'Trash')} aria-label={selectedMenu === 'Trash' ? `Return to library; ${trashCount} entries in trash` : `Open trash; ${trashCount} entries`} title={selectedMenu === 'Trash' ? 'Return to library' : 'Trash'}><FaTrashAlt />{trashCount > 0 && <span className="trash-count">{trashCount > 99 ? '99+' : trashCount}</span>}</button>
        <button type="button" className={`header-health ${selectedMenu === 'Data Health' ? 'active' : ''}`} onClick={() => onNavigate(selectedMenu === 'Data Health' ? 'Library' : 'Data Health')} aria-label={selectedMenu === 'Data Health' ? 'Return to library' : 'Open data health'} title={selectedMenu === 'Data Health' ? 'Return to library' : 'Data health'}><FaHeartbeat /></button>
        <button type="button" className={`header-activity ${selectedMenu === 'Activity' ? 'active' : ''}`} onClick={() => onNavigate(selectedMenu === 'Activity' ? 'Library' : 'Activity')} aria-label={selectedMenu === 'Activity' ? 'Return to library' : 'Open activity log'} title={selectedMenu === 'Activity' ? 'Return to library' : 'Activity log'}><FaHistory /></button>
      </div>
    </div>
  </header>;
};

export default Header;
