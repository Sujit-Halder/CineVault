const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { database } = require('./database');
const logger = require('./logger');

let activeScan = null;
const SCAN_COOLDOWN_MS = Math.max(60000,Number(process.env.ASSET_SCAN_COOLDOWN_HOURS || 24) * 3600000);

// Detects local and private network addresses that external asset checks must never contact.
function isPrivateAddress(address) {
    if (!address) return true;
    if (net.isIPv4(address)) {
        const parts=address.split('.').map(Number);
        return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254)
            || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
    }
    const value=address.toLowerCase();
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
}

// Validates an outbound asset URL and rejects hosts resolving to private networks.
async function validateExternalUrl(value) {
    const url = new URL(value);
    if (!['http:','https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS asset URLs are allowed');
    if (['localhost','localhost.localdomain'].includes(url.hostname.toLowerCase())) throw new Error('Local network asset URLs are not allowed');
    const addresses = await dns.lookup(url.hostname,{ all:true });
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error('Private network asset URLs are not allowed');
    return url.href;
}

// Fetches a small external response while validating every redirected destination.
async function safeFetch(value,method='HEAD',redirects=0) {
    const url=await validateExternalUrl(value);
    const response=await fetch(url,{ method,redirect:'manual',signal:AbortSignal.timeout(10000),headers:{ Range:'bytes=0-65535' } });
    if ([301,302,303,307,308].includes(response.status) && response.headers.get('location')) {
        if (redirects >= 3) throw new Error('Asset URL redirected too many times');
        return safeFetch(new URL(response.headers.get('location'),url).href,method,redirects + 1);
    }
    return response;
}

// Extracts a YouTube identifier from supported trailer URL formats.
function getYouTubeId(value) {
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        if (host === 'youtu.be') return url.pathname.slice(1).split('/')[0];
        if (!['youtube.com','m.youtube.com','music.youtube.com'].includes(host)) return null;
        if (url.pathname.includes('/shorts/')) return url.pathname.split('/shorts/')[1].split('/')[0];
        if (url.pathname.includes('/embed/')) return url.pathname.split('/embed/')[1].split('/')[0];
        return url.searchParams.get('v');
    } catch { return null; }
}

// Checks a YouTube trailer through its public metadata endpoint.
async function checkYouTubeTrailer(url) {
    const videoId = getYouTubeId(url);
    if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
        return { ok:false, definitive:true, status:'invalid', reason:'The YouTube trailer link is invalid or has changed' };
    }
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    try {
        const response = await safeFetch(endpoint,'GET');
        if (response.ok) return { ok:true };
        if ([401,403].includes(response.status)) {
            return { ok:false, definitive:true, status:'restricted', reason:'The YouTube trailer is private or permission restricted' };
        }
        if (response.status === 404) {
            return { ok:false, definitive:true, status:'unavailable', reason:'The YouTube trailer was deleted, made private, or is no longer available' };
        }
        if (response.status === 400) {
            return { ok:false, definitive:true, status:'invalid', reason:'The YouTube trailer link is invalid or has changed' };
        }
        return { ok:false, definitive:false, status:'uncertain', reason:`YouTube temporarily returned HTTP ${response.status}` };
    } catch (error) {
        return { ok:false, definitive:false, status:'uncertain', reason:error.name === 'TimeoutError' ? 'YouTube did not respond in time' : error.message };
    }
}

// Checks whether a poster URL currently returns image content.
async function checkPoster(url) {
    try {
        let response = await safeFetch(url,'HEAD');
        if (response.status === 405) response = await safeFetch(url,'GET');
        if ([404,410].includes(response.status)) return { ok:false, definitive:true, status:'unavailable', reason:'The poster was removed or its link has changed' };
        if (!response.ok) return { ok:false, definitive:false, status:'uncertain', reason:`The poster provider temporarily returned HTTP ${response.status}` };
        const contentType = response.headers.get('content-type');
        if (contentType && !contentType.startsWith('image/')) return { ok:false, definitive:true, status:'invalid', reason:'The poster link no longer returns an image' };
        return { ok:true };
    } catch (error) {
        return { ok:false, definitive:false, status:'uncertain', reason:error.name === 'TimeoutError' ? 'The poster provider did not respond in time' : error.message };
    }
}

// Selects the appropriate health check for an external media asset.
async function checkAsset(url, assetType) {
    if (!url) return { ok:true };
    if (assetType === 'trailer') return checkYouTubeTrailer(url);
    return checkPoster(url);
}

