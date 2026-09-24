const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');

const testData=fs.mkdtempSync(path.join(os.tmpdir(),'cinevault-security-'));
process.env.MOVIE_TRACKER_DATA_DIR=testData;
process.env.APP_PASSWORD='test-only-password';
const security=require('../security');
const { database }=require('../database');

// Creates the minimal Express response surface used by authentication handlers.
function response() {
    return { code:200,headers:{},body:null,status(code) { this.code=code; return this; },json(body) { this.body=body; return this; },
        append(name,value) { const values=this.headers[name] || []; this.headers[name]=[...values,value]; return this; },
        setHeader(name,value) { this.headers[name]=value; },send(body) { this.body=body; return this; },end() { return this; } };
}

// Creates the first owner used by persisted-session tests.
function createOwner() {
    const created=response(); security.setup({ body:{ email:'owner@outlook.com',displayName:'Owner',password:'StrongPass123',currentPassword:'test-only-password' },headers:{},requestId:'setup' },created);
    return created;
}

test('authentication rejects missing sessions and incorrect account passwords',() => {
    const denied=response(); security.authentication({ path:'/content',method:'GET',headers:{},get:() => undefined },denied,() => assert.fail('must not continue'));
    assert.equal(denied.code,401);
    createOwner();
    const login=response(); security.login({ body:{ email:'owner@outlook.com',password:'wrong' },headers:{} },login);
    assert.equal(login.code,401);
    assert.equal(security.validPassword('test-only-password'),true);
});

test('disabled accounts receive activation guidance only after correct credentials',() => {
    const owner=database.prepare("SELECT * FROM app_users WHERE role='owner'").get();
    const now=new Date().toISOString();
    database.prepare(`INSERT INTO app_users(id,email,display_name,password_hash,password_salt,role,status,created_at,updated_at)
        VALUES(?,?,?,?,?,'member','disabled',?,?)`).run('disabled-member','disabled@example.com','Disabled Member',owner.password_hash,owner.password_salt,now,now);
    const incorrect=response(); security.login({ body:{ email:'disabled@example.com',password:'wrong' },headers:{} },incorrect);
    assert.equal(incorrect.code,401); assert.equal(incorrect.body.message,'Email or password is incorrect');
    const correct=response(); security.login({ body:{ email:'disabled@example.com',password:'StrongPass123' },headers:{} },correct);
    assert.equal(correct.code,403);
    assert.equal(correct.body.message,'Your CineVault account is disabled. Ask the CineVault owner to activate it before signing in.');
});

test('authenticated mutations require the persisted session CSRF token',() => {
    const loggedIn=response(); security.login({ body:{ email:'owner@outlook.com',password:'StrongPass123' },headers:{} },loggedIn);
    const cookie=loggedIn.headers['Set-Cookie'].map((value) => value.split(';')[0]).join('; ');
    const status=response(); security.status({ headers:{ cookie } },status);
    assert.equal(status.body.authenticated,true);
    const blocked=response(); security.authentication({ path:'/content',method:'POST',headers:{ cookie },get:() => undefined },blocked,() => assert.fail('must not continue'));
    assert.equal(blocked.code,403);
    let continued=false;
    security.authentication({ path:'/content',method:'POST',headers:{ cookie },get:(name) => name === 'x-csrf-token' ? status.body.csrf : undefined },response(),() => { continued=true; });
    assert.equal(continued,true);
});

test('authentication activity is reported without credential or token values',() => {
    const events=[]; security.setAuditRecorder((action,entityType,entityId,details,context) => events.push({ action,entityType,entityId,details,context }));
    security.login({ body:{ email:'owner@outlook.com',password:'wrong' },headers:{},requestId:'failed-request' },response());
    security.login({ body:{ email:'owner@outlook.com',password:'StrongPass123' },headers:{},requestId:'success-request' },response());
    assert.deepEqual(events.map((event) => event.action),['auth.login-failed','auth.login-succeeded']);
    assert.equal(JSON.stringify(events).includes('StrongPass123'),false);
    assert.equal(events[1].context.metadata.sessionHash.length,16);
    security.setAuditRecorder(null);
});

