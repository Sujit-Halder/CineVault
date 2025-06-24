import React from 'react';

const MenuItem = ({ icon, text, active, onClick }) => (
  <div
    onClick={onClick}
    className={`flex items-center px-4 py-2 rounded-lg cursor-pointer transition-colors duration-200 ${
      active ? 'bg-white text-red-500' : 'hover:bg-red-300'
    }`}
  >
    <span className="mr-3 text-lg">{icon}</span>
    <span className="font-medium">{text}</span>
  </div>
);

export default MenuItem;
