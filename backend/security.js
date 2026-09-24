const crypto=require('crypto');
const { database,createBackup }=require('./database');
const { sendAccountLink,sendAccountCode,sendAccountNotice }=require('./auth-mailer');
const Model=require('./model');

const legacyPassword=process.env.APP_PASSWORD || '';
const SESSION_HOURS=12;
let auditRecorder=() => {};

// Accepts the application audit writer without coupling security tests to database setup.
function setAuditRecorder(recorder) { auditRecorder=typeof recorder === 'function' ? recorder : () => {}; }

// Creates a stable one-way digest for session, invitation, and recovery secrets.
function tokenHash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }

// Creates one six-digit code suitable for short-lived mailbox verification.
function verificationCode() { return String(crypto.randomInt(0,1000000)).padStart(6,'0'); }

// Applies a persistent, endpoint-specific limit without retaining raw email addresses or network identifiers.
function enforceSecurityRate(scope,key,maximum,windowMinutes) {
    const keyHash=tokenHash(String(key || 'unknown').toLowerCase()); const now=new Date();
    const row=database.prepare('SELECT * FROM security_rate_limits WHERE scope=? AND key_hash=?').get(scope,keyHash);
    if (!row || now-new Date(row.window_started_at) >= windowMinutes*60000) {
        database.prepare(`INSERT INTO security_rate_limits(scope,key_hash,window_started_at,attempts) VALUES(?,?,?,1)
            ON CONFLICT(scope,key_hash) DO UPDATE SET window_started_at=excluded.window_started_at,attempts=1`).run(scope,keyHash,now.toISOString()); return;
    }
    if (row.attempts >= maximum) throw Object.assign(new Error('Too many security requests. Wait before trying again.'),{ status:429 });
    database.prepare('UPDATE security_rate_limits SET attempts=attempts+1 WHERE scope=? AND key_hash=?').run(scope,keyHash);
}

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

// Validates and normalizes an account email address from any mail provider.
function normalizeEmail(value) {
    const email=String(value || '').trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw Object.assign(new Error('Use a valid email address'),{ status:400 });
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

// Authenticates one active account by email address and password.
function login(req,res) {
    try {
        const email=normalizeEmail(req.body?.email); const user=database.prepare("SELECT * FROM app_users WHERE email=? COLLATE NOCASE AND status='active'").get(email);
        enforceSecurityRate('login',`${req.ip || 'local'}:${email}`,10,15);
        if (!user) throw Object.assign(new Error('Email or password is incorrect'),{ status:401 });
        const supplied=Buffer.from(passwordHash(req.body?.password,user.password_salt),'hex'); const expected=Buffer.from(user.password_hash,'hex');
        if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied,expected)) throw Object.assign(new Error('Email or password is incorrect'),{ status:401 });
        const now=new Date().toISOString(); database.prepare('UPDATE app_users SET last_login_at=?,updated_at=? WHERE id=?').run(now,now,user.id);
        return establishSession(req,res,{ id:user.id,email:user.email,displayName:user.display_name,role:user.role });
    } catch(error) { recordSecurity('auth.login-failed',req,'failure',{ reason:error.message }); return res.status(error.status || 400).json({ message:error.message }); }
}

