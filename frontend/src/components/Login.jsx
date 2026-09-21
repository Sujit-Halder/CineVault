import React, { useState } from 'react';
import axios from 'axios';

const API=import.meta.env.VITE_API_URL;

// Authenticates the private library owner through the server's secure session cookie.
export default function Login({ onAuthenticated }) {
  const [password,setPassword]=useState(''); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  const submit=async (event) => { event.preventDefault(); setLoading(true); setError(''); try { const response=await axios.post(`${API}/api/auth/login`,{ password },{ withCredentials:true }); sessionStorage.setItem('cinevault-csrf',response.data.csrf || ''); onAuthenticated(); } catch(errorResponse) { setError(errorResponse.response?.data?.message || 'Sign-in failed'); } finally { setLoading(false); } };
  return <main className="login-page"><form className="login-card" onSubmit={submit}><span className="eyebrow">PRIVATE LIBRARY</span><h1>Welcome back</h1><p>Enter the owner password to open CineVault.</p><label>Password<input autoFocus required type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>{error && <p role="alert" className="field-error">{error}</p>}<button className="primary-action" disabled={loading}>{loading ? 'Opening…' : 'Open library'}</button></form></main>;
}
