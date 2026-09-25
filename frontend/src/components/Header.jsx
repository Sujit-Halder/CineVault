import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { FaHeartbeat, FaHistory, FaMoon, FaSun, FaTrashAlt, FaUserPlus, FaSignOutAlt, FaTimes, FaUserMinus, FaUsersCog } from 'react-icons/fa';

const API = import.meta.env.VITE_API_URL;

// Presents the product identity, local-library context, and appearance preferences.
const Header = ({ theme, fontFamily, onThemeChange, onFontChange, onNavigate, onOpenTitle, selectedMenu, trashSignal, librarySignal, user, onSignedOut }) => {
  const [trashCount,setTrashCount] = useState(0);
  const [anniversaries,setAnniversaries]=useState([]);
  const [inviting,setInviting]=useState(false); const [inviteEmail,setInviteEmail]=useState(''); const [inviteMessage,setInviteMessage]=useState(''); const [inviteError,setInviteError]=useState('');
  const [inviteSending,setInviteSending]=useState(false);
  const [removing,setRemoving]=useState(false); const [removalCodeSent,setRemovalCodeSent]=useState(false); const [removalCode,setRemovalCode]=useState(''); const [removalConfirmation,setRemovalConfirmation]=useState('');
  const [permanentRemoval,setPermanentRemoval]=useState(false);
  const [removalBusy,setRemovalBusy]=useState(false); const [removalMessage,setRemovalMessage]=useState(''); const [removalError,setRemovalError]=useState('');

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

  useEffect(() => {
    // Loads release milestones for the viewer's current calendar date.
    let midnightTimer;
    const loadAnniversaries=() => {
      const now=new Date();
      const date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
      axios.get(`${API}/api/v1/anniversaries`,{ params:{ date } }).then((response) => setAnniversaries(response.data.anniversaries || [])).catch(() => setAnniversaries([]));
      window.clearTimeout(midnightTimer);
      const nextDay=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,0,0,2);
      midnightTimer=window.setTimeout(loadAnniversaries,nextDay.getTime()-now.getTime());
    };
    loadAnniversaries();
    window.addEventListener('focus',loadAnniversaries);
    return () => { window.clearTimeout(midnightTimer); window.removeEventListener('focus',loadAnniversaries); };
  },[librarySignal]);

  // Sends one time-limited invitation from the owner account.
  const sendInvitation=async (event) => { event.preventDefault(); if (inviteSending) return; setInviteSending(true); setInviteError(''); setInviteMessage('Sending the private invitation…'); try { const response=await axios.post(`${API}/api/auth/invitations`,{ email:inviteEmail }); setInviteMessage(response.data.message); setInviteEmail(''); } catch(error) { setInviteMessage(''); setInviteError(error.response?.data?.message || 'Invitation could not be sent'); } finally { setInviteSending(false); } };

  // Closes the current persisted session and returns to the sign-in portal.
  const signOut=async () => { try { await axios.post(`${API}/api/auth/logout`); } finally { onSignedOut(); } };

  // Requests a short-lived mailbox code before account removal is permitted.
  const requestRemovalCode=async () => {
    if (removalBusy) return;
    setRemovalBusy(true); setRemovalError(''); setRemovalMessage('Sending the removal code…');
    try { const response=await axios.post(`${API}/api/v1/account/deletion/request`); setRemovalCodeSent(true); setRemovalMessage(response.data.message); }
    catch(error) { setRemovalMessage(''); setRemovalError(error.response?.data?.message || 'The removal code could not be sent'); }
    finally { setRemovalBusy(false); }
  };

  // Downloads the final private archive and signs out after verified deletion.
  const removeAccount=async (event) => {
    event.preventDefault(); if (removalBusy) return;
    setRemovalBusy(true); setRemovalError(''); setRemovalMessage('Preparing your archive and removing the account…');
    try {
      const response=await axios.post(`${API}/api/v1/account/deletion/confirm`,{ verificationCode:removalCode },{ responseType:'blob' });
      const disposition=response.headers['content-disposition'] || ''; const match=disposition.match(/filename="?([^";]+)"?/i);
      const url=URL.createObjectURL(response.data); const link=document.createElement('a'); link.href=url; link.download=match?.[1] || 'cinevault.account-archive.complete.json'; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url),1000);
      await axios.post(`${API}/api/v1/account/deletion/finalize`,{ verificationCode:removalCode,permanent:permanentRemoval });
      sessionStorage.removeItem('cinevault-csrf'); onSignedOut();
    } catch(error) {
      let detail=error.response?.data;
      if (detail instanceof Blob) { try { detail=JSON.parse(await detail.text()); } catch { detail=null; } }
      setRemovalMessage(''); setRemovalError(detail?.message || 'The account could not be removed');
    } finally { setRemovalBusy(false); }
  };

  return <header className="hero-header">
    <div><span className="eyebrow">YOUR PRIVATE SCREENING ROOM</span><div className="hero-title-lockup"><h1>Cine<span>Vault</span></h1><span className="hero-title-plus" aria-hidden="true">+</span><span className="hero-title-motion" aria-label="Track, remember and rediscover every story"><span>Track every story</span><span>Remember every watch</span><span>Rediscover favourites</span></span></div></div>
    <div className="header-preferences">
      <p>Films, series, seasons and every story you want to remember.</p>
      <div className="appearance-controls">
        <div className="appearance-primary">
        <label className="font-control" title="Choose the interface font family"><span className="font-symbol" aria-hidden="true">A</span><select aria-label="Font family" value={fontFamily} onChange={(event) => onFontChange(event.target.value)}><option value="modern">Modern</option><option value="editorial">Editorial</option><option value="readable">Readable</option></select></label>
        <button type="button" onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? <FaSun /> : <FaMoon />}</button>
        </div>
        <div className="header-utilities" aria-label="Account and library tools">
        <button type="button" className={`header-trash ${selectedMenu === 'Trash' ? 'active' : ''}`} onClick={() => onNavigate(selectedMenu === 'Trash' ? 'Library' : 'Trash')} aria-label={selectedMenu === 'Trash' ? `Return to library; ${trashCount} entries in trash` : `Open trash; ${trashCount} entries`} title={selectedMenu === 'Trash' ? 'Return to library' : 'Trash'}><FaTrashAlt />{trashCount > 0 && <span className="trash-count">{trashCount > 99 ? '99+' : trashCount}</span>}</button>
        <button type="button" className={`header-health ${selectedMenu === 'Data Health' ? 'active' : ''}`} onClick={() => onNavigate(selectedMenu === 'Data Health' ? 'Library' : 'Data Health')} aria-label={selectedMenu === 'Data Health' ? 'Return to library' : 'Open data health'} title={selectedMenu === 'Data Health' ? 'Return to library' : 'Data health'}><FaHeartbeat /></button>
        <button type="button" className={`header-activity ${selectedMenu === 'Activity' ? 'active' : ''}`} onClick={() => onNavigate(selectedMenu === 'Activity' ? 'Library' : 'Activity')} aria-label={selectedMenu === 'Activity' ? 'Return to library' : 'Open activity log'} title={selectedMenu === 'Activity' ? 'Return to library' : 'Activity log'}><FaHistory /></button>
        {user?.role === 'owner' && <button type="button" onClick={() => setInviting(true)} aria-label="Invite a member" title="Invite a member"><FaUserPlus /></button>}
        {user?.role === 'owner' && <button type="button" className={selectedMenu === 'Accounts' ? 'active' : ''} onClick={() => onNavigate(selectedMenu === 'Accounts' ? 'Library' : 'Accounts')} aria-label={selectedMenu === 'Accounts' ? 'Return to library' : 'Open account management'} title={selectedMenu === 'Accounts' ? 'Return to library' : 'Accounts and security'}><FaUsersCog /></button>}
        <button type="button" onClick={() => { setPermanentRemoval(user?.role === 'owner'); setRemoving(true); }} aria-label="Remove account" title="Remove this account and download its private archive"><FaUserMinus /></button>
        <button type="button" onClick={signOut} aria-label={`Sign out ${user?.displayName || ''}`} title="Sign out"><FaSignOutAlt /></button>
        </div>
      </div>
    </div>
    {anniversaries.length > 0 && <div className="anniversary-ticker" role="region" aria-label={anniversaries.map((item) => `${item.title} celebrates ${item.years} years since release`).join('. ')} title="Milestone release anniversaries"><div className="anniversary-track"><span>{anniversaries.map((item) => <React.Fragment key={item.id}>A milestone worth revisiting — <b>{item.years} years</b> since <button type="button" className="anniversary-title" title={`Open ${item.title} in the library`} onClick={() => onOpenTitle(item.id)}>{item.title}</button>{' '}first reached screens — celebrate the stories that stay with us<i aria-hidden="true">◆</i></React.Fragment>)}</span><span aria-hidden="true">{anniversaries.map((item) => <React.Fragment key={`repeat-${item.id}`}>A milestone worth revisiting — <b>{item.years} years</b> since <button type="button" tabIndex="-1" className="anniversary-title" title={`Open ${item.title} in the library`} onClick={() => onOpenTitle(item.id)}>{item.title}</button>{' '}first reached screens — celebrate the stories that stay with us<i>◆</i></React.Fragment>)}</span></div></div>}
    {inviting && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => !inviteSending && event.target === event.currentTarget && setInviting(false)}><section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title"><button type="button" className="dialog-close" disabled={inviteSending} onClick={() => setInviting(false)} aria-label="Close invitation" title="Close"><FaTimes/></button><span className="eyebrow">INVITATION-ONLY ACCESS</span><h2 id="invite-title">Invite a CineVault member</h2><p>They will receive a 48-hour link to create an isolated private library at any valid email address.</p><form onSubmit={sendInvitation}><label>Email address<input autoFocus required disabled={inviteSending} type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="member@example.com" /></label>{inviteError && <p className="field-error" role="alert">{inviteError}</p>}{inviteMessage && <p className="field-success" role="status">{inviteMessage}</p>}<button className="primary-action" disabled={inviteSending} aria-busy={inviteSending}>{inviteSending ? 'Sending invitation…' : 'Send private invitation'}</button></form></section></div>}
    {removing && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => !removalBusy && event.target === event.currentTarget && setRemoving(false)}><section className="account-dialog removal-dialog" role="dialog" aria-modal="true" aria-labelledby="removal-title"><button type="button" className="dialog-close" disabled={removalBusy} onClick={() => setRemoving(false)} aria-label="Close account removal" title="Keep this account"><FaTimes/></button><span className="eyebrow">PROTECTED ACCOUNT REMOVAL</span><h2 id="removal-title">Remove this CineVault account</h2><p>CineVault first provides a complete JSON archive. By default, member access is disabled for 14 days so the owner can restore the account before permanent deletion.</p>{user?.role === 'owner' && <p className="removal-owner-note">The final owner must use immediate permanent deletion after removing all member accounts; otherwise no authorized owner would remain to restore it.</p>}<form onSubmit={removeAccount}>{!removalCodeSent && <button type="button" className="secondary-action" disabled={removalBusy} aria-busy={removalBusy} onClick={requestRemovalCode}>{removalBusy ? 'Sending code…' : 'Send account-removal code'}</button>}{removalCodeSent && <><label>Email verification code<input required autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength="6" pattern="[0-9]{6}" value={removalCode} onChange={(event) => setRemovalCode(event.target.value.replace(/\D/g,'').slice(0,6))} placeholder="6-digit code" /></label><label className="danger-choice" title={user?.role === 'owner' ? 'Required because no owner would remain to restore this account' : 'Skips the 14-day recovery window and cannot be undone'}><input type="checkbox" disabled={user?.role === 'owner'} checked={permanentRemoval} onChange={(event) => setPermanentRemoval(event.target.checked)}/><span>Permanently delete immediately instead of using the 14-day recovery window</span></label><label>To confirm, type DELETE MY ACCOUNT<input required autoComplete="off" value={removalConfirmation} onChange={(event) => setRemovalConfirmation(event.target.value)} placeholder="DELETE MY ACCOUNT" /></label><button className="danger-action" disabled={removalBusy || removalCode.length !== 6 || removalConfirmation !== 'DELETE MY ACCOUNT'} aria-busy={removalBusy}>{removalBusy ? 'Preparing archive…' : permanentRemoval ? 'Download archive & delete permanently' : 'Download archive & schedule removal'}</button></>}{removalError && <p className="field-error" role="alert">{removalError}</p>}{removalMessage && <p className="field-success" role="status">{removalMessage}</p>}</form></section></div>}
  </header>;
};

export default Header;