// Issues one invitation to an email address on behalf of the owner account.
async function invite(req,res) {
    if (req.authenticatedAccount?.role !== 'owner') return res.status(403).json({ message:'Only the CineVault owner can invite another viewer' });
    try {
        const email=normalizeEmail(req.body?.email);
        enforceSecurityRate('invitation',`${req.authenticatedUserId}:${email}`,5,60);
        if (database.prepare('SELECT 1 FROM app_users WHERE email=? COLLATE NOCASE').get(email)) throw Object.assign(new Error('That email address already has a CineVault account'),{ status:409 });
        const token=crypto.randomBytes(32).toString('base64url'); const now=new Date(); const expiresAt=new Date(now.getTime()+48*3600000).toISOString();
        database.prepare('DELETE FROM auth_invitations WHERE email=? COLLATE NOCASE AND accepted_at IS NULL').run(email);
        database.prepare('INSERT INTO auth_invitations(id,email,token_hash,invited_by,expires_at,created_at) VALUES(?,?,?,?,?,?)')
            .run(crypto.randomUUID(),email,tokenHash(token),req.authenticatedUserId,expiresAt,now.toISOString());
        const base=(process.env.WEBSITE || 'http://localhost:3000').split(',')[0].trim().replace(/\/$/,'');
        const delivery=await sendAccountLink({ to:email,subject:'Your private CineVault invitation',heading:'A place for your watch history',message:'The CineVault owner invited you to create a private library.',url:`${base}/?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}` });
        database.prepare('UPDATE auth_invitations SET delivery_status=?,delivery_message_id=?,delivery_response=? WHERE email=? COLLATE NOCASE AND accepted_at IS NULL')
            .run(delivery.preview ? 'preview' : 'accepted',delivery.messageId || '',delivery.response || '',email);
        recordSecurity('auth.invitation-created',req,'success',{ email,expiresInHours:48,delivery:delivery.preview ? 'development-preview' : 'accepted-by-mail-provider',messageId:delivery.messageId || null,smtpResponse:delivery.response || null },req.authenticatedAccount);
        return res.status(201).json({ message:delivery.preview ? `Invitation preview created for ${email}` : `Invitation accepted for delivery to ${email}`,expiresAt });
    } catch(error) { recordSecurity('auth.invitation-failed',req,'failure',{ reason:error.code || error.message },req.authenticatedAccount); return res.status(error.status || 502).json({ message:error.message || 'Invitation could not be sent' }); }
}

// Sends a second-factor code to the mailbox bound to an invitation.
async function verifyInvitation(req,res) {
    try {
        const token=String(req.body?.token || ''); const email=normalizeEmail(req.body?.email);
        enforceSecurityRate('invitation-code',`${req.ip || 'local'}:${email}`,5,15);
        const invitation=database.prepare('SELECT * FROM auth_invitations WHERE token_hash=? AND accepted_at IS NULL AND expires_at>?').get(tokenHash(token),new Date().toISOString());
        if (!invitation || invitation.email.toLowerCase() !== email) throw Object.assign(new Error('This invitation is invalid, expired, or bound to another email address'),{ status:400 });
        if (invitation.verification_sent_at && Date.now()-new Date(invitation.verification_sent_at).getTime() < 60000) throw Object.assign(new Error('Wait one minute before requesting another code'),{ status:429 });
        const code=verificationCode(); const now=new Date(); const expiresAt=new Date(now.getTime()+10*60000).toISOString();
        await sendAccountCode({ to:email,subject:'Verify your CineVault invitation',heading:'Confirm your invited email',code,minutes:10 });
        database.prepare('UPDATE auth_invitations SET verification_hash=?,verification_expires_at=?,verification_sent_at=?,verification_attempts=0 WHERE id=?')
            .run(tokenHash(`${token}:${code}`),expiresAt,now.toISOString(),invitation.id);
        recordSecurity('auth.invitation-code-sent',req,'success',{ email },{ id:invitation.invited_by,email:'owner' });
        return res.json({ message:`CineVault sent a six-digit verification code to ${email}`,expiresAt });
    } catch(error) { recordSecurity('auth.invitation-code-failed',req,'failure',{ reason:error.code || error.message }); return res.status(error.status || 502).json({ message:error.message || 'Verification code could not be sent' }); }
}

