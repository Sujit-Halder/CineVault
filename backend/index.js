const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
require('dotenv').config();
const routes = require('./routes');
const logger = require('./logger');
const { requestLogging, unhandledErrorLogging } = require('./request-logging');
const security=require('./security');
const { runWithAccount }=require('./request-context');
const Model=require('./model');
security.setAuditRecorder(Model.recordAudit);
security.purgeExpiredAccounts();
const accountPurgeTimer=setInterval(() => security.purgeExpiredAccounts(),6 * 60 * 60 * 1000);
accountPurgeTimer.unref();
const app = express();
const PORT = process.env.PORT;
const runtimeDataDirectory = process.env.MOVIE_TRACKER_DATA_DIR ? path.resolve(process.env.MOVIE_TRACKER_DATA_DIR) : path.join(__dirname,'data');
const serverLockFile = path.join(runtimeDataDirectory,'server.lock');
const rateBuckets = new Map();
const RATE_WINDOW_MS=60000;

// Removes expired client counters so inactive network addresses do not remain in process memory.
function pruneRateBuckets() {
    const oldestAllowed=Date.now() - RATE_WINDOW_MS;
    for (const [key,bucket] of rateBuckets) if (bucket.start < oldestAllowed) rateBuckets.delete(key);
}

const rateBucketCleanup=setInterval(pruneRateBuckets,5 * 60 * 1000);
rateBucketCleanup.unref();

app.disable('x-powered-by');
app.set('trust proxy',process.env.TRUST_PROXY === '1' ? 1 : false);

// Adds browser security policy headers to every API response.
app.use((_req,res,next) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
    if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
    next();
});

// Limits abusive request bursts without affecting ordinary interactive use.
app.use((req,res,next) => {
    const now=Date.now(); const key=req.ip || 'local'; const bucket=rateBuckets.get(key) || { start:now,count:0 };
    if (now - bucket.start > RATE_WINDOW_MS) { bucket.start=now; bucket.count=0; }
    bucket.count += 1; rateBuckets.set(key,bucket);
    if (bucket.count > Number(process.env.RATE_LIMIT_PER_MINUTE || 300)) { Model.recordAudit('security.rate-limited','authentication',null,{ path:req.path,method:req.method },{ requestId:req.requestId,actor:'guest',outcome:'failure' }); return res.status(429).json({ message:'Too many requests; try again shortly' }); }
    return next();
});

app.use(cors({
    origin: process.env.WEBSITE ? process.env.WEBSITE.split(',').map((value) => value.trim()) : false,
    credentials:true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(requestLogging);

// Prevents private API responses from being stored by browsers or intermediary caches.
app.use('/api',(_req,res,next) => {
    res.setHeader('Cache-Control','no-store, private');
    res.setHeader('Pragma','no-cache');
    res.setHeader('Expires','0');
    next();
});

app.get('/api/auth/status',security.status);
app.post('/api/auth/setup',security.setup);
app.post('/api/auth/login',security.login);
app.post('/api/auth/invitations/verify-email',security.verifyInvitation);
app.post('/api/auth/signup',security.signup);
app.post('/api/auth/forgot-password',security.forgotPassword);
app.post('/api/auth/reset-password',security.resetPassword);
app.post('/api/auth/mail-delivery',security.mailDeliveryWebhook);
app.post('/api/auth/logout',security.logout);
app.post('/api/auth/invitations',security.authentication,security.invite);
app.use('/api',security.authentication);
app.use('/api',(req,_res,next) => runWithAccount(req.authenticatedAccount,next,req.get('X-CineVault-Time-Zone')));

// Example route
app.get('/api', (req, res) => {
    res.send('API working!');
});

app.use('/api', routes);
app.use(unhandledErrorLogging);

// Starts the API after the consolidated relational schema is ready.
app.listen(PORT, () => {
    fs.mkdirSync(runtimeDataDirectory,{ recursive:true });
    fs.writeFileSync(serverLockFile,JSON.stringify({ pid:process.pid,startedAt:new Date().toISOString() }));
    logger.event('info', 'application.started', 'CineVault API started', { port:Number(PORT), environment:process.env.NODE_ENV || 'development' });
    Model.recordAudit('system.started','system',null,{ port:Number(PORT),environment:process.env.NODE_ENV || 'development' },{ actor:'system' });
});

let shutdownRecorded=false;
// Records one orderly stop event and removes the maintenance lock.
function removeServerLock() { try { clearInterval(rateBucketCleanup); clearInterval(accountPurgeTimer); if (!shutdownRecorded) { shutdownRecorded=true; Model.recordAudit('system.stopped','system',null,{ reason:'Orderly shutdown' },{ actor:'system' }); } if (fs.existsSync(serverLockFile)) fs.unlinkSync(serverLockFile); } catch {} }
process.once('exit',removeServerLock);
process.once('SIGINT',() => { removeServerLock(); process.exit(0); });
process.once('SIGTERM',() => { removeServerLock(); process.exit(0); });
