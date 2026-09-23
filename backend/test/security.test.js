const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');

const testData=fs.mkdtempSync(path.join(os.tmpdir(),'cinevault-security-'));
process.env.MOVIE_TRACKER_DATA_DIR=testData;
process.env.APP_PASSWORD='test-only-password';
const security=require('../security');

// Creates the minimal Express response surface used by authentication handlers.
function response() {
    return { code:200,headers:{},body:null,status(code) { this.code=code; return this; },json(body) { this.body=body; return this; },
        append(name,value) { const values=this.headers[name] || []; this.headers[name]=[...values,value]; return this; },
        setHeader(name,value) { this.headers[name]=value; },end() { return this; } };
}

// Creates the first owner used by persisted-session tests.
function createOwner() {
    const created=response(); security.setup({ body:{ email:'owner@gmail.com',displayName:'Owner',password:'StrongPass123',currentPassword:'test-only-password' },headers:{},requestId:'setup' },created);
    return created;
}

test('authentication rejects missing sessions and incorrect account passwords',() => {
    const denied=response(); security.authentication({ path:'/content',method:'GET',headers:{},get:() => undefined },denied,() => assert.fail('must not continue'));
    assert.equal(denied.code,401);
    createOwner();
    const login=response(); security.login({ body:{ email:'owner@gmail.com',password:'wrong' },headers:{} },login);
    assert.equal(login.code,401);
    assert.equal(security.validPassword('test-only-password'),true);
});

test('authenticated mutations require the persisted session CSRF token',() => {
    const loggedIn=response(); security.login({ body:{ email:'owner@gmail.com',password:'StrongPass123' },headers:{} },loggedIn);
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
    security.login({ body:{ email:'owner@gmail.com',password:'wrong' },headers:{},requestId:'failed-request' },response());
    security.login({ body:{ email:'owner@gmail.com',password:'StrongPass123' },headers:{},requestId:'success-request' },response());
    assert.deepEqual(events.map((event) => event.action),['auth.login-failed','auth.login-succeeded']);
    assert.equal(JSON.stringify(events).includes('StrongPass123'),false);
    assert.equal(events[1].context.metadata.sessionHash.length,16);
    security.setAuditRecorder(null);
});