// Accepts one unexpired invitation and creates an isolated member account.
function signup(req,res) {
    try {
        const token=String(req.body?.token || ''); const invitation=database.prepare('SELECT * FROM auth_invitations WHERE token_hash=? AND accepted_at IS NULL AND expires_at>?').get(tokenHash(token),new Date().toISOString());
        if (!invitation) throw Object.assign(new Error('This invitation is invalid or has expired'),{ status:400 });
        const email=normalizeEmail(req.body?.email); if (email !== invitation.email.toLowerCase()) throw Object.assign(new Error('Use the email address that received this invitation'),{ status:400 });
        const code=String(req.body?.verificationCode || '').trim();
        if (invitation.verification_attempts >= 5) throw Object.assign(new Error('Too many incorrect codes. Request a new verification code.'),{ status:429 });
        if (!/^\d{6}$/.test(code) || !invitation.verification_hash || invitation.verification_expires_at <= new Date().toISOString() || tokenHash(`${token}:${code}`) !== invitation.verification_hash) {
            database.prepare('UPDATE auth_invitations SET verification_attempts=verification_attempts+1 WHERE id=?').run(invitation.id);
            throw Object.assign(new Error('The email verification code is incorrect or expired'),{ status:400 });
        }
        const displayName=String(req.body?.displayName || '').trim(); if (!displayName) throw Object.assign(new Error('Enter your display name'),{ status:400 });
        const password=validateNewPassword(req.body?.password); const salt=crypto.randomBytes(16).toString('hex'); const id=crypto.randomUUID(); const now=new Date().toISOString();
        database.exec('BEGIN IMMEDIATE');
        try {
            database.prepare("INSERT INTO app_users(id,email,display_name,password_hash,password_salt,role,status,created_at,updated_at) VALUES(?,?,?,?,?,'member','active',?,?)")
                .run(id,email,displayName,passwordHash(password,salt),salt,now,now);
            database.prepare("UPDATE auth_invitations SET accepted_at=?,delivery_status='activated' WHERE id=?").run(now,invitation.id); database.exec('COMMIT');
        } catch(error) { database.exec('ROLLBACK'); throw error; }
        recordSecurity('auth.invitation-accepted',req,'success',{}, { id,email,displayName,role:'member' });
        return establishSession(req,res,{ id,email,displayName,role:'member' });
    } catch(error) { return res.status(error.status || (error.code?.includes('CONSTRAINT') ? 409 : 500)).json({ message:error.message || 'Account could not be created' }); }
}

// Sends a short-lived code before an authenticated account can remove itself.
async function requestAccountDeletion(req,res) {
    try {
        const account=req.authenticatedAccount;
        enforceSecurityRate('account-removal',account.id,5,60);
        if (account.role === 'owner' && database.prepare("SELECT COUNT(*) count FROM app_users WHERE id<>? AND status='active'").get(account.id).count) throw Object.assign(new Error('Transfer ownership or remove all member accounts before deleting the owner account'),{ status:409 });
        const previous=database.prepare('SELECT created_at FROM account_deletion_challenges WHERE user_id=?').get(account.id);
        if (previous && Date.now()-new Date(previous.created_at).getTime() < 60000) throw Object.assign(new Error('Wait one minute before requesting another removal code'),{ status:429 });
        const code=verificationCode(); const now=new Date(); const expiresAt=new Date(now.getTime()+10*60000).toISOString();
        await sendAccountCode({ to:account.email,subject:'Confirm CineVault account removal',heading:'Account removal verification',code,minutes:10 });
        database.prepare(`INSERT INTO account_deletion_challenges(user_id,otp_hash,expires_at,attempts,created_at) VALUES(?,?,?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET otp_hash=excluded.otp_hash,expires_at=excluded.expires_at,attempts=0,created_at=excluded.created_at`)
            .run(account.id,tokenHash(`${account.id}:${code}`),expiresAt,0,now.toISOString());
        recordSecurity('auth.account-deletion-code-sent',req,'success',{},account);
        return res.json({ message:`CineVault sent a six-digit account-removal code to ${account.email}`,expiresAt });
    } catch(error) { recordSecurity('auth.account-deletion-code-failed',req,'failure',{ reason:error.code || error.message },req.authenticatedAccount); return res.status(error.status || 502).json({ message:error.message || 'The account-removal code could not be sent' }); }
}

