const test=require('node:test');
const assert=require('node:assert/strict');

process.env.APP_PASSWORD='test-only-password';
const security=require('../security');

// Creates the minimal response surface used by the security middleware.
function response() {
    return { code:200,headers:{},body:null,status(code) { this.code=code; return this; },json(body) { this.body=body; return this; },
        setHeader(name,value) { this.headers[name]=value; },end() { return this; } };
}

test('authentication rejects missing sessions and incorrect passwords',() => {
    const denied=response(); security.authentication({ path:'/content',method:'GET',headers:{},get:() => undefined },denied,() => assert.fail('must not continue'));
    assert.equal(denied.code,401);
    const login=response(); security.login({ body:{ password:'wrong' } },login);
    assert.equal(login.code,401);
    assert.equal(security.validPassword('test-only-password'),true);
});

test('authenticated mutations require the session CSRF token',() => {
    const loggedIn=response(); security.login({ body:{ password:'test-only-password' } },loggedIn);
    const cookie=loggedIn.headers['Set-Cookie'].split(';')[0];
    const status=response(); security.status({ headers:{ cookie } },status);
    assert.equal(status.body.authenticated,true);
    const blocked=response(); security.authentication({ path:'/content',method:'POST',headers:{ cookie },get:() => undefined },blocked,() => assert.fail('must not continue'));
    assert.equal(blocked.code,403);
    let continued=false;
    security.authentication({ path:'/content',method:'POST',headers:{ cookie },get:(name) => name === 'x-csrf-token' ? status.body.csrf : undefined },response(),() => { continued=true; });
    assert.equal(continued,true);
});

test('authentication activity is reported without secret values',() => {
    const events=[]; security.setAuditRecorder((action,entityType,entityId,details,context) => events.push({ action,entityType,entityId,details,context }));
    security.login({ body:{ password:'wrong' },headers:{},requestId:'failed-request' },response());
    const success=response(); security.login({ body:{ password:'test-only-password' },headers:{},requestId:'success-request' },success);
    assert.deepEqual(events.map((event) => event.action),['auth.login-failed','auth.login-succeeded']);
    assert.equal(JSON.stringify(events).includes('test-only-password'),false);
    assert.equal(events[1].context.metadata.sessionHash.length,16);
    security.setAuditRecorder(null);
});
