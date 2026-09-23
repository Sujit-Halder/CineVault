const crypto=require('crypto');
const { database }=require('./database');
const { sendAccountLink }=require('./auth-mailer');

const legacyPassword=process.env.APP_PASSWORD || '';
const SESSION_HOURS=12;
let auditRecorder=() => {};

// Accepts the application audit writer without coupling security tests to database setup.
function setAuditRecorder(recorder) { auditRecorder=typeof recorder === 'function' ? recorder : () => {}; }

// Creates a stable one-way digest for session, invitation, and recovery secrets.
function tokenHash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }

// Derives one password hash using a unique salt and the memory-hard scrypt algorithm.
function passwordHash(value,salt) { return crypto.scryptSync(String(value || ''),salt,64).toString('hex'); }

// Validates the account password policy.
function validateNewPassword(value) {
    const password=String(value || '');
    if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
        throw Object.assign(new Error('Use at least 10 characters with uppercase, lowercase, and a number'),{ status:400 });
    }
    return password;
}

// Restricts the current registration policy to Gmail while keeping one normalized identifier.
function normalizeEmail(value) {
    const email=String(value || '').trim().toLowerCase();
    if (!/^[^\s@]+@gmail\.com$/.test(email)) throw Object.assign(new Error('Use a valid Gmail address'),{ status:400 });
    return email;
}