// Downloads a complete archive after verification while preserving the account until the client confirms receipt.
async function confirmAccountDeletion(req,res) {
    const account=req.authenticatedAccount;
    try {
        const challenge=database.prepare('SELECT * FROM account_deletion_challenges WHERE user_id=?').get(account.id); const code=String(req.body?.verificationCode || '').trim();
        if (!challenge || challenge.expires_at <= new Date().toISOString() || challenge.attempts >= 5 || !/^\d{6}$/.test(code) || tokenHash(`${account.id}:${code}`) !== challenge.otp_hash) {
            if (challenge) database.prepare('UPDATE account_deletion_challenges SET attempts=attempts+1 WHERE user_id=?').run(account.id);
            throw Object.assign(new Error('The account-removal code is incorrect or expired'),{ status:400 });
        }
        if (account.role === 'owner' && database.prepare('SELECT COUNT(*) count FROM app_users WHERE id<>?').get(account.id).count) throw Object.assign(new Error('The owner account cannot be removed while other accounts exist'),{ status:409 });
        const active=Model.buildExportPayload({ format:'complete',scope:'Account removal archive' });
        const trash=Model.buildExportPayload({ format:'complete',scope:'Account removal archive',query:{ trashed:true } });
        const arrayKeys=['content','seasons','episodes','watchHistory','episodeWatchHistory','contentLinks','seriesCredits'];
        const archive={ ...active,scope:'Account removal archive',isSubset:false,account:{ email:account.email,displayName:account.displayName,role:account.role },exportedAt:new Date().toISOString() };
        arrayKeys.forEach((key) => { archive[key]=[...(active[key] || []),...(trash[key] || [])]; });
        archive.contentCount=archive.content.length;
        archive.integrity={ algorithm:'SHA-256',checksum:tokenHash(JSON.stringify(archive)) };
        const preparedAt=new Date().toISOString();
        recordSecurity('auth.account-deletion-archive-prepared',req,'success',{ contentCount:archive.contentCount,archive:'browser-download' },account);
        const filename=`cinevault.account-archive.complete.${preparedAt.replace(/[:.]/g,'-')}.json`;
        res.setHeader('Content-Type','application/json; charset=utf-8'); res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
        return res.send(JSON.stringify(archive,null,2));
    } catch(error) { recordSecurity('auth.account-deletion-failed',req,'failure',{ reason:error.message },account); return res.status(error.status || 500).json({ message:error.message || 'The account could not be removed' }); }
}

// Permanently removes an account only after the browser confirms that its archive response was received.
async function finalizeAccountDeletion(req,res) {
    const account=req.authenticatedAccount;
    try {
        const challenge=database.prepare('SELECT * FROM account_deletion_challenges WHERE user_id=?').get(account.id); const code=String(req.body?.verificationCode || '').trim();
        if (!challenge || challenge.expires_at <= new Date().toISOString() || challenge.attempts >= 5 || !/^\d{6}$/.test(code) || tokenHash(`${account.id}:${code}`) !== challenge.otp_hash) throw Object.assign(new Error('The account-removal verification expired before deletion completed'),{ status:400 });
        if (account.role === 'owner' && database.prepare('SELECT COUNT(*) count FROM app_users WHERE id<>?').get(account.id).count) throw Object.assign(new Error('The owner account cannot be removed while other accounts exist'),{ status:409 });
        const contentCount=database.prepare('SELECT COUNT(*) count FROM content_items WHERE owner_user_id=?').get(account.id).count; const permanent=req.body?.permanent === true;
        if (account.role === 'owner' && !permanent) throw Object.assign(new Error('The final owner cannot use scheduled deletion because no owner would remain to restore it'),{ status:400 });
        const owner=database.prepare("SELECT email FROM app_users WHERE role='owner' ORDER BY created_at LIMIT 1").get(); const removedAt=new Date().toISOString();
        if (!permanent) {
            const scheduledAt=new Date(Date.now()+14*86400000).toISOString();
            database.prepare("UPDATE app_users SET status='disabled',deletion_requested_at=?,deletion_scheduled_at=?,updated_at=? WHERE id=?").run(removedAt,scheduledAt,removedAt,account.id);
            database.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(account.id);
            recordSecurity('auth.account-deletion-scheduled',req,'success',{ contentCount,scheduledAt,archive:'browser-download-confirmed' },account);
            try { await sendAccountNotice({ to:owner?.email || account.email,subject:'CineVault account removal scheduled',heading:'Account removal scheduled',message:`CineVault scheduled ${account.displayName} (${account.email}) for permanent removal on ${scheduledAt}. The owner can restore the account before that time.` }); } catch {}
            res.append('Set-Cookie','cinevault_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0'); res.append('Set-Cookie','cinevault_csrf=; SameSite=Strict; Path=/api; Max-Age=0');
            return res.json({ message:'The account is scheduled for deletion in 14 days',scheduledAt });
        }
        recordSecurity('auth.account-deletion-completed',req,'success',{ contentCount,archive:'browser-download-confirmed' },account);
        database.exec('BEGIN IMMEDIATE');
        try { database.prepare('DELETE FROM content_items WHERE owner_user_id=?').run(account.id); database.prepare('DELETE FROM app_users WHERE id=?').run(account.id); database.exec('COMMIT'); }
        catch(error) { database.exec('ROLLBACK'); throw error; }
        const anonymous=`deleted-user:${tokenHash(account.id).slice(0,12)}`;
        database.prepare("UPDATE audit_log SET actor=?,details_json=replace(details_json,?,'[deleted account]'),metadata_json=replace(metadata_json,?,'[deleted account]') WHERE actor=? OR details_json LIKE ? OR metadata_json LIKE ?")
            .run(anonymous,account.email,account.email,account.email,`%${account.email}%`,`%${account.email}%`);
        try { await sendAccountNotice({ to:owner?.email || account.email,subject:'CineVault account removed',heading:'Account removal completed',message:`CineVault confirms that ${account.displayName} (${account.email}) removed their account on ${removedAt}. The member's browser received a complete JSON archive containing ${contentCount} titles before CineVault deleted the account data.` }); }
        catch(error) { recordSecurity('auth.account-deletion-notice-failed',req,'failure',{ reason:error.message,removedEmail:account.email },null); }
        res.append('Set-Cookie','cinevault_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0'); res.append('Set-Cookie','cinevault_csrf=; SameSite=Strict; Path=/api; Max-Age=0');
        return res.json({ message:'Your CineVault account and private library were permanently removed' });
    } catch(error) { recordSecurity('auth.account-deletion-failed',req,'failure',{ reason:error.message },account); return res.status(error.status || 500).json({ message:error.message || 'The account could not be removed' }); }
}

