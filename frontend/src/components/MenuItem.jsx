import React from 'react';

// Renders one accessible primary navigation action.
const MenuItem = ({ icon, text, active, onClick }) => (
  <button type="button"
    onClick={onClick}
    className={`menu-item ${active ? 'active' : ''}`}
  >
    <span className="mr-3 text-lg">{icon}</span>
    <span className="font-medium">{text}</span>
  </button>
);

export default MenuItem;