// Parses the request Cookie header.
function cookies(req) { return Object.fromEntries(String(req.headers?.cookie || '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((pair) => pair.length === 2)); }

// Records a security event without retaining raw credentials or tokens.
function recordSecurity(action,req,outcome,details={},account=null) {
    const raw=cookies(req).cinevault_session || '';
    try { auditRecorder(action,'authentication',account?.id || null,details,{ requestId:req.requestId,actor:account?.email || 'guest',outcome,metadata:{ sessionHash:raw ? tokenHash(raw).slice(0,16) : null } }); } catch {}
}

// Compares the legacy environment password for first-owner setup compatibility.
function validPassword(value) {
    if (!legacyPassword) return false;
    const expected=crypto.createHash('sha256').update(legacyPassword).digest();
    const supplied=crypto.createHash('sha256').update(String(value || '')).digest();
    return crypto.timingSafeEqual(expected,supplied);
}

// Reads and extends one valid persisted session.
function activeSession(req) {
    const raw=cookies(req).cinevault_session || '';
    if (!raw) return null;
    const row=database.prepare(`SELECT s.*,u.email,u.display_name,u.role,u.status FROM auth_sessions s JOIN app_users u ON u.id=s.user_id
        WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'`).get(tokenHash(raw),new Date().toISOString());
    if (!row) return null;
    const now=new Date(); const expiresAt=new Date(now.getTime()+SESSION_HOURS*3600000).toISOString();
    database.prepare('UPDATE auth_sessions SET last_seen_at=?,expires_at=? WHERE token_hash=?').run(now.toISOString(),expiresAt,row.token_hash);
    return { session:row,account:{ id:row.user_id,email:row.email,displayName:row.display_name,role:row.role } };
}

// Creates a persisted secure-cookie session for one account.
function establishSession(req,res,account) {
    const token=crypto.randomBytes(32).toString('base64url'); const csrf=crypto.randomBytes(24).toString('base64url'); const now=new Date();
    const expiresAt=new Date(now.getTime()+SESSION_HOURS*3600000).toISOString();
    database.prepare('INSERT INTO auth_sessions(token_hash,user_id,csrf_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)')
        .run(tokenHash(token),account.id,tokenHash(csrf),now.toISOString(),expiresAt,now.toISOString());
    const secure=process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.append('Set-Cookie',`cinevault_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${SESSION_HOURS*3600}${secure}`);
    res.append('Set-Cookie',`cinevault_csrf=${encodeURIComponent(csrf)}; SameSite=Strict; Path=/api; Max-Age=${SESSION_HOURS*3600}${secure}`);
    recordSecurity('auth.login-succeeded',{ ...req,headers:{ ...req.headers,cookie:`cinevault_session=${token}` } },'success',{ expiresInHours:SESSION_HOURS },account);
    return res.json({ enabled:true,authenticated:true,csrf,user:account });
}

// Protects API routes with persisted sessions and CSRF verification.
function authentication(req,res,next) {
    const active=activeSession(req);
    if (!active) { recordSecurity('auth.access-denied',req,'failure',{ path:req.path,method:req.method }); return res.status(401).json({ message:'Sign in to continue to CineVault' }); }
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && tokenHash(req.get('x-csrf-token')) !== active.session.csrf_hash) {
        recordSecurity('auth.csrf-rejected',req,'failure',{ path:req.path,method:req.method },active.account);
        return res.status(403).json({ message:'Your secure session could not be verified. Refresh and try again.' });
    }
    req.authenticatedUser=active.account.email; req.authenticatedUserId=active.account.id; req.authenticatedAccount=active.account;
    return next();
}

// Reports setup and authentication state without exposing account secrets.
function status(req,res) {
    const total=database.prepare('SELECT COUNT(*) count FROM app_users').get().count; const active=activeSession(req);
    const csrf=cookies(req).cinevault_csrf || '';
    return res.json({ enabled:true,setupRequired:total===0,authenticated:Boolean(active),...(active ? { csrf,user:active.account } : {}) });
}

// Creates the first owner and assigns every existing title to that private account.
function setup(req,res) {
    if (database.prepare('SELECT COUNT(*) count FROM app_users').get().count) return res.status(409).json({ message:'CineVault owner setup is already complete' });
    if (legacyPassword && !validPassword(req.body?.currentPassword)) return res.status(401).json({ message:'The current CineVault owner password is incorrect' });
    try {
        const email=normalizeEmail(req.body?.email); const displayName=String(req.body?.displayName || '').trim(); const password=validateNewPassword(req.body?.password);
        if (!displayName) throw Object.assign(new Error('Enter the owner display name'),{ status:400 });
        const id=crypto.randomUUID(); const salt=crypto.randomBytes(16).toString('hex'); const now=new Date().toISOString();
        database.exec('BEGIN IMMEDIATE');
        try {
            if (database.prepare('SELECT COUNT(*) count FROM app_users').get().count) throw Object.assign(new Error('CineVault owner setup was completed in another session'),{ status:409 });
            database.prepare("INSERT INTO app_users(id,email,display_name,password_hash,password_salt,role,status,created_at,updated_at) VALUES(?,?,?,?,?,'owner','active',?,?)")
                .run(id,email,displayName,passwordHash(password,salt),salt,now,now);
            database.prepare('UPDATE content_items SET owner_user_id=? WHERE owner_user_id IS NULL').run(id);
            database.prepare(`INSERT OR IGNORE INTO library_entries(id,user_id,content_id,personal_rating,favorite,created_at,updated_at,deleted_at)
                SELECT lower(hex(randomblob(16))),?,id,personal_rating,favorite,created_at,updated_at,deleted_at FROM content_items WHERE owner_user_id=?`).run(id,id);
            database.exec('COMMIT');
        } catch(error) { database.exec('ROLLBACK'); throw error; }
        return establishSession(req,res,{ id,email,displayName,role:'owner' });
    } catch(error) { return res.status(error.status || 500).json({ message:error.message || 'Owner setup failed' }); }
}

// Authenticates one active account by Gmail address and password.
function login(req,res) {
    try {
        const email=normalizeEmail(req.body?.email); const user=database.prepare("SELECT * FROM app_users WHERE email=? COLLATE NOCASE AND status='active'").get(email);
        if (!user) throw Object.assign(new Error('Email or password is incorrect'),{ status:401 });
        const supplied=Buffer.from(passwordHash(req.body?.password,user.password_salt),'hex'); const expected=Buffer.from(user.password_hash,'hex');
        if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied,expected)) throw Object.assign(new Error('Email or password is incorrect'),{ status:401 });
        const now=new Date().toISOString(); database.prepare('UPDATE app_users SET last_login_at=?,updated_at=? WHERE id=?').run(now,now,user.id);
        return establishSession(req,res,{ id:user.id,email:user.email,displayName:user.display_name,role:user.role });
    } catch(error) { recordSecurity('auth.login-failed',req,'failure',{ reason:error.message }); return res.status(error.status || 400).json({ message:error.message }); }
}

