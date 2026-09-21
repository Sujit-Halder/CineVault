const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.MOVIE_TRACKER_DATA_DIR ? path.resolve(process.env.MOVIE_TRACKER_DATA_DIR) : path.join(__dirname,'..','data');
const DATABASE_FILE = path.join(DATA_DIR,'movie-tracker.sqlite');
const EXPORT_DIR = path.join(DATA_DIR,'exports');
const REPORT_FILE = path.join(EXPORT_DIR,'presentation-form-internet-audit.json');
const APPLY = process.argv.includes('--apply');
const APPLY_REPORT = process.argv.includes('--apply-report');
const ANIMATION_FORMS = new Set(['Animation','Anime','Adult Animation','Stop Motion']);
const DOCUMENTARY_FORMS = new Set(['Documentary','Biographical Documentary','Docudrama','Nature Documentary','Propaganda']);
const REVIEWED_LIVE_ACTION_IDS = new Set([
    'd6a7e8ab-2d17-4aab-b262-9f00086bb7b3',
    '49a06571-ca7c-4aa9-bc0c-8cb41e90d979',
]);
const REQUEST_INTERVAL_MS = 350;
let nextRequestAt = 0;

// Produces a comparison key that tolerates punctuation and article differences.
function titleKey(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

// Waits between public-reference requests and retries temporary rate limits.
async function fetchWikipedia(url,retries = 6) {
    const wait=Math.max(0,nextRequestAt-Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve,wait));
    nextRequestAt=Date.now()+REQUEST_INTERVAL_MS;
    const response=await fetch(url,{
        headers:{ 'User-Agent':'CineVaultMovieTracker/1.0 (local personal-library data audit)' },
        signal:AbortSignal.timeout(20000),
    });
    if (response.status === 429 && retries > 0) {
        const retryAfter=Number(response.headers.get('retry-after')) || (7-retries)*3;
        await new Promise((resolve) => setTimeout(resolve,Math.max(3000,retryAfter*1000)));
        return fetchWikipedia(url,retries-1);
    }
    if (!response.ok) throw new Error(`Wikipedia returned HTTP ${response.status}`);
    return response.json();
}

// Builds common encyclopaedia page-title variants for a stored library title.
function pageTitleVariants(row) {
    const year=String(row.release_date || '').slice(0,4);
    const title=String(row.title || '').replace(/\(\s*season\s*:?\s*\d+\s*\)/ig,'').trim();
    const variants=row.type === 'series'
        ? [title,`${title} (TV series)`,`${title} (television series)`,`${title} (${year} TV series)`,`${title} (${year} television series)`]
        : [title,`${title} (film)`,`${title} (${year} film)`,`${title} (movie)`,`${title} (${year} movie)`];
    return [...new Set(variants.filter((value) => value && !value.includes('()')))];
}

// Requests multiple exact page-title variants in one public-reference request.
async function fetchWikipediaBatch(rows) {
    const parameters=new URLSearchParams({
        action:'query',titles:rows.flatMap(pageTitleVariants).join('|'),redirects:'1',
        prop:'extracts|categories|info',exintro:'1',explaintext:'1',cllimit:'max',inprop:'url',format:'json',origin:'*',formatversion:'2',
    });
    return (await fetchWikipedia(`https://en.wikipedia.org/w/api.php?${parameters}`)).query?.pages || [];
}

// Selects the candidate most consistent with the stored title, year, and content type.
function selectCandidate(row,pages) {
    const expected=titleKey(row.title);
    const year=String(row.release_date || '').slice(0,4);
    return pages.filter((page) => !page.missing).map((page) => {
        const pageKey=titleKey(page.title.replace(/\s*\([^)]*\)\s*$/,''));
        const text=`${page.title} ${page.extract || ''} ${(page.categories || []).map((item) => item.title).join(' ')}`.toLowerCase();
        const titleScore=pageKey === expected ? 10 : pageKey.includes(expected) || expected.includes(pageKey) ? 5 : 0;
        let score=titleScore;
        if (!titleScore) return { page,text,score:-20 };
        const pageYear=page.title.match(/\(((?:19|20)\d{2})\b/)?.[1];
        if (pageYear && year && pageYear !== year) score -= 10;
        if (pageYear && year && pageYear === year) score += 5;
        if (row.type === 'movie' && /\((?:(?:19|20)\d{2} )?(?:film|movie)\)/i.test(page.title)) score += 3;
        if (row.type === 'series' && /\((?:(?:19|20)\d{2} )?(?:tv|television|web) series\)/i.test(page.title)) score += 3;
        if (year && text.includes(year)) score += 3;
        if (row.type === 'series' && /(television|tv|web|streaming) series/.test(text)) score += 2;
        if (row.type === 'movie' && /\bfilm\b/.test(text)) score += 2;
        if (/disambiguation|list of/.test(text)) score -= 8;
        return { page,text,score };
    }).sort((a,b) => b.score - a.score)[0] || null;
}

