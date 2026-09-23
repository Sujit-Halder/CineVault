import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { FaEye, FaEyeSlash, FaFilm, FaLock, FaEnvelope } from 'react-icons/fa';

const API=import.meta.env.VITE_API_URL;

// Presents invitation-only setup, sign-in, account activation, and password recovery.
export default function Login({ setupRequired=false,onAuthenticated }) {
  const query=useMemo(() => new URLSearchParams(window.location.search),[]);
  const invitationToken=query.get('invite') || ''; const resetToken=query.get('reset') || '';
  const [mode,setMode]=useState(setupRequired ? 'setup' : invitationToken ? 'signup' : resetToken ? 'reset' : 'signin');
  const [email,setEmail]=useState(''); const [displayName,setDisplayName]=useState(''); const [password,setPassword]=useState('');
  const [confirmation,setConfirmation]=useState(''); const [currentPassword,setCurrentPassword]=useState(''); const [showPassword,setShowPassword]=useState(false);
  const [message,setMessage]=useState(''); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  const headings={ setup:'Create the owner account',signin:'Welcome back',signup:'Accept your invitation',forgot:'Find your way back',reset:'Choose a new password' };

  // Clears feedback and switches between sign-in and recovery without exposing registration.
  const changeMode=(next) => { setMode(next); setError(''); setMessage(''); };

  // Sends the form to the authentication endpoint represented by the active portal mode.
  const submit=async (event) => {
    event.preventDefault(); setLoading(true); setError(''); setMessage('');
    try {
      if (['setup','signup','reset'].includes(mode) && password !== confirmation) throw new Error('The two passwords do not match');
      if (mode === 'forgot') { const response=await axios.post(`${API}/api/auth/forgot-password`,{ email }); setMessage(response.data.message); return; }
      if (mode === 'reset') { const response=await axios.post(`${API}/api/auth/reset-password`,{ token:resetToken,password }); window.history.replaceState({},'',window.location.pathname); changeMode('signin'); setMessage(response.data.message); return; }
      const route=mode === 'setup' ? 'setup' : mode === 'signup' ? 'signup' : 'login';
      const payload=mode === 'setup' ? { email,displayName,password,currentPassword } : mode === 'signup' ? { token:invitationToken,email,displayName,password } : { email,password };
      const response=await axios.post(`${API}/api/auth/${route}`,payload,{ withCredentials:true });
      sessionStorage.setItem('cinevault-csrf',response.data.csrf || ''); window.history.replaceState({},'',window.location.pathname); onAuthenticated(response.data);
    } catch(errorResponse) { setError(errorResponse.response?.data?.message || errorResponse.message || 'CineVault could not complete that request'); }
    finally { setLoading(false); }
  };

  return <main className="login-page">
    <section className="login-brand" aria-label="CineVault introduction"><span className="login-mark"><FaFilm /></span><span className="eyebrow">YOUR PRIVATE SCREENING ROOM</span><h1>Cine<span>Vault</span></h1><p>A carefully kept record of every film, series, episode and viewing that matters to you.</p><div className="login-privacy"><FaLock /><span>Invitation-only accounts. Every member receives an isolated private library.</span></div></section>
    <form className="login-card" onSubmit={submit}>
      <span className="eyebrow">{mode === 'setup' ? 'FIRST-RUN SETUP' : mode === 'signup' ? 'INVITED MEMBER' : mode === 'reset' ? 'SECURE RECOVERY' : 'PRIVATE LIBRARY'}</span><h2>{headings[mode]}</h2>
      <p>{mode === 'setup' ? 'Claim the existing library and create its first owner.' : mode === 'signup' ? 'Use the Gmail address that received this private invitation.' : mode === 'forgot' ? 'We will send a single-use recovery link if this account exists.' : mode === 'reset' ? 'Use a strong password you have not used for this library before.' : 'Sign in with the Gmail address connected to your CineVault account.'}</p>
      {['setup','signup'].includes(mode) && <label>Display name<input required autoFocus value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" placeholder="How CineVault should address you" /></label>}
      {mode !== 'reset' && <label>Gmail address<span className="input-with-icon"><FaEnvelope aria-hidden="true"/><input required autoFocus={!['setup','signup'].includes(mode)} type="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete={mode === 'signin' ? 'username' : 'email'} placeholder="name@gmail.com" /></span></label>}
      {mode === 'setup' && <label>Current owner password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" placeholder="Current APP_PASSWORD" /></label>}
      {mode !== 'forgot' && <label>{mode === 'signin' ? 'Password' : 'New password'}<span className="password-input"><input required type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder={mode === 'signin' ? 'Your password' : '10+ characters, mixed case and a number'} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <FaEyeSlash/> : <FaEye/>}</button></span></label>}
      {['setup','signup','reset'].includes(mode) && <label>Confirm password<input required type={showPassword ? 'text' : 'password'} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" /></label>}
      {error && <p role="alert" className="field-error">{error}</p>}{message && <p role="status" className="field-success">{message}</p>}
      <button className="primary-action" disabled={loading}>{loading ? 'Working…' : mode === 'setup' ? 'Create owner & open library' : mode === 'signup' ? 'Create my private library' : mode === 'forgot' ? 'Send recovery link' : mode === 'reset' ? 'Update password' : 'Open library'}</button>
      {!setupRequired && mode === 'signin' && <button type="button" className="text-action" onClick={() => changeMode('forgot')}>Forgot password?</button>}
      {!setupRequired && mode === 'forgot' && <button type="button" className="text-action" onClick={() => changeMode('signin')}>Back to sign in</button>}
      {!setupRequired && mode === 'signin' && <small>New accounts are created only through an owner invitation.</small>}
    </form>
  </main>;
}
