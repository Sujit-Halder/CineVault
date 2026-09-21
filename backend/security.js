const crypto=require('crypto');

const sessions=new Map();
const password=process.env.APP_PASSWORD || '';
let auditRecorder=() => {};

// Accepts the application audit writer without coupling security tests to the database runtime.
function setAuditRecorder(recorder) { auditRecorder=typeof recorder === 'function' ? recorder : () => {}; }

// Records a security event without retaining passwords, cookies, CSRF values, or raw session identifiers.
function recordSecurity(action,req,outcome,details={}) {
    const sessionId=cookies(req).cinevault_session || '';
    const sessionHash=sessionId ? crypto.createHash('sha256').update(sessionId).digest('hex').slice(0,16) : null;
    try { auditRecorder(action,'authentication',null,details,{ requestId:req.requestId,actor:outcome === 'success' ? 'owner' : 'guest',outcome,metadata:{ sessionHash } }); } catch {}
}

// Parses a request Cookie header into a small key-value map.
function cookies(req) { return Object.fromEntries(String(req.headers?.cookie || '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((pair) => pair.length === 2)); }

// Compares the configured password without leaking comparison timing.
function validPassword(value) {
    const expected=crypto.createHash('sha256').update(password).digest();
    const supplied=crypto.createHash('sha256').update(String(value || '')).digest();
    return crypto.timingSafeEqual(expected,supplied);
}

// Protects API routes with an optional secure-cookie session and CSRF token.
function authentication(req,res,next) {
    if (!password || req.path.startsWith('/auth/')) return next();
    const session=sessions.get(cookies(req).cinevault_session);
    if (!session || session.expiresAt < Date.now()) { recordSecurity('auth.access-denied',req,'failure',{ reason:session ? 'Session expired' : 'Authentication required',path:req.path,method:req.method }); return res.status(401).json({ message:'Authentication required' }); }
    session.expiresAt=Date.now() + 12 * 3600000;
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('x-csrf-token') !== session.csrf) { recordSecurity('auth.csrf-rejected',req,'failure',{ path:req.path,method:req.method }); return res.status(403).json({ message:'Invalid CSRF token' }); }
    req.authenticatedUser='owner';
    return next();
}

// Reports whether password authentication is enabled and satisfied.
function status(req,res) {
    if (!password) return res.json({ enabled:false,authenticated:true });
    const session=sessions.get(cookies(req).cinevault_session);
    return res.json({ enabled:true,authenticated:Boolean(session && session.expiresAt >= Date.now()),csrf:session?.csrf });
}

// Creates a time-limited owner session after password verification.
function login(req,res) {
    if (!password) return res.json({ enabled:false,authenticated:true });
    if (!validPassword(req.body?.password)) { recordSecurity('auth.login-failed',req,'failure',{ reason:'Incorrect password' }); return res.status(401).json({ message:'Incorrect password' }); }
    const id=crypto.randomUUID(); const csrf=crypto.randomBytes(24).toString('base64url');
    sessions.set(id,{ csrf,expiresAt:Date.now() + 12 * 3600000 });
    recordSecurity('auth.login-succeeded',{ ...req,headers:{ ...req.headers,cookie:`cinevault_session=${id}` } },'success',{ expiresInHours:12 });
    res.setHeader('Set-Cookie',`cinevault_session=${encodeURIComponent(id)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=43200${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    return res.json({ enabled:true,authenticated:true,csrf });
}

// Invalidates the current session and expires its browser cookie.
function logout(req,res) {
    recordSecurity('auth.logout',req,'success');
    sessions.delete(cookies(req).cinevault_session);
    res.setHeader('Set-Cookie','cinevault_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0');
    res.status(204).end();
}

module.exports={ authentication,status,login,logout,validPassword,cookies,setAuditRecorder };
