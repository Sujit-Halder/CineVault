import React from 'react';

// Replaces an unexpected component failure with a recoverable application screen.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state={ failed:false };
  }

  // Records that a descendant failed during rendering or an effect lifecycle.
  static getDerivedStateFromError() {
    return { failed:true };
  }

  // Reports component failures to the development console with their React stack.
  componentDidCatch(error,information) {
    console.error('CineVault interface error',error,information);
  }

  // Reloads the application from a clean component state.
  recover=() => {
    window.location.reload();
  };

  render() {
    if (this.state.failed) return <main className="error-page"><section><span className="eyebrow">INTERFACE RECOVERY</span><h1>CineVault needs a refresh</h1><p>Your library data is safe. Reload the interface to continue.</p><button className="primary-action" onClick={this.recover}>Reload CineVault</button></section></main>;
    return this.props.children;
  }
}