test('invitation activation requires the mailbox verification code',() => {
    const owner=database.prepare("SELECT * FROM app_users WHERE role='owner'").get(); const token='invitation-secret'; const now=new Date();
    database.prepare('INSERT INTO auth_invitations(id,email,token_hash,invited_by,expires_at,created_at) VALUES(?,?,?,?,?,?)')
        .run(crypto.randomUUID(),'member@example.com',crypto.createHash('sha256').update(token).digest('hex'),owner.id,new Date(now.getTime()+3600000).toISOString(),now.toISOString());
    const rejected=response(); security.signup({ body:{ token,email:'member@example.com',displayName:'Member',password:'StrongPass123',verificationCode:'111111' },headers:{} },rejected);
    assert.equal(rejected.code,400); assert.match(rejected.body.message,/verification code/i);
});

test('account archive has an integrity checksum and scheduled deletion is recoverable',async () => {
    const id=crypto.randomUUID(); const now=new Date().toISOString(); const code='234567';
    database.prepare("INSERT INTO app_users(id,email,display_name,password_hash,password_salt,role,status,created_at,updated_at) VALUES(?,?,?,?,?,'member','active',?,?)")
        .run(id,'archive@example.com','Archive Member','hash','salt',now,now);
    database.prepare('INSERT INTO account_deletion_challenges(user_id,otp_hash,expires_at,attempts,created_at) VALUES(?,?,?,?,?)')
        .run(id,crypto.createHash('sha256').update(`${id}:${code}`).digest('hex'),new Date(Date.now()+600000).toISOString(),0,now);
    const account={ id,email:'archive@example.com',displayName:'Archive Member',role:'member' }; const req={ body:{ verificationCode:code },headers:{},authenticatedAccount:account,authenticatedUserId:id };
    const archiveResponse=response(); await security.confirmAccountDeletion(req,archiveResponse); const archive=JSON.parse(archiveResponse.body);
    assert.equal(archive.integrity.algorithm,'SHA-256'); assert.equal(archive.integrity.checksum.length,64);
    const finalResponse=response(); await security.finalizeAccountDeletion({ ...req,body:{ verificationCode:code,permanent:false } },finalResponse);
    const scheduled=database.prepare('SELECT status,deletion_scheduled_at FROM app_users WHERE id=?').get(id); assert.equal(scheduled.status,'disabled'); assert.ok(scheduled.deletion_scheduled_at);
    const restored=response(); security.updateAccount({ params:{ id },body:{ action:'restore' },authenticatedAccount:{ ...database.prepare("SELECT id,email,display_name displayName,role FROM app_users WHERE role='owner'").get() },headers:{} },restored);
    assert.equal(database.prepare('SELECT status FROM app_users WHERE id=?').get(id).status,'active');
});

test('ownership transfer atomically changes both roles',async () => {
    const owner=database.prepare("SELECT * FROM app_users WHERE role='owner'").get(); const member=database.prepare("SELECT * FROM app_users WHERE email='archive@example.com'").get(); const code='345678';
    const memberToken='promoted-owner-session'; const now=new Date().toISOString();
    database.prepare('INSERT INTO auth_sessions(token_hash,user_id,csrf_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)')
        .run(crypto.createHash('sha256').update(memberToken).digest('hex'),member.id,'csrf',now,new Date(Date.now()+3600000).toISOString(),now);
    database.prepare('INSERT INTO ownership_transfer_challenges(owner_user_id,target_user_id,otp_hash,expires_at,attempts,created_at) VALUES(?,?,?,?,0,?)')
        .run(owner.id,member.id,crypto.createHash('sha256').update(`${owner.id}:${member.id}:${code}`).digest('hex'),new Date(Date.now()+600000).toISOString(),new Date().toISOString());
    const result=response(); await security.confirmOwnershipTransfer({ body:{ verificationCode:code },authenticatedUserId:owner.id,authenticatedAccount:{ id:owner.id,email:owner.email,displayName:owner.display_name,role:'owner' },headers:{} },result);
    assert.equal(result.code,200); assert.equal(database.prepare('SELECT role FROM app_users WHERE id=?').get(member.id).role,'owner'); assert.equal(database.prepare('SELECT role FROM app_users WHERE id=?').get(owner.id).role,'member');
    const promotedStatus=response(); security.status({ headers:{ cookie:`cinevault_session=${memberToken}` } },promotedStatus);
    assert.equal(promotedStatus.body.authenticated,true); assert.equal(promotedStatus.body.user.role,'owner');
    const accounts=response(); security.listAccounts({ authenticatedAccount:promotedStatus.body.user },accounts);
    assert.equal(accounts.code,200); assert.ok(Array.isArray(accounts.body.users));
});