// Issues one invitation to a Gmail address on behalf of the owner account.
async function invite(req,res) {
    if (req.authenticatedAccount?.role !== 'owner') return res.status(403).json({ message:'Only the CineVault owner can invite another viewer' });
    try {
        const email=normalizeEmail(req.body?.email);
        if (database.prepare('SELECT 1 FROM app_users WHERE email=? COLLATE NOCASE').get(email)) throw Object.assign(new Error('That Gmail address already has a CineVault account'),{ status:409 });
        const token=crypto.randomBytes(32).toString('base64url'); const now=new Date(); const expiresAt=new Date(now.getTime()+48*3600000).toISOString();
        database.prepare('DELETE FROM auth_invitations WHERE email=? COLLATE NOCASE AND accepted_at IS NULL').run(email);
        database.prepare('INSERT INTO auth_invitations(id,email,token_hash,invited_by,expires_at,created_at) VALUES(?,?,?,?,?,?)')
            .run(crypto.randomUUID(),email,tokenHash(token),req.authenticatedUserId,expiresAt,now.toISOString());
        const base=(process.env.WEBSITE || 'http://localhost:3000').split(',')[0].trim().replace(/\/$/,'');
        const delivery=await sendAccountLink({ to:email,subject:'Your private CineVault invitation',heading:'A place for your watch history',message:'The CineVault owner invited you to create a private library.',url:`${base}/?invite=${encodeURIComponent(token)}` });
        recordSecurity('auth.invitation-created',req,'success',{ email,expiresInHours:48,delivery:delivery.preview ? 'development-preview' : 'accepted-by-gmail',messageId:delivery.messageId || null,smtpResponse:delivery.response || null },req.authenticatedAccount);
        return res.status(201).json({ message:delivery.preview ? `Invitation preview created for ${email}` : `Gmail accepted the invitation for delivery to ${email}`,expiresAt });
    } catch(error) { recordSecurity('auth.invitation-failed',req,'failure',{ reason:error.code || error.message },req.authenticatedAccount); return res.status(error.status || 502).json({ message:error.message || 'Invitation could not be sent' }); }
}

// Accepts one unexpired invitation and creates an isolated member account.
function signup(req,res) {
    try {
        const token=String(req.body?.token || ''); const invitation=database.prepare('SELECT * FROM auth_invitations WHERE token_hash=? AND accepted_at IS NULL AND expires_at>?').get(tokenHash(token),new Date().toISOString());
        if (!invitation) throw Object.assign(new Error('This invitation is invalid or has expired'),{ status:400 });
        const email=normalizeEmail(req.body?.email); if (email !== invitation.email.toLowerCase()) throw Object.assign(new Error('Use the Gmail address that received this invitation'),{ status:400 });
        const displayName=String(req.body?.displayName || '').trim(); if (!displayName) throw Object.assign(new Error('Enter your display name'),{ status:400 });
        const password=validateNewPassword(req.body?.password); const salt=crypto.randomBytes(16).toString('hex'); const id=crypto.randomUUID(); const now=new Date().toISOString();
        database.exec('BEGIN IMMEDIATE');
        try {
            database.prepare("INSERT INTO app_users(id,email,display_name,password_hash,password_salt,role,status,created_at,updated_at) VALUES(?,?,?,?,?,'member','active',?,?)")
                .run(id,email,displayName,passwordHash(password,salt),salt,now,now);
            database.prepare('UPDATE auth_invitations SET accepted_at=? WHERE id=?').run(now,invitation.id); database.exec('COMMIT');
        } catch(error) { database.exec('ROLLBACK'); throw error; }
        recordSecurity('auth.invitation-accepted',req,'success',{}, { id,email,displayName,role:'member' });
        return establishSession(req,res,{ id,email,displayName,role:'member' });
    } catch(error) { return res.status(error.status || (error.code?.includes('CONSTRAINT') ? 409 : 500)).json({ message:error.message || 'Account could not be created' }); }
}