// Returns owner-visible accounts, invitation state, and recent security activity.
function listAccounts(req,res) {
    if (req.authenticatedAccount?.role !== 'owner') return res.status(403).json({ message:'Only the CineVault owner can manage accounts' });
    const users=database.prepare(`SELECT id,email,display_name displayName,role,status,created_at createdAt,updated_at updatedAt,last_login_at lastLoginAt,
        deletion_requested_at deletionRequestedAt,deletion_scheduled_at deletionScheduledAt FROM app_users ORDER BY role='owner' DESC,created_at`).all();
    const invitations=database.prepare(`SELECT id,email,expires_at expiresAt,accepted_at acceptedAt,created_at createdAt,delivery_status deliveryStatus,
        delivery_message_id deliveryMessageId FROM auth_invitations ORDER BY created_at DESC LIMIT 100`).all();
    const securityEvents=database.prepare("SELECT id,action,actor,outcome,created_at createdAt FROM audit_log WHERE action LIKE 'auth.%' OR action LIKE 'security.%' ORDER BY id DESC LIMIT 50").all();
    return res.json({ users,invitations,securityEvents });
}

// Revokes one unused invitation without exposing its secret token.
function revokeInvitation(req,res) {
    if (req.authenticatedAccount?.role !== 'owner') return res.status(403).json({ message:'Only the CineVault owner can revoke invitations' });
    const result=database.prepare('DELETE FROM auth_invitations WHERE id=? AND accepted_at IS NULL').run(req.params.id);
    if (!result.changes) return res.status(404).json({ message:'That pending invitation no longer exists' });
    recordSecurity('auth.invitation-revoked',req,'success',{ invitationId:req.params.id },req.authenticatedAccount); return res.json({ message:'CineVault revoked the pending invitation' });
}

