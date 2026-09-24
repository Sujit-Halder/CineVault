import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { FaEye, FaEyeSlash, FaFilm, FaLock, FaEnvelope } from 'react-icons/fa';

const API=import.meta.env.VITE_API_URL;

// Presents invitation-only setup, sign-in, account activation, and password recovery.
export default function Login({ setupRequired=false,onAuthenticated }) {
  const query=useMemo(() => new URLSearchParams(window.location.search),[]);
  const invitationToken=query.get('invite') || ''; const resetToken=query.get('reset') || ''; const invitedEmail=(query.get('email') || '').trim().toLowerCase();
  const [mode,setMode]=useState(setupRequired ? 'setup' : invitationToken ? 'signup' : resetToken ? 'reset' : 'signin');
  const [email,setEmail]=useState(invitationToken ? invitedEmail : ''); const [displayName,setDisplayName]=useState(''); const [password,setPassword]=useState('');
  const [confirmation,setConfirmation]=useState(''); const [currentPassword,setCurrentPassword]=useState(''); const [showPassword,setShowPassword]=useState(false);
  const [message,setMessage]=useState(''); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  const [verificationCode,setVerificationCode]=useState(''); const [verificationSent,setVerificationSent]=useState(false); const [verificationSending,setVerificationSending]=useState(false);
  const headings={ setup:'Create the owner account',signin:'Welcome back',signup:'Accept your invitation',forgot:'Find your way back',reset:'Choose a new password' };
  const creatingPassword=['setup','signup','reset'].includes(mode);
  const passwordScore=password ? [password.length >= 10,/[a-z]/.test(password),/[A-Z]/.test(password),/\d/.test(password),/[^A-Za-z0-9]/.test(password),password.length >= 14].filter(Boolean).length : 0;
  const passwordStrength=!password ? 'Not entered' : passwordScore <= 2 ? 'Weak' : passwordScore <= 4 ? 'Fair' : passwordScore === 5 ? 'Strong' : 'Excellent';

  // Clears feedback and switches between sign-in and recovery without exposing registration.
  const changeMode=(next) => { setMode(next); setPassword(''); setConfirmation(''); setCurrentPassword(''); setShowPassword(false); setVerificationCode(''); setVerificationSent(false); setError(''); setMessage(''); };

  // Sends a short-lived code to prove control of the invited mailbox.
  const sendVerificationCode=async () => {
    if (verificationSending) return;
    setVerificationSending(true); setError(''); setMessage('Sending the verification code…');
    try { const response=await axios.post(`${API}/api/auth/invitations/verify-email`,{ token:invitationToken,email }); setVerificationSent(true); setMessage(response.data.message); }
    catch(errorResponse) { setMessage(''); setError(errorResponse.response?.data?.message || 'The verification code could not be sent'); }
    finally { setVerificationSending(false); }
  };

  // Sends the form to the authentication endpoint represented by the active portal mode.
  const submit=async (event) => {
    event.preventDefault(); setLoading(true); setError(''); setMessage('');
    try {
      if (['setup','signup','reset'].includes(mode) && password !== confirmation) throw new Error('The two passwords do not match');
      if (mode === 'forgot') { const response=await axios.post(`${API}/api/auth/forgot-password`,{ email }); setMessage(response.data.message); return; }
      if (mode === 'reset') { const response=await axios.post(`${API}/api/auth/reset-password`,{ token:resetToken,password }); window.history.replaceState({},'',window.location.pathname); changeMode('signin'); setMessage(response.data.message); return; }
      const route=mode === 'setup' ? 'setup' : mode === 'signup' ? 'signup' : 'login';
      const payload=mode === 'setup' ? { email,displayName,password,currentPassword } : mode === 'signup' ? { token:invitationToken,email,displayName,password,verificationCode } : { email,password };
      const response=await axios.post(`${API}/api/auth/${route}`,payload,{ withCredentials:true });
      sessionStorage.setItem('cinevault-csrf',response.data.csrf || ''); window.history.replaceState({},'',window.location.pathname); onAuthenticated(response.data);
    } catch(errorResponse) { setError(errorResponse.response?.data?.message || errorResponse.message || 'CineVault could not complete that request'); }
    finally { setLoading(false); }
  };

  return <main className="login-page">
    <section className="login-brand" aria-label="CineVault introduction"><span className="login-mark"><FaFilm /></span><span className="eyebrow">YOUR PRIVATE SCREENING ROOM</span><h1>Cine<span>Vault</span></h1><p>A carefully kept record of every film, series, episode and viewing that matters to you.</p><div className="login-privacy"><FaLock /><span>Invitation-only accounts. Every member receives an isolated private library.</span></div></section>
    <form className="login-card" onSubmit={submit}>
      <span className="eyebrow">{mode === 'setup' ? 'FIRST-RUN SETUP' : mode === 'signup' ? 'INVITED MEMBER' : mode === 'reset' ? 'SECURE RECOVERY' : 'PRIVATE LIBRARY'}</span><h2>{headings[mode]}</h2>
      <p>{mode === 'setup' ? 'Claim the existing library and create its first owner.' : mode === 'signup' ? 'Enter the code CineVault sends to the email address bound to this invitation.' : mode === 'forgot' ? 'CineVault will send a single-use recovery link if this account exists.' : mode === 'reset' ? 'Choose a strong password that has not been used for this library before.' : 'Sign in with the email address connected to this CineVault account.'}</p>
      {['setup','signup'].includes(mode) && <label>Display name<input required autoFocus value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" placeholder="How CineVault should address you" /></label>}
      {mode !== 'reset' && <label>Email address<span className={`input-with-icon ${mode === 'signup' && invitedEmail ? 'locked-input' : ''}`} title={mode === 'signup' && invitedEmail ? 'This invitation is securely bound to the email address selected by the CineVault owner' : undefined}><FaEnvelope aria-hidden="true"/><input required readOnly={mode === 'signup' && Boolean(invitedEmail)} aria-readonly={mode === 'signup' && Boolean(invitedEmail)} autoFocus={!['setup','signup'].includes(mode)} type="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete={mode === 'signin' ? 'username' : 'email'} placeholder="name@example.com" />{mode === 'signup' && invitedEmail && <FaLock className="locked-field-icon" aria-label="Invitation email locked"/>}</span>{mode === 'signup' && invitedEmail && <small className="locked-field-help">This invitation can create an account only for this email address.</small>}</label>}
      {mode === 'signup' && <div className="verification-panel"><button type="button" className="secondary-action" disabled={verificationSending || !email} aria-busy={verificationSending} onClick={sendVerificationCode}>{verificationSending ? 'Sending code…' : verificationSent ? 'Resend verification code' : 'Send verification code'}</button>{verificationSent && <label>Email verification code<input required autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength="6" pattern="[0-9]{6}" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g,'').slice(0,6))} placeholder="6-digit code" /></label>}<small>The code is sent only to the invited mailbox and expires after 10 minutes.</small></div>}
      {mode === 'setup' && <label>Current owner password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" placeholder="Current APP_PASSWORD" /></label>}
      {mode !== 'forgot' && <label>{mode === 'signin' ? 'Password' : 'New password'}<span className="password-input"><input key={`${mode}-password`} required type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder={mode === 'signin' ? 'Your password' : '10+ characters, mixed case and a number'} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <FaEyeSlash/> : <FaEye/>}</button></span></label>}
      {creatingPassword && <div className="password-strength" data-score={passwordScore} title="Use at least 10 characters with uppercase and lowercase letters plus a number. For stronger protection, use 14 or more characters and add a symbol."><div className="password-strength-heading"><span>Password strength</span><strong>{passwordStrength}</strong><button type="button" aria-label="Strong password guidance" title="Required: at least 10 characters, one uppercase letter, one lowercase letter and one number. Recommended: 14+ characters, a symbol, and no reused password.">?</button></div><div className="password-strength-track" role="progressbar" aria-label="Password strength" aria-valuemin="0" aria-valuemax="6" aria-valuenow={passwordScore}><span /></div><small>10+ characters · uppercase · lowercase · number. Prefer 14+ characters and a symbol.</small></div>}
      {['setup','signup','reset'].includes(mode) && <label>Confirm password<input required type={showPassword ? 'text' : 'password'} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" /></label>}
      {error && <p role="alert" className="field-error">{error}</p>}{message && <p role="status" className="field-success">{message}</p>}
      <button className="primary-action" disabled={loading || (mode === 'signup' && (!verificationSent || verificationCode.length !== 6))}>{loading ? 'Working…' : mode === 'setup' ? 'Create owner & open library' : mode === 'signup' ? 'Verify & create private library' : mode === 'forgot' ? 'Send recovery link' : mode === 'reset' ? 'Update password' : 'Open library'}</button>
      {!setupRequired && mode === 'signin' && <button type="button" className="text-action" onClick={() => changeMode('forgot')}>Forgot password?</button>}
      {!setupRequired && mode === 'forgot' && <button type="button" className="text-action" onClick={() => changeMode('signin')}>Back to sign in</button>}
      {!setupRequired && mode === 'signin' && <small>New accounts are created only through an owner invitation.</small>}
    </form>
  </main>;
}
