const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'movie-asset-test-'));
process.env.MOVIE_TRACKER_DATA_DIR=directory;
const health=require('../asset-health');
const { database }=require('../database');

test('asset validation rejects local, private, and unsupported destinations',async () => {
    for (const address of ['127.0.0.1','10.1.2.3','172.16.1.2','192.168.1.4','::1','fc00::1']) assert.equal(health.isPrivateAddress(address),true,address);
    await assert.rejects(() => health.validateExternalUrl('file:///etc/passwd'),/HTTP and HTTPS/);
    await assert.rejects(() => health.validateExternalUrl('http://localhost/poster.jpg'),/not allowed/);
});

test('YouTube identifiers are recognized from supported URL shapes',() => {
    assert.equal(health.getYouTubeId('https://youtu.be/dQw4w9WgXcQ'),'dQw4w9WgXcQ');
    assert.equal(health.getYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),'dQw4w9WgXcQ');
    assert.equal(health.getYouTubeId('https://example.com/video'),null);
});

test('recent persisted checks prevent reconnection rescans after process state changes',async () => {
    const now=new Date().toISOString();
    database.prepare(`INSERT INTO content_items(id,type,subtype,title,production_status,release_status,poster_url,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run('persisted-asset','movie','Feature Film','Persisted asset','Completed','Released','https://example.com/poster.jpg',now,now);
    database.prepare(`INSERT INTO asset_checks(content_id,asset_type,asset_url,status,last_checked_at,last_healthy_at) VALUES(?,?,?,?,?,?)`)
        .run('persisted-asset','poster','https://example.com/poster.jpg','healthy',now,now);
    const report=await health.scanStaleAssets(false);
    assert.equal(report.items,0);
    assert.equal(report.checked,0);
});

test.after(() => { database.close(); fs.rmSync(directory,{ recursive:true,force:true }); });