// Sends a single-use password recovery link without revealing account existence.
async function forgotPassword(req,res) {
    const response={ message:'If that Gmail address belongs to CineVault, a recovery link has been sent.' };
    try {
        const email=normalizeEmail(req.body?.email); const user=database.prepare("SELECT * FROM app_users WHERE email=? COLLATE NOCASE AND status='active'").get(email);
        if (!user) return res.json(response);
        const token=crypto.randomBytes(32).toString('base64url'); const now=new Date(); const expiresAt=new Date(now.getTime()+3600000).toISOString();
        database.prepare('UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL').run(now.toISOString(),user.id);
        database.prepare('INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)')
            .run(crypto.randomUUID(),user.id,tokenHash(token),expiresAt,now.toISOString());
        const base=(process.env.WEBSITE || 'http://localhost:3000').split(',')[0].trim().replace(/\/$/,'');
        await sendAccountLink({ to:email,subject:'Reset your CineVault password',heading:'Return to your private library',message:'Use this secure link within one hour to choose a new password.',url:`${base}/?reset=${encodeURIComponent(token)}` });
        recordSecurity('auth.password-reset-requested',req,'success',{}, { id:user.id,email:user.email });
    } catch(error) { if (error.status !== 400) recordSecurity('auth.password-reset-email-failed',req,'failure',{ reason:error.message }); }
    return res.json(response);
}

// Replaces a password after consuming one valid recovery token.
function resetPassword(req,res) {
    try {
        const token=String(req.body?.token || ''); const row=database.prepare('SELECT * FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?').get(tokenHash(token),new Date().toISOString());
        if (!row) throw Object.assign(new Error('This recovery link is invalid or has expired'),{ status:400 });
        const password=validateNewPassword(req.body?.password); const salt=crypto.randomBytes(16).toString('hex'); const now=new Date().toISOString();
        database.exec('BEGIN IMMEDIATE');
        try {
            database.prepare('UPDATE app_users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?').run(passwordHash(password,salt),salt,now,row.user_id);
            database.prepare('UPDATE password_reset_tokens SET used_at=? WHERE id=?').run(now,row.id);
            database.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(row.user_id); database.exec('COMMIT');
        } catch(error) { database.exec('ROLLBACK'); throw error; }
        recordSecurity('auth.password-reset-completed',req,'success',{}, { id:row.user_id });
        return res.json({ message:'Password updated. Sign in to continue.' });
    } catch(error) { return res.status(error.status || 500).json({ message:error.message || 'Password could not be reset' }); }
}

// Invalidates the current session and expires both authentication cookies.
function logout(req,res) {
    const raw=cookies(req).cinevault_session || ''; const active=activeSession(req);
    if (raw) database.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(tokenHash(raw));
    recordSecurity('auth.logout',req,'success',{},active?.account);
    res.append('Set-Cookie','cinevault_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0');
    res.append('Set-Cookie','cinevault_csrf=; SameSite=Strict; Path=/api; Max-Age=0');
    res.status(204).end();
}

module.exports={ authentication,status,setup,login,invite,signup,forgotPassword,resetPassword,logout,validPassword,cookies,setAuditRecorder };
