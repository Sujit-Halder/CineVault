import React from 'react';

// Displays asset-health notifications and opens the affected entry for editing.
const NotificationPanel = ({ notifications, onOpen, onClose }) => (
  <aside className="notification-panel" aria-label="Asset notifications" aria-live="polite">
    <div className="panel-heading"><div><span className="eyebrow">MEDIA HEALTH</span><h2>Notifications</h2></div><button onClick={onClose}>Close</button></div>
    {notifications.length === 0 ? <p className="empty-state">Poster and trailer links look healthy.</p> : notifications.map((notification) => (
      <button className={`notification-row ${notification.read ? '' : 'unread'}`} aria-label={`${notification.read ? '' : 'Unread: '}${notification.title}; ${notification.assetType} ${notification.status}; ${notification.reason}`} key={notification.id} onClick={() => onOpen(notification)}>
        <span className="notification-dot" />
        <span><strong>{notification.title}</strong><small>{notification.assetType} · {notification.status} · {notification.reason}</small></span>
        <span aria-hidden="true">→</span>
      </button>
    ))}
  </aside>
);

export default NotificationPanel;