// Changes a member account state or restores a scheduled deletion.
function updateAccount(req,res) {
    if (req.authenticatedAccount?.role !== 'owner') return res.status(403).json({ message:'Only the CineVault owner can manage accounts' });
    const target=database.prepare('SELECT * FROM app_users WHERE id=?').get(req.params.id); if (!target) return res.status(404).json({ message:'Account not found' });
    if (target.role === 'owner') return res.status(400).json({ message:'Use ownership transfer to change the owner account' });
    const action=String(req.body?.action || ''); const now=new Date().toISOString();
    if (!['activate','disable','restore','permanent-delete'].includes(action)) return res.status(400).json({ message:'Choose a supported account action' });
    if (action === 'permanent-delete') {
        createBackup(database,'pre-account-permanent-deletion'); database.exec('BEGIN IMMEDIATE');
        try { database.prepare('DELETE FROM content_items WHERE owner_user_id=?').run(target.id); database.prepare('DELETE FROM app_users WHERE id=?').run(target.id); database.exec('COMMIT'); }
        catch(error) { database.exec('ROLLBACK'); throw error; }
        const anonymous=`deleted-user:${tokenHash(target.id).slice(0,12)}`; database.prepare("UPDATE audit_log SET actor=?,details_json=replace(details_json,?,'[deleted account]'),metadata_json=replace(metadata_json,?,'[deleted account]') WHERE actor=? OR details_json LIKE ? OR metadata_json LIKE ?")
            .run(anonymous,target.email,target.email,target.email,`%${target.email}%`,`%${target.email}%`);
    }
    else database.prepare("UPDATE app_users SET status=?,deletion_requested_at=NULL,deletion_scheduled_at=NULL,updated_at=? WHERE id=?").run(action === 'disable' ? 'disabled' : 'active',now,target.id);
    database.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(target.id); recordSecurity(`auth.account-${action}`,req,'success',{ targetEmail:target.email },req.authenticatedAccount);
    return res.json({ message:`CineVault ${action === 'disable' ? 'disabled' : action === 'permanent-delete' ? 'permanently removed' : 'restored'} ${target.display_name}` });
}

// Sends an owner-mailbox code before ownership can move to an active member.
async function requestOwnershipTransfer(req,res) {
    if (req.authenticatedAccount?.role !== 'owner') return res.status(403).json({ message:'Only the current owner can transfer ownership' });
    try {
        const target=database.prepare("SELECT * FROM app_users WHERE id=? AND role='member' AND status='active'").get(req.body?.targetUserId); if (!target) throw Object.assign(new Error('Choose an active member account'),{ status:400 });
        enforceSecurityRate('ownership-transfer',req.authenticatedUserId,3,60); const code=verificationCode(); const now=new Date(); const expiresAt=new Date(now.getTime()+10*60000).toISOString();
        await sendAccountCode({ to:req.authenticatedAccount.email,subject:'Confirm CineVault ownership transfer',heading:'Ownership transfer verification',code,minutes:10 });
        database.prepare(`INSERT INTO ownership_transfer_challenges(owner_user_id,target_user_id,otp_hash,expires_at,attempts,created_at) VALUES(?,?,?,?,0,?)
            ON CONFLICT(owner_user_id) DO UPDATE SET target_user_id=excluded.target_user_id,otp_hash=excluded.otp_hash,expires_at=excluded.expires_at,attempts=0,created_at=excluded.created_at`)
            .run(req.authenticatedUserId,target.id,tokenHash(`${req.authenticatedUserId}:${target.id}:${code}`),expiresAt,now.toISOString());
        return res.json({ message:`CineVault sent a transfer code to ${req.authenticatedAccount.email}`,expiresAt,target:{ id:target.id,email:target.email,displayName:target.display_name } });
    } catch(error) { return res.status(error.status || 502).json({ message:error.message || 'Ownership transfer could not be started' }); }
}

// Atomically promotes the verified member and demotes the former owner.
async function confirmOwnershipTransfer(req,res) {
    if (req.authenticatedAccount?.role !== 'owner') return res.status(403).json({ message:'Only the current owner can transfer ownership' });
    try {
        const challenge=database.prepare('SELECT * FROM ownership_transfer_challenges WHERE owner_user_id=?').get(req.authenticatedUserId); const code=String(req.body?.verificationCode || '').trim();
        if (!challenge || challenge.expires_at <= new Date().toISOString() || tokenHash(`${req.authenticatedUserId}:${challenge.target_user_id}:${code}`) !== challenge.otp_hash) throw Object.assign(new Error('The ownership-transfer code is incorrect or expired'),{ status:400 });
        const target=database.prepare("SELECT * FROM app_users WHERE id=? AND status='active'").get(challenge.target_user_id); if (!target) throw Object.assign(new Error('The selected member is no longer active'),{ status:409 }); const now=new Date().toISOString();
        database.exec('BEGIN IMMEDIATE'); try { database.prepare("UPDATE app_users SET role='member',updated_at=? WHERE id=?").run(now,req.authenticatedUserId); database.prepare("UPDATE app_users SET role='owner',updated_at=? WHERE id=?").run(now,target.id); database.prepare('DELETE FROM ownership_transfer_challenges WHERE owner_user_id=?').run(req.authenticatedUserId); database.prepare('DELETE FROM auth_sessions WHERE user_id IN (?,?)').run(req.authenticatedUserId,target.id); database.exec('COMMIT'); } catch(error) { database.exec('ROLLBACK'); throw error; }
        await Promise.allSettled([sendAccountNotice({ to:req.authenticatedAccount.email,subject:'CineVault ownership transferred',heading:'Ownership transfer completed',message:`CineVault transferred ownership to ${target.display_name} (${target.email}).` }),sendAccountNotice({ to:target.email,subject:'You now own CineVault',heading:'Ownership transfer completed',message:'CineVault has assigned this account the owner role.' })]);
        recordSecurity('auth.ownership-transferred',req,'success',{ targetEmail:target.email },req.authenticatedAccount); return res.json({ message:`Ownership transferred to ${target.display_name}. Sign in again to refresh account permissions.` });
    } catch(error) { return res.status(error.status || 500).json({ message:error.message || 'Ownership transfer could not be completed' }); }
}

