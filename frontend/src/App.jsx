import React, { useState } from 'react';
import Header from './components/Header';
import Navbar from './components/Navbar';
import Content from './components/Content';
import Footer from './components/Footer';

function App() {
  const [selectedMenu, setSelectedMenu] = useState('Home');
  const [searchTerm, setSearchTerm] = useState('');

  return (
    <div className="flex flex-col h-screen bg-gray-200">
      <Header />
      <Navbar menu={setSelectedMenu} onSearch={setSearchTerm} />
      <div className="flex-grow overflow-auto">
        <Content selectedMenu={selectedMenu} searchTerm={searchTerm} />
      </div>
      <Footer />
    </div>
  );
}

export default App;