// Detects animation and documentary evidence from the matched page introduction and categories.
function classifyCandidate(candidate) {
    if (!candidate || candidate.score < 10) return { animation:false,documentary:false };
    const page=candidate.page;
    const introduction=String(page.extract || '').split(/\n|(?<=[.!?])\s+/)[0].toLowerCase();
    const descriptor=introduction.match(/\bis (?:an?|the) ([^.]{0,220}?)\b(?:film|movie|television series|tv series|web series|series)\b/)?.[1] || '';
    return {
        animation:/\b(?:animated|anime|stop[- ]motion|computer-animated)\b/.test(descriptor),
        documentary:/\b(?:documentary|docudrama)\b/.test(descriptor),
    };
}

// Applies reviewed exceptions for CGI characters in otherwise live-action films.
function applyReviewOverrides(results) {
    return results.map((item) => {
        if (!REVIEWED_LIVE_ACTION_IDS.has(item.id)) return item;
        const retained=item.existing.filter((value) => value !== 'Live Action');
        const hasNonLive=retained.some((value) => ANIMATION_FORMS.has(value) || DOCUMENTARY_FORMS.has(value));
        return { ...item,detected:{ animation:false,documentary:false },proposed:hasNonLive ? retained : ['Live Action',...retained],reviewedOverride:'Live Action' };
    });
}

// Audits one stored title and returns a proposed presentation classification with evidence.
async function auditRow(row,pages) {
    let existing=[];
    try { existing=JSON.parse(row.presentation_forms_json || '[]'); } catch {}
    try {
        const candidate=selectCandidate(row,pages);
        const detected=classifyCandidate(candidate);
        if (/\blive[- ]action\b/i.test(row.title)) detected.animation=false;
        if (/\b(?:anime|animated|animation)\b/i.test(row.title) && !/\blive[- ]action\b/i.test(row.title)) detected.animation=true;
        if (/\bdocumentar(?:y|ies)\b/i.test(row.title)) detected.documentary=true;
        const hasStoredAnimation=existing.some((value) => ANIMATION_FORMS.has(value));
        const hasStoredDocumentary=existing.some((value) => DOCUMENTARY_FORMS.has(value));
        const animation=detected.animation || hasStoredAnimation;
        const documentary=detected.documentary || hasStoredDocumentary;
        const proposed=existing.filter((value) => value !== 'Live Action');
        if (detected.animation && !proposed.some((value) => ANIMATION_FORMS.has(value))) proposed.push('Animation');
        if (detected.documentary && !proposed.some((value) => DOCUMENTARY_FORMS.has(value))) proposed.push('Documentary');
        if (!animation && !documentary) proposed.unshift('Live Action');
        return {
            id:row.id,title:row.title,type:row.type,releaseDate:row.release_date || '',existing,
            proposed:[...new Set(proposed)],detected,source:candidate?.page?.fullurl || null,
            matchedTitle:candidate?.page?.title || null,matchScore:candidate?.score || 0,
            confidence:candidate?.score >= 13 ? 'high' : candidate?.score >= 10 ? 'moderate' : candidate?.score >= 5 ? 'low' : 'unmatched',
        };
    } catch(error) {
        const animation=existing.some((value) => ANIMATION_FORMS.has(value));
        const documentary=existing.some((value) => DOCUMENTARY_FORMS.has(value));
        return { id:row.id,title:row.title,type:row.type,releaseDate:row.release_date || '',existing,
            proposed:animation || documentary ? existing : ['Live Action',...existing],detected:{ animation:false,documentary:false },
            source:null,matchedTitle:null,matchScore:0,confidence:'unmatched',error:error.message };
    }
}