// Writes a system-generated audit event for media-health state changes.
function writeHealthAudit(action, item, assetType, details) {
    database.prepare(`INSERT INTO audit_log(
        action,entity_type,entity_id,details_json,actor,outcome,metadata_json,created_at
      ) VALUES(?,?,?,?,?,?,?,?)`).run(
        action,'asset',item.id,JSON.stringify({ title:item.title,assetType,...details }),'asset-health-service','success','{}',new Date().toISOString(),
    );
}

// Creates or refreshes an active notification for an unavailable asset.
function recordFailure(item, assetType, assetUrl, result) {
    const existing = database.prepare('SELECT status,reason,asset_url FROM notifications WHERE content_id=? AND asset_type=? AND resolved_at IS NULL').get(item.id,assetType);
    database.prepare(`INSERT INTO notifications(id,content_id,asset_type,status,reason,asset_url,detected_at)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(content_id,asset_type) WHERE resolved_at IS NULL
        DO UPDATE SET status=excluded.status,reason=excluded.reason,asset_url=excluded.asset_url,detected_at=excluded.detected_at`)
        .run(crypto.randomUUID(),item.id,assetType,result.status,result.reason,assetUrl,new Date().toISOString());
    if (!existing || existing.status !== result.status || existing.reason !== result.reason || existing.asset_url !== assetUrl) {
        logger.event('warn','asset.health.unavailable','External media asset became unavailable',{ contentId:item.id,title:item.title,assetType,status:result.status,reason:result.reason,assetUrl });
        writeHealthAudit('unavailable',item,assetType,{ status:result.status,reason:result.reason,assetUrl });
    }
}

// Resolves an active notification after its asset becomes available.
function resolveHealthy(itemId, assetType) {
    const item = database.prepare('SELECT title FROM content_items WHERE id=?').get(itemId);
    const result = database.prepare('UPDATE notifications SET resolved_at=? WHERE content_id=? AND asset_type=? AND resolved_at IS NULL')
        .run(new Date().toISOString(), itemId, assetType);
    if (result.changes > 0) {
        logger.event('info','asset.health.recovered','External media asset became available again',{ contentId:itemId,title:item?.title,assetType });
        writeHealthAudit('recovered',{ id:itemId,title:item?.title },assetType,{});
    }
}

// Checks a rotating batch of content assets and updates notification state.
async function scanAssets(limit = 25, offset = 0, concurrency = 8) {
    const items = database.prepare(`SELECT id,title,poster_url,trailer_url FROM content_items
        WHERE deleted_at IS NULL ORDER BY id LIMIT ? OFFSET ?`).all(limit, offset);
    const report = { checked:0, healthy:0, failed:0, uncertain:0, items:items.length, offset };
    let cursor = 0;
    const checkItem = async (item) => {
        const assets = [['poster',item.poster_url],['trailer',item.trailer_url]].filter(([,url]) => Boolean(url));
        const results = await Promise.all(assets.map(async ([assetType,assetUrl]) => ({ assetType,assetUrl,result:await checkAsset(assetUrl,assetType) })));
        results.forEach(({ assetType,assetUrl,result }) => {
            const checkedAt=new Date().toISOString();
            database.prepare(`INSERT INTO asset_checks(content_id,asset_type,asset_url,status,last_checked_at,last_healthy_at)
                VALUES(?,?,?,?,?,?) ON CONFLICT(content_id,asset_type) DO UPDATE SET asset_url=excluded.asset_url,
                status=excluded.status,last_checked_at=excluded.last_checked_at,
                last_healthy_at=CASE WHEN excluded.status='healthy' THEN excluded.last_healthy_at ELSE asset_checks.last_healthy_at END`)
                .run(item.id,assetType,assetUrl,result.ok ? 'healthy' : result.status,checkedAt,result.ok ? checkedAt : null);
            report.checked += 1;
            if (result.ok) { report.healthy += 1; resolveHealthy(item.id, assetType); }
            else if (result.definitive) { report.failed += 1; recordFailure(item, assetType, assetUrl, result); }
            else { report.uncertain += 1; }
        });
    };
    const workers = Array.from({ length:Math.min(concurrency,items.length) },async () => {
        while (cursor < items.length) { const item=items[cursor]; cursor += 1; await checkItem(item); }
    });
    await Promise.all(workers);
    return report;
}

