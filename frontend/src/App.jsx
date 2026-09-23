import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Header from './components/Header';
import Navbar from './components/Navbar';
import Content from './components/Content';
import Footer from './components/Footer';
import Login from './components/Login';

const API = import.meta.env.VITE_API_URL;
axios.defaults.withCredentials=true;
axios.interceptors.request.use((config) => { const csrf=sessionStorage.getItem('cinevault-csrf'); if (csrf && !['get','head','options'].includes(config.method)) config.headers['X-CSRF-Token']=csrf; return config; });

// Coordinates navigation, search, and the notification drawer for the application shell.
function App() {
  const [selectedMenu, setSelectedMenu] = useState('Library');
  const [searchTerm, setSearchTerm] = useState('');
  const [notificationSignal, setNotificationSignal] = useState(0);
  const [trashSignal,setTrashSignal] = useState(0);
  const [theme, setTheme] = useState(() => localStorage.getItem('cinevault-theme') || 'dark');
  const [fontFamily, setFontFamily] = useState(() => localStorage.getItem('cinevault-font') || 'modern');
  const [authentication,setAuthentication]=useState({ loading:true,authenticated:false });

  useEffect(() => { axios.get(`${API}/api/auth/status`).then((response) => { if (response.data.csrf) sessionStorage.setItem('cinevault-csrf',response.data.csrf); setAuthentication({ loading:false,...response.data }); }).catch(() => setAuthentication({ loading:false,authenticated:false,setupRequired:false })); },[]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.font = fontFamily;
    localStorage.setItem('cinevault-theme', theme);
    localStorage.setItem('cinevault-font', fontFamily);
  }, [theme, fontFamily]);

  useEffect(() => {
    if (!authentication.authenticated) return undefined;
    // Starts one full asset scan for this browser session and refreshes notifications when it finishes.
    let stopped=false;
    let timer;
    const poll = async () => {
      try {
        const response=await axios.get(`${API}/api/v1/asset-scan`);
        if (response.data.status === 'complete' || response.data.status === 'failed') {
          if (!stopped) setNotificationSignal((value) => value + 1);
          return;
        }
      } catch { return; }
      if (!stopped) timer=window.setTimeout(poll,5000);
    };
    axios.post(`${API}/api/v1/session/connect`).then(() => poll()).catch(() => {});
    return () => { stopped=true; window.clearTimeout(timer); };
  },[authentication.authenticated]);

  if (authentication.loading) return <div className="empty-state">Opening your private library…</div>;
  if (!authentication.authenticated) return <Login setupRequired={authentication.setupRequired} onAuthenticated={(result) => setAuthentication({ loading:false,...result })} />;
  return (
    <div className="app-shell">
      <Header theme={theme} fontFamily={fontFamily} onThemeChange={setTheme} onFontChange={setFontFamily} onNavigate={setSelectedMenu} selectedMenu={selectedMenu} trashSignal={trashSignal} user={authentication.user} onSignedOut={() => { sessionStorage.removeItem('cinevault-csrf'); setAuthentication({ loading:false,authenticated:false,setupRequired:false }); }} />
      <Navbar menu={setSelectedMenu} onSearch={setSearchTerm} selectedMenu={selectedMenu} notificationSignal={notificationSignal} />
      <main><Content selectedMenu={selectedMenu} searchTerm={searchTerm} onNavigate={setSelectedMenu} onNotificationsChanged={() => setNotificationSignal((value) => value + 1)} onTrashChanged={() => setTrashSignal((value) => value + 1)} /></main>
      <Footer />
    </div>
  );
}

export default App;