// Audits the library in small batches that remain within the public API title limit.
async function auditLibrary(rows,batchSize = 10,concurrency = 2) {
    const results=new Array(rows.length);
    const starts=Array.from({ length:Math.ceil(rows.length/batchSize) },(_,index) => index*batchSize);
    let cursor=0;
    let completed=0;
    async function worker() {
        while (cursor < starts.length) {
            const index=starts[cursor++];
            const batch=rows.slice(index,index+batchSize);
            let pages=[];
            try { pages=await fetchWikipediaBatch(batch); }
            catch(error) { pages=[]; process.stderr.write(`Reference batch ${index + 1}-${index + batch.length}: ${error.message}\n`); }
            for (let offset=0;offset<batch.length;offset++) results[index+offset]=await auditRow(batch[offset],pages);
            completed+=batch.length;
            if (completed % 50 === 0 || completed === rows.length) process.stdout.write(`Checked ${completed}/${rows.length}\n`);
        }
    }
    await Promise.all(Array.from({ length:concurrency },worker));
    return results;
}

// Applies a reviewed audit report after creating a verified SQLite backup.
function applyReport(database,results) {
    const { createBackup }=require('../database');
    const backup=createBackup(database,'pre-internet-presentation-audit');
    const now=new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
        const update=database.prepare('UPDATE content_items SET presentation_forms_json=?,updated_at=? WHERE id=?');
        results.filter((item) => JSON.stringify(item.existing) !== JSON.stringify(item.proposed))
            .forEach((item) => update.run(JSON.stringify(item.proposed),now,item.id));
        database.prepare(`INSERT INTO audit_log(action,entity_type,details_json,actor,outcome,metadata_json,created_at)
            VALUES(?,?,?,?,?,?,?)`).run('internet-presentation-audit','library',JSON.stringify({
                checked:results.length,changed:results.filter((item) => JSON.stringify(item.existing) !== JSON.stringify(item.proposed)).length,
                report:path.basename(REPORT_FILE),backup:path.basename(backup),
            }),'cli','success',JSON.stringify({ sources:['Wikipedia'] }),now);
        database.exec('COMMIT');
        return backup;
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

async function main() {
    fs.mkdirSync(EXPORT_DIR,{ recursive:true });
    const database=new DatabaseSync(DATABASE_FILE,{ readOnly:!(APPLY || APPLY_REPORT) });
    if (APPLY_REPORT) {
        if (!fs.existsSync(REPORT_FILE)) throw new Error(`Audit report not found: ${REPORT_FILE}`);
        const report=JSON.parse(fs.readFileSync(REPORT_FILE,'utf8'));
        const results=applyReviewOverrides(report.items || []);
        if (results.length !== database.prepare('SELECT COUNT(*) AS count FROM content_items').get().count) {
            throw new Error('Audit report does not cover the current library');
        }
        const backup=applyReport(database,results);
        database.close();
        console.log(JSON.stringify({ checked:results.length,changed:results.filter((item) => JSON.stringify(item.existing) !== JSON.stringify(item.proposed)).length,report:REPORT_FILE,backup },null,2));
        return;
    }
    const rows=database.prepare('SELECT id,title,type,release_date,presentation_forms_json FROM content_items ORDER BY title COLLATE NOCASE').all();
    const results=applyReviewOverrides(await auditLibrary(rows));
    const summary={
        generatedAt:new Date().toISOString(),checked:results.length,
        changed:results.filter((item) => JSON.stringify(item.existing) !== JSON.stringify(item.proposed)).length,
        detectedAnimation:results.filter((item) => item.detected.animation).length,
        detectedDocumentary:results.filter((item) => item.detected.documentary).length,
        confidence:Object.fromEntries(['high','moderate','low','unmatched'].map((level) => [level,results.filter((item) => item.confidence === level).length])),
    };
    fs.writeFileSync(REPORT_FILE,JSON.stringify({ summary,items:results },null,2));
    let backup=null;
    if (APPLY) backup=applyReport(database,results);
    database.close();
    console.log(JSON.stringify({ ...summary,report:REPORT_FILE,backup },null,2));
}

main().catch((error) => { console.error(error); process.exitCode=1; });