// Permanently removes accounts whose recovery window has elapsed.
function purgeExpiredAccounts() {
    const due=database.prepare("SELECT * FROM app_users WHERE status='disabled' AND deletion_scheduled_at IS NOT NULL AND deletion_scheduled_at<=?").all(new Date().toISOString());
    if (due.length) createBackup(database,'pre-expired-account-purge');
    due.forEach((account) => { database.prepare('DELETE FROM content_items WHERE owner_user_id=?').run(account.id); database.prepare('DELETE FROM app_users WHERE id=?').run(account.id); const anonymous=`deleted-user:${tokenHash(account.id).slice(0,12)}`; database.prepare("UPDATE audit_log SET actor=?,details_json=replace(details_json,?,'[deleted account]'),metadata_json=replace(metadata_json,?,'[deleted account]') WHERE actor=? OR details_json LIKE ? OR metadata_json LIKE ?").run(anonymous,account.email,account.email,account.email,`%${account.email}%`,`%${account.email}%`); });
    return due.length;
}

// Accepts authenticated provider delivery updates without exposing invitation contents.
function mailDeliveryWebhook(req,res) {
    const configured=String(process.env.MAIL_WEBHOOK_SECRET || ''); const supplied=String(req.get('x-cinevault-webhook-secret') || '');
    const valid=configured && supplied && configured.length === supplied.length && crypto.timingSafeEqual(Buffer.from(configured),Buffer.from(supplied));
    if (!valid) return res.status(401).json({ message:'Mail delivery webhook authentication failed' });
    const messageId=String(req.body?.messageId || '').trim(); const status=String(req.body?.status || '').trim().toLowerCase();
    if (!messageId || !['delivered','bounced','rejected','deferred'].includes(status)) return res.status(400).json({ message:'Provide a message ID and supported delivery status' });
    const result=database.prepare('UPDATE auth_invitations SET delivery_status=?,delivery_response=? WHERE delivery_message_id=?').run(status,String(req.body?.detail || '').slice(0,500),messageId);
    recordSecurity('auth.mail-delivery-updated',req,'success',{ messageId,status,matched:result.changes }); return res.json({ updated:result.changes });
}

// Sends a single-use password recovery link without revealing account existence.
async function forgotPassword(req,res) {
    const response={ message:'If that email address belongs to CineVault, a recovery link has been sent.' };
    try {
        const email=normalizeEmail(req.body?.email); enforceSecurityRate('password-recovery',`${req.ip || 'local'}:${email}`,5,60); const user=database.prepare("SELECT * FROM app_users WHERE email=? COLLATE NOCASE AND status='active'").get(email);
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

module.exports={ authentication,status,setup,login,invite,verifyInvitation,signup,forgotPassword,resetPassword,requestAccountDeletion,confirmAccountDeletion,finalizeAccountDeletion,listAccounts,revokeInvitation,updateAccount,requestOwnershipTransfer,confirmOwnershipTransfer,purgeExpiredAccounts,mailDeliveryWebhook,logout,validPassword,cookies,setAuditRecorder };