// Checks only titles whose asset URL changed or whose persisted check age exceeded the configured cooldown.
async function scanStaleAssets(force = false) {
    const cutoff=new Date(Date.now() - SCAN_COOLDOWN_MS).toISOString();
    const items=force ? database.prepare('SELECT id FROM content_items WHERE deleted_at IS NULL ORDER BY id').all()
        : database.prepare(`SELECT c.id FROM content_items c WHERE c.deleted_at IS NULL AND (
            (trim(c.poster_url)<>'' AND NOT EXISTS(SELECT 1 FROM asset_checks a WHERE a.content_id=c.id AND a.asset_type='poster' AND a.asset_url=c.poster_url AND a.last_checked_at>=?))
            OR (trim(c.trailer_url)<>'' AND NOT EXISTS(SELECT 1 FROM asset_checks a WHERE a.content_id=c.id AND a.asset_type='trailer' AND a.asset_url=c.trailer_url AND a.last_checked_at>=?))
        ) ORDER BY c.id`).all(cutoff,cutoff);
    if (!items.length) return { checked:0,healthy:0,failed:0,uncertain:0,items:0,staleOnly:!force };
    const ids=items.map((item) => item.id);
    const report={ checked:0,healthy:0,failed:0,uncertain:0,items:ids.length,staleOnly:!force };
    for (let offset=0;offset<ids.length;offset+=50) {
        const batch=ids.slice(offset,offset + 50);
        const placeholders=batch.map(() => '?').join(',');
        const selected=database.prepare(`SELECT id,title,poster_url,trailer_url FROM content_items WHERE id IN (${placeholders})`).all(...batch);
        let cursor=0;
        const workers=Array.from({ length:Math.min(12,selected.length) },async () => {
            while (cursor < selected.length) {
                const item=selected[cursor++];
                const assets=[['poster',item.poster_url],['trailer',item.trailer_url]].filter(([,url]) => Boolean(url));
                for (const [assetType,assetUrl] of assets) {
                    const prior=database.prepare('SELECT asset_url,last_checked_at FROM asset_checks WHERE content_id=? AND asset_type=?').get(item.id,assetType);
                    if (!force && prior?.asset_url === assetUrl && prior.last_checked_at >= cutoff) continue;
                    const result=await checkAsset(assetUrl,assetType); const checkedAt=new Date().toISOString();
                    database.prepare(`INSERT INTO asset_checks(content_id,asset_type,asset_url,status,last_checked_at,last_healthy_at) VALUES(?,?,?,?,?,?)
                        ON CONFLICT(content_id,asset_type) DO UPDATE SET asset_url=excluded.asset_url,status=excluded.status,last_checked_at=excluded.last_checked_at,
                        last_healthy_at=CASE WHEN excluded.status='healthy' THEN excluded.last_healthy_at ELSE asset_checks.last_healthy_at END`)
                        .run(item.id,assetType,assetUrl,result.ok ? 'healthy' : result.status,checkedAt,result.ok ? checkedAt : null);
                    report.checked += 1;
                    if (result.ok) { report.healthy += 1; resolveHealthy(item.id,assetType); }
                    else if (result.definitive) { report.failed += 1; recordFailure(item,assetType,assetUrl,result); }
                    else report.uncertain += 1;
                }
            }
        });
        await Promise.all(workers);
    }
    return report;
}

// Starts one coalesced full-library scan for connected application clients.
function startConnectionScan(force = false) {
    if (activeScan?.status === 'running') return activeScan;
    if (!force && activeScan?.completedAt && Date.now() - Date.parse(activeScan.completedAt) < SCAN_COOLDOWN_MS) return activeScan;
    const scan = { id:crypto.randomUUID(),status:'running',startedAt:new Date().toISOString(),report:null,error:null };
    activeScan = scan;
    scan.promise = (async () => {
        try {
            scan.report = await scanStaleAssets(force);
            scan.status = 'complete';
            scan.completedAt = new Date().toISOString();
            logger.event('info','asset.health.scan.completed','Client connection asset scan completed',{ scanId:scan.id,...scan.report });
        } catch (error) {
            scan.status = 'failed';
            scan.completedAt = new Date().toISOString();
            scan.error = error.message;
            logger.event('error','asset.health.scan.failed','Asset health scan failed',{ errorName:error.name,errorMessage:error.message,stack:error.stack });
        }
    })();
    return scan;
}

// Returns public progress for the current connection-triggered scan.
function getConnectionScanStatus() {
    if (!activeScan) return { status:'idle' };
    return { id:activeScan.id,status:activeScan.status,startedAt:activeScan.startedAt,completedAt:activeScan.completedAt,
        report:activeScan.report,error:activeScan.error };
}

// Runs a manual scanner invocation from the command line.
async function runCommandLineScan() {
    const limitArgument = process.argv.find((argument) => argument.startsWith('--limit='));
    const report = await scanAssets(Number(limitArgument?.split('=')[1]) || 50, 0);
    console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
    runCommandLineScan().catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { getYouTubeId, checkYouTubeTrailer, checkPoster, scanAssets,scanStaleAssets,startConnectionScan,getConnectionScanStatus,validateExternalUrl,isPrivateAddress };
