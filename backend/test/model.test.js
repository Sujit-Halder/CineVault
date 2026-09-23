const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(),'movie-tracker-test-'));
process.env.MOVIE_TRACKER_DATA_DIR = testDirectory;
process.env.MOVIE_TRACKER_SKIP_LEGACY_IMPORT = '1';

const Model = require('../model');
const { database,createBackup } = require('../database');
const { getCatalogs } = require('../catalogs');
const { runWithAccount } = require('../request-context');

// Returns a complete valid payload that individual tests can specialize.
function payload(overrides = {}) {
    const result={
        type:'movie',subtype:'Feature Film',title:'Test title',productionStatus:'Completed',releaseStatus:'Released',releaseDate:'2025-01-01',duration:'100',
        director:'Director',casts:'Performer',rating:'Rewatchable',productionCompany:'Test Studio',genres:['Drama'],presentationForms:['Live Action'],language:['English'],
        awards:[],tags:['Underrated'],countryOfOrigin:['USA'],contentRatings:[{ territory:'IND',code:'U/A' }],
        watchSources:[{ method:'subscription-streaming',provider:'Test Stream' }],watchHistory:[],contentLinks:[],seasons:[],
        ...overrides,
    };
    result.watchHistory=(result.watchHistory || []).map((entry) => ({ ...entry,languageTag:Object.hasOwn(entry,'languageTag') ? entry.languageTag : 'en' }));
    result.seasons=(result.seasons || []).map((season) => ({ ...season,episodes:(season.episodes || []).map((episode) => ({
        ...episode,watchHistory:(episode.watchHistory || []).map((entry) => ({ ...entry,languageTag:Object.hasOwn(entry,'languageTag') ? entry.languageTag : 'en' })),
    })) }));
    return result;
}

test('schema migrations and rating normalization use the current model',() => {
    assert.ok(database.prepare('SELECT 1 FROM schema_migrations WHERE version=24').get());
    assert.ok(database.prepare('SELECT 1 FROM schema_migrations WHERE version=29').get());
    assert.ok(database.prepare('SELECT 1 FROM schema_migrations WHERE version=30').get());
    assert.deepEqual(database.prepare('PRAGMA table_info(content_items)').all().filter((column) => ['watch_date','source_reference'].includes(column.name)),[]);
    assert.deepEqual(database.prepare('PRAGMA table_info(content_items)').all().filter((column) => column.name.endsWith('_json')),[]);
    const item = Model.addContent(payload({ title:'  Normalized rating  ',originalTitle:'  Original  ',subtype:'Animated Feature',director:'  Director  ',casts:'  First   Performer(V) ,  Second Performer (v)  ,, ',productionCompany:'  Test Studio  ',summary:'  Summary text  ',genres:['Fantasy'],presentationForms:['Animation'],contentRatings:[{ territory:'IN',code:'A' },{ territory:'IND',code:'U/A' }] }));
    assert.equal(item.title,'Normalized rating');
    assert.equal(item.subtype,'Feature Film');
    assert.equal(item.originalTitle,'Original');
    assert.equal(item.director,'Director');
    assert.equal(item.casts,'First Performer, Second Performer');
    assert.equal(item.productionCompany,'Test Studio');
    assert.equal(item.summary,'Summary text');
    assert.deepEqual(item.presentationForms,['Animation']);
    assert.deepEqual(item.countryOfOrigin,['US']);
    assert.equal(item.contentRatings[0].territory,'IN');
    assert.equal(item.contentRatings[0].code,'UA 13+');
    assert.equal(item.contentRatings.length,1);
    assert.deepEqual(database.prepare('SELECT name FROM metadata_terms mt JOIN content_metadata_terms cmt ON cmt.term_id=mt.id WHERE cmt.content_id=? AND mt.category=?').all(item.id,'genre').map((row) => row.name),['Fantasy']);
    assert.deepEqual(database.prepare('SELECT language_tag FROM content_languages WHERE content_id=?').all(item.id).map((row) => row.language_tag),['en']);
});

test('invited accounts receive isolated content, statistics, health, and exports',() => {
    const now=new Date().toISOString();
    for (const [id,email,role] of [['owner-a','one@gmail.com','owner'],['member-b','two@gmail.com','member']]) database.prepare(`INSERT OR IGNORE INTO app_users(id,email,display_name,password_hash,password_salt,role,status,created_at,updated_at) VALUES(?,?,?,'hash','salt',?,'active',?,?)`).run(id,email,email,role,now,now);
    const first=runWithAccount({ id:'owner-a',email:'one@gmail.com',role:'owner' },() => Model.addContent(payload({ title:'Owner only title' })));
    const second=runWithAccount({ id:'member-b',email:'two@gmail.com',role:'member' },() => Model.addContent(payload({ title:'Member only title' })));
    runWithAccount({ id:'owner-a',email:'one@gmail.com',role:'owner' },() => {
        assert.deepEqual(Model.getContent({ all:true }).items.map((item) => item.id),[first.id]);
        assert.equal(Model.getById(second.id),null);
        assert.equal(Model.getStatistics().summary.total,1);
        assert.equal(Model.buildExportPayload().content.length,1);
    });
    runWithAccount({ id:'member-b',email:'two@gmail.com',role:'member' },() => {
        assert.deepEqual(Model.getContent({ all:true }).items.map((item) => item.id),[second.id]);
        assert.equal(Model.getById(first.id),null);
        assert.equal(Model.getStatistics().summary.total,1);
        assert.equal(Model.buildExportPayload().content.length,1);
    });
});

test('watch sources retain specific providers and remove redundant duplicate labels',() => {
    const item=Model.addContent(payload({ title:'Source normalization',status:'Watched',duration:'',watchHistory:[{ watchedAt:'2025-01-02T10:00:00.000Z' }],watchSources:[
        { method:'ad-supported-streaming',provider:'  Tubi  ' },
        { method:'ad-supported-streaming',provider:'tubi' },
        { method:'tv-broadcast',provider:'TV Broadcast' },
    ] }));
    assert.deepEqual(item.watchSources,[
        { method:'ad-supported-streaming',provider:'Tubi' },
        { method:'tv-broadcast',provider:'' },
    ]);
});

test('text fields use field-appropriate whitespace normalization',() => {
    const item=Model.addContent(payload({
        title:'  A   Normalized   Title  ',originalTitle:'  Another   Title ',
        director:' First   Director ,  Second Director ,,',casts:' First   Actor,Second Actor ',
        productionCompany:' First   Studio , Second Studio ',summary:'  First   paragraph.  \n\n  Second   paragraph.  ',
        watchSources:[],
        type:'series',subtype:'Limited Series',seriesStartDate:'2025-01-01',seriesEndDate:'2025-02-01',
        seriesNetwork:' Network   One,  Network Two ',seasons:[{ seasonNumber:1,title:'  Opening   Season ',episodes:[{
            episodeNumber:1,title:'  First   Episode ',summary:' First   line.\n\n Second   line. ',duration:'30',watchHistory:[],
        }] }],
    }));
    assert.equal(item.title,'A Normalized Title');
    assert.equal(item.originalTitle,'Another Title');
    assert.equal(item.director,'');
    assert.equal(item.casts,'First Actor, Second Actor');
    assert.equal(item.productionCompany,'First Studio, Second Studio');
    assert.equal(item.seriesNetwork,'Network One, Network Two');
    assert.equal(item.summary,'First paragraph.\n\nSecond paragraph.');
    assert.equal(item.seasons[0].title,'Opening Season');
    assert.equal(item.seasons[0].episodes[0].title,'First Episode');
    assert.equal(item.seasons[0].episodes[0].summary,'First line.\n\nSecond line.');
});

test('an already migrated database can complete a fresh backend startup',() => {
    const result=spawnSync(process.execPath,['-e',"require('./database');"],{
        cwd:path.join(__dirname,'..'),encoding:'utf8',env:{ ...process.env,MOVIE_TRACKER_DATA_DIR:testDirectory,MOVIE_TRACKER_SKIP_LEGACY_IMPORT:'1' },
    });
    assert.equal(result.status,0,result.stderr);
});

test('a clean installation creates runtime state without migration artifacts',() => {
    const cleanDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'cinevault-clean-install-'));
    const result=spawnSync(process.execPath,['-e',"require('./database').database.close();"],{
        cwd:path.join(__dirname,'..'),encoding:'utf8',env:{ ...process.env,MOVIE_TRACKER_DATA_DIR:cleanDirectory,MOVIE_TRACKER_SKIP_LEGACY_IMPORT:'1' },
    });
    assert.equal(result.status,0,result.stderr);
    assert.doesNotMatch(result.stdout,/database\.migration\.completed/);
    assert.deepEqual(fs.readdirSync(cleanDirectory),['movie-tracker.sqlite']);
    const cleanDatabase=new DatabaseSync(path.join(cleanDirectory,'movie-tracker.sqlite'),{ readOnly:true });
    assert.equal(cleanDatabase.prepare('SELECT MAX(version) version FROM schema_migrations').get().version,41);
    assert.equal(cleanDatabase.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.equal(cleanDatabase.prepare("SELECT COUNT(*) count FROM audit_log WHERE actor='migration'").get().count,0);
    cleanDatabase.close();
});

test('silent is a movie presentation form only',() => {
    const catalogs=getCatalogs();
    assert.ok(catalogs.presentationForms.movie.some((group) => group.name === 'Silent'));
    assert.equal(catalogs.presentationForms.series.some((group) => group.name === 'Silent'),false);
    assert.equal(catalogs.subtypes.movie.includes('Silent'),false);
});

test('BCP 47 tags are used for title and per-viewing languages',() => {
    const catalogs=getCatalogs();
    assert.ok(catalogs.languages.some((language) => language.tag === 'cmn' && language.label === 'Mandarin'));
    assert.ok(catalogs.languages.some((language) => language.tag === 'yue' && language.label === 'Cantonese'));
    const item=Model.addContent(payload({ title:'Language-tagged viewing',language:['Bengali'],watchHistory:[{ watchedAt:'2025-01-02T10:00:00.000Z',languageTag:'bn' }] }));
    assert.deepEqual(item.language,['bn']);
    assert.equal(item.watchHistory[0].languageTag,'bn');
    const exported=Model.buildExportPayload({ ids:[item.id],format:'clean' });
    assert.equal(exported.content[0].watchHistory[0].languageTag,'bn');
    Model.deleteContent(item.id); Model.permanentlyDeleteContent(item.id);
    assert.throws(() => Model.addContent(payload({ title:'Missing movie watch language',watchHistory:[{ watchedAt:'2025-01-02T10:00:00.000Z',languageTag:'' }] })),/Watched in language is required/);
    assert.throws(() => Model.addContent(payload({ type:'series',title:'Missing episode watch language',releaseStatus:'Airing',seriesStartDate:'2025-01-01',seasons:[{ seasonNumber:1,episodes:[{ episodeNumber:1,airDate:'2025-01-01',watchHistory:[{ watchedAt:'2025-01-02T10:00:00.000Z',languageTag:'' }] }] }] })),/Watched in language is required/);
    assert.throws(() => database.prepare('INSERT INTO watch_history(id,content_id,watched_at,language_tag,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('blank-language',item.id,'2025-01-02T10:00:00.000Z','','2025-01-02T10:00:00.000Z','2025-01-02T10:00:00.000Z'),/Watch language is required/);
});

test('series subtypes describe structure rather than lifecycle',() => {
    const catalogs=getCatalogs();
    assert.deepEqual(catalogs.subtypes.series,['Regular Series','Limited Series','Anthology Series']);
    assert.equal(catalogs.subtypes.series.includes('Continuing Series'),false);
});

test('viewing status is calculated rather than accepted as editable status',() => {
    assert.equal(Model.addContent(payload({ title:'No watch record',viewingStatus:'Watched' })).viewingStatus,'Not Watched');
});

test('release and watch chronology rules protect movies and series',() => {
    assert.throws(() => Model.addContent(payload({ title:'Impossible calendar date',releaseDate:'2025-02-31' })),/real calendar date/);
    assert.throws(() => Model.addContent(payload({ title:'Impossible watch date',watchHistory:[{ watchedAt:'2025-04-31T10:00:00.000Z' }] })),/real calendar date/);
    assert.equal(Model.addContent(payload({ title:'Announced without release',status:'Announced',releaseDate:'' })).releaseDate,'');
    assert.throws(() => Model.addContent(payload({ title:'Watched without release',releaseDate:'',watchHistory:[{ watchedAt:'2025-01-31T10:00:00.000Z' }] })),/Release date is required after a viewing/);
    assert.throws(() => Model.addContent(payload({ type:'series',title:'Watched series without release',releaseDate:'',seriesStartDate:'',releaseStatus:'Airing',seasons:[{ seasonNumber:1,episodes:[{ episodeNumber:1,watchHistory:[{ watchedAt:'2025-01-31T10:00:00.000Z' }] }] }] })),/Release date is required after a viewing/);
    assert.throws(() => Model.addContent(payload({ title:'Early movie watch',releaseDate:'2025-02-01',status:'Watched',watchHistory:[{ watchedAt:'2025-01-31T10:00:00.000Z' }] })),/earlier than the release date/);
    assert.throws(() => Model.addContent(payload({ type:'series',title:'Invalid series timeline',seriesStartDate:'2025-02-01',seriesEndDate:'2025-02-01' })),/later than its release date/);
    assert.throws(() => Model.addContent(payload({ type:'series',title:'Early episode watch',status:'Watched',seriesStartDate:'2025-02-01',seriesContinuing:true,seasons:[{ seasonNumber:1,episodes:[{ episodeNumber:1,airDate:'2025-02-03',watchHistory:[{ watchedAt:'2025-02-02T10:00:00.000Z' }] }] }] })),/cannot be earlier than release date/);
    assert.throws(() => Model.addContent(payload({ title:'Future release',releaseDate:'2999-01-01' })),/Release date cannot be in the future/);
    assert.throws(() => Model.addContent(payload({ title:'Future movie watch',status:'Watched',watchHistory:[{ watchedAt:new Date(Date.now() + 60000).toISOString() }] })),/cannot be in the future/);
    assert.throws(() => Model.addContent(payload({ type:'series',title:'Future episode release',seriesStartDate:'2025-01-01',seriesContinuing:true,seasons:[{ seasonNumber:1,episodes:[{ episodeNumber:1,airDate:'2999-01-01',watchHistory:[] }] }] })),/Episode release dates cannot be in the future/);
    assert.doesNotThrow(() => {
        const sameDay = Model.addContent(payload({ type:'series',title:'Same local calendar day',seriesStartDate:'2026-09-19',seriesContinuing:true,seasons:[{ seasonNumber:1,episodes:[{ episodeNumber:1,airDate:'2026-09-19',watchHistory:[{ watchedAt:'2026-09-18T18:31:35.069Z' }] }] }] }));
        Model.deleteContent(sameDay.id);
        Model.permanentlyDeleteContent(sameDay.id);
    });
});

test('movie creation, updating, watch history, filters, and title ordering remain stable',() => {
    const movie = Model.addContent(payload({
        title:'Alpha',status:'Watched',genres:['Drama','Psychological'],countryOfOrigin:['US','IN'],
        watchHistory:[{ watchedAt:'2025-01-01T10:00:00.000Z' },{ watchedAt:'2025-01-02T10:00:00.000Z' }],
        contentLinks:[{ url:'https://example.com/alpha' }],
    }));
    const updated = Model.updateContent({ ...movie,title:'Alpha updated',seasons:[],watchHistory:movie.watchHistory,contentLinks:movie.contentLinks });
    assert.equal(updated.watchHistory.length,2);
    assert.equal(Model.getContent({ genres:'Drama,Psychological' }).total,1);
    assert.equal(Model.getContent({ countries:'US,IN' }).total,1);
    assert.equal(Model.getContent({ watchSources:'subscription-streaming' }).total,1);
    assert.equal(Model.getContent({ type:'movie',subtype:'Feature Film',viewingStatus:'Watched',rating:'Rewatchable',releaseYear:'2025' }).items.some((item) => item.id === movie.id),true);
    assert.equal(Model.getContent({ languages:'English',tags:'Underrated',productionCompanies:'Test Studio',linkDomains:'example.com' }).items.some((item) => item.id === movie.id),true);
    assert.equal(Model.getContent({ search:'Test Studio' }).items.some((item) => item.id === movie.id),true);
    assert.equal(Model.getContent({ genres:'Drama,Comedy' }).total,0);
    Model.toggleFavorite(movie.id);
    assert.equal(Model.getContent({ favorite:'true' }).items.some((item) => item.id === movie.id),true);
    Model.addContent(payload({ title:'9 Numeric' }));
    Model.addContent(payload({ title:'! Symbol' }));
    Model.addContent(payload({ title:'Zulu' }));
    const sameTitleSeries=Model.addContent(payload({ type:'series',subtype:'Limited Series',title:'Alpha updated',status:'Released',seriesEndDate:'2025-12-31',seriesNetwork:'Test Network',seasons:[] }));
    assert.equal(sameTitleSeries.type,'series');
    assert.throws(() => Model.addContent(payload({ title:'Alpha updated' })),/release date already exists/);
    const ascending = Model.getContent({ sort:'title',order:'ascending',limit:100 }).items.map((item) => item.title);
    const descending = Model.getContent({ sort:'title',order:'descending',limit:100 }).items.map((item) => item.title);
    assert.ok(ascending.indexOf('! Symbol') < ascending.indexOf('9 Numeric') && ascending.indexOf('9 Numeric') < ascending.indexOf('Alpha updated') && ascending.indexOf('Alpha updated') < ascending.indexOf('Zulu'));
    assert.ok(descending.indexOf('Zulu') < descending.indexOf('Alpha updated') && descending.indexOf('Alpha updated') < descending.indexOf('9 Numeric') && descending.indexOf('9 Numeric') < descending.indexOf('! Symbol'));
    ['creation','releaseDate','duration','watchDate','modification'].forEach((sort) => {
        assert.doesNotThrow(() => Model.getContent({ sort,order:'ascending',limit:100 }));
        assert.doesNotThrow(() => Model.getContent({ sort,order:'descending',limit:100 }));
    });
    const watchDateResults=Model.getContent({ sort:'watchDate',order:'descending',limit:100 }).items;
    assert.ok(watchDateResults.length > 0);
    assert.ok(watchDateResults.every((item) => ['Watched','In Progress','Completed'].includes(item.viewingStatus)));
    assert.equal(watchDateResults.some((item) => item.title === '9 Numeric' || item.title === '! Symbol' || item.title === 'Zulu'),false);
});

test('every supported filter is applied by the backend',() => {
    const item=Model.addContent(payload({
        title:'Complete filter target',originalTitle:'Filter original',presentationForms:['Live Action'],awards:['Academy Award'],
        productionStatus:'Completed',releaseStatus:'Released',genres:['Drama'],language:['English'],tags:['Underrated'],countryOfOrigin:['US'],
        contentRatings:[{ territory:'US',code:'PG-13' }],watchSources:[{ method:'subscription-streaming',provider:'Filter Stream' }],
        contentLinks:[{ url:'https://catalog.example/filter-target' }],productionCompanies:['Filter Company Limited'],favorite:true,
        watchHistory:[{ watchedAt:'2025-01-02T10:00:00.000Z' }],
    }));
    const filters={ type:'movie',subtype:'Feature Film',productionStatus:'Completed',releaseStatus:'Released',viewingStatus:'Watched',
        genres:'Drama',presentationForms:'Live Action',languages:'English',tags:'Underrated',rating:'Rewatchable',awards:'Academy Award',
        countries:'US',releaseYear:'2025',productionCompanies:'Filter Company Limited',watchSources:'subscription-streaming',linkDomains:'catalog.example',favorite:'true' };
    Object.entries(filters).forEach(([key,value]) => assert.equal(Model.getContent({ [key]:value,limit:100 }).items.some((entry) => entry.id === item.id),true,`${key} filter`));
    assert.equal(Model.getContent({ search:'Filter original',limit:100 }).items.some((entry) => entry.id === item.id),true);
    Model.deleteContent(item.id); Model.permanentlyDeleteContent(item.id);
});

test('bulk lifecycle editing is bounded and validates type-specific values',() => {
    const one=Model.addContent(payload({ title:'Bulk one',productionStatus:'Announced',releaseStatus:'Upcoming' }));
    const two=Model.addContent(payload({ title:'Bulk two',productionStatus:'Announced',releaseStatus:'Upcoming' }));
    const result=Model.bulkUpdateContent({ ids:[one.id,two.id],field:'productionStatus',value:'Completed' });
    assert.equal(result.updated,2);
    assert.equal(Model.getById(one.id).productionStatus,'Completed');
    assert.throws(() => Model.bulkUpdateContent({ ids:[one.id],field:'releaseStatus',value:'Airing' }),/not valid for every selected content type/);
    assert.throws(() => Model.bulkUpdateContent({ ids:Array.from({ length:101 },(_,index) => String(index)),field:'productionStatus',value:'Completed' }),/100/);
});

test('Data Health reports every maintained integrity category',() => {
    const health=Model.getDataHealth().checks;
    ['missingPosters','missingReleaseDates','invalidUrls','watchedWithoutRuntime','seriesWithoutSeasons','seasonsWithoutEpisodes','duplicateTitles',
        'unclassifiedRatings','emptyProductionCompanies','unrecognizedCatalogValues','inconsistentSeriesLifecycle','incompleteWatchingSources','incompleteEpisodes','unrecognizedSeriesCredits']
        .forEach((key) => { assert.equal(typeof health[key],'object',`missing ${key}`); assert.ok(Array.isArray(health[key].items),`${key} has no items`); });
});

test('reviewed canonical cleanup updates provider, network, and credit-name variants',() => {
    const providerOne=Model.addContent(payload({ title:'Provider spelling one',watchHistory:[{ watchedAt:'2025-01-02T10:00:00.000Z' }],watchSources:[{ method:'subscription-streaming',provider:'View Now' }] }));
    const providerTwo=Model.addContent(payload({ title:'Provider spelling two',watchHistory:[{ watchedAt:'2025-01-03T10:00:00.000Z' }],watchSources:[{ method:'subscription-streaming',provider:'ViewNow' }] }));
    const networkOne=Model.addContent(payload({ type:'series',subtype:'Limited Series',title:'Network spelling one',seriesStartDate:'2025-01-01',seriesEndDate:'2025-01-02',seriesNetwork:'H.B.O.',seriesCredits:[{ name:'Jane Doe',role:'Creator' }],seasons:[] }));
    const networkTwo=Model.addContent(payload({ type:'series',subtype:'Limited Series',title:'Network spelling two',seriesStartDate:'2025-01-03',seriesEndDate:'2025-01-04',seriesNetwork:'HBO',seriesCredits:[{ name:'Jane  Doe',role:'Creator' }],seasons:[] }));
    const suggestions=Model.getDataHealth().checks.canonicalSuggestions;
    assert.ok(suggestions.some((group) => group.category === 'watchProvider'));
    assert.ok(suggestions.some((group) => group.category === 'network'));
    Model.mergeCanonicalValues({ category:'watchProvider',preferred:'ViewNow',variants:['View Now','ViewNow'] });
    Model.mergeCanonicalValues({ category:'network',preferred:'HBO',variants:['H.B.O.','HBO'] });
    assert.equal(Model.getById(providerOne.id).watchSources[0].provider,'ViewNow');
    assert.equal(Model.getById(providerTwo.id).watchSources[0].provider,'ViewNow');
    assert.equal(Model.getById(networkOne.id).seriesNetwork,'HBO');
    [providerOne,providerTwo,networkOne,networkTwo].forEach((item) => { Model.deleteContent(item.id); Model.permanentlyDeleteContent(item.id); });
});

test('multiple series are hydrated with complete batched structures',() => {
    const makeSeries=(title,date) => Model.addContent(payload({ type:'series',subtype:'Limited Series',title,seriesStartDate:date,seriesEndDate:'2025-12-31',seasons:[{ seasonNumber:1,episodes:[{ episodeNumber:1,duration:'25',airDate:date,watchHistory:[] }] }] }));
    const first=makeSeries('Batch series one','2025-03-01'); const second=makeSeries('Batch series two','2025-04-01');
    const page=Model.getContent({ type:'series',search:'Batch series',limit:100 });
    assert.equal(page.items.find((item) => item.id === first.id).seasons[0].episodes[0].duration,'25');
    assert.equal(page.items.find((item) => item.id === second.id).seasons[0].episodes[0].duration,'25');
    [first,second].forEach((item) => { Model.deleteContent(item.id); Model.permanentlyDeleteContent(item.id); });
});

test('lifecycle rules retain only metadata applicable to calculated viewing and release status',() => {
    const announced=Model.addContent(payload({
        title:'Lifecycle announced',productionStatus:'Announced',releaseStatus:'Unscheduled',releaseDate:'',rating:'Rewatchable',awards:['Academy Award'],
        posterUrl:'https://example.com/poster',trailerUrl:'https://example.com/trailer',watchSources:[{ method:'cinema',provider:'Example' }],
        watchHistory:[],contentLinks:[{ url:'https://example.com/title' }],
    }));
    assert.equal(announced.releaseDate,'');
    assert.equal(announced.rating,'');
    assert.equal(announced.duration,'');
    assert.equal(announced.posterUrl,'');
    assert.equal(announced.trailerUrl,'');
    assert.deepEqual(announced.awards,[]);
    assert.deepEqual(announced.tags,[]);
    assert.deepEqual(announced.contentRatings,[]);
    assert.deepEqual(announced.watchSources,[]);
    assert.deepEqual(announced.watchHistory,[]);
    assert.deepEqual(announced.contentLinks,[]);
    const trailer=Model.addContent(payload({ title:'Lifecycle trailer',releaseStatus:'Upcoming',releaseDate:'',trailerUrl:'https://example.com/trailer' }));
    assert.equal(trailer.trailerUrl,'https://example.com/trailer');
});

test('blank season and episode titles use their submitted numbers',() => {
    const item=Model.addContent(payload({
        type:'series',subtype:'Limited Series',title:'Default structure titles',seriesStartDate:'2025-01-01',seriesEndDate:'2025-02-01',
        seasons:[{ seasonNumber:3,title:'   ',releaseDate:'2025-01-02',synopsis:'  Season   overview. ',completionStatus:'In Progress',episodes:[
            { episodeNumber:7,title:'',episodeType:'Pilot',director:' First   Director, Second Director ',duration:'30',watchHistory:[] },
            { episodeNumber:8,title:'',episodeType:'Regular',director:'',airDate:'2025-01-03',duration:'31',watchHistory:[] },
        ] }],
    }));
    assert.equal(item.seasons[0].title,'Season 3');
    assert.equal(item.seasons[0].episodes[0].title,'Episode 7');
    assert.equal(item.seasons[0].synopsis,'Season overview.');
    assert.equal(item.seasons[0].completionStatus,'Not Started');
    assert.equal(item.seasons[0].episodes[0].episodeType,'Pilot');
    assert.equal(item.seasons[0].episodes[0].director,'First Director, Second Director');
    assert.equal(item.seasons[0].episodes[0].airDate,'2025-01-02');
    assert.equal(item.seasons[0].episodes[1].airDate,'2025-01-03');
});

test('expanded structural episode types are stored without being downgraded',() => {
    const item=Model.addContent(payload({
        type:'series',subtype:'Regular Series',title:'Episode type catalog',seriesStartDate:'2025-01-01',seriesEndDate:'2025-02-01',
        seasons:[{ seasonNumber:1,releaseDate:'2025-01-01',episodes:[{ episodeNumber:1,episodeType:'Backdoor Pilot',airDate:'2025-01-01',duration:'30',watchHistory:[] }] }],
    }));
    assert.equal(item.seasons[0].episodes[0].episodeType,'Backdoor Pilot');
});

test('production companies store full names and retain submitted aliases',() => {
    const item=Model.addContent(payload({ title:'Expanded company title',productionCompanies:['Example Co. Ltd.'] }));
    assert.equal(item.productionCompany,'Example Company Limited');
    const company=database.prepare("SELECT id,name FROM production_companies WHERE name='Example Company Limited'").get();
    assert.ok(company);
    assert.equal(database.prepare("SELECT company_id FROM production_company_aliases WHERE alias='Example Co. Ltd.'").get().company_id,company.id);
    assert.equal(Model.searchProductionCompanies('Example Co. Ltd.')[0].name,'Example Company Limited');
    const variantId='example-company-variant';
    database.prepare('INSERT INTO production_companies(id,name,canonical_name) VALUES(?,?,?)').run(variantId,'Example-Company Limited','examplecompanylimited');
    const result=Model.mergeProductionCompanies({ keepId:company.id,mergeIds:[variantId],preferredName:'Example Company Limited' });
    assert.equal(result.merged,1);
    assert.equal(database.prepare('SELECT 1 FROM production_companies WHERE id=?').get(variantId),undefined);
    assert.equal(database.prepare("SELECT company_id FROM production_company_aliases WHERE alias='Example-Company Limited'").get().company_id,company.id);
    const otherId='existing-preferred-company';
    const renamedVariantId='renamed-company-variant';
    database.prepare('INSERT INTO production_companies(id,name,canonical_name) VALUES(?,?,?)').run(otherId,'Verified Example Studios','verifiedexamplestudios');
    database.prepare('INSERT INTO production_companies(id,name,canonical_name) VALUES(?,?,?)').run(renamedVariantId,'Example Studios Variant','examplestudiosvariant');
    const collision=Model.mergeProductionCompanies({ keepId:renamedVariantId,mergeIds:[company.id],preferredName:'Verified Example Studios' });
    assert.equal(collision.company.id,otherId);
    assert.equal(collision.reusedExistingCanonical,true);
    assert.equal(database.prepare('SELECT 1 FROM production_companies WHERE id=?').get(renamedVariantId),undefined);
});

test('episode histories drive series completion, rewatches, and viewing minutes',() => {
    const series = Model.addContent(payload({
        type:'series',subtype:'Limited Series',title:'Measured series',duration:'',productionStatus:'Completed',releaseStatus:'Airing',watchHistory:[],seriesStartDate:'2025-02-01',
        seasons:[{ seasonNumber:1,title:'One',episodes:[
            { episodeNumber:1,title:'Opening',airDate:'2025-02-02',duration:'40',watchHistory:[{ watchedAt:'2025-02-03T10:00:00.000Z' },{ watchedAt:'2025-02-04T10:00:00.000Z' }] },
            { episodeNumber:2,title:'Finale',duration:'50',watchHistory:[{ watchedAt:'2025-02-05T10:00:00.000Z' }] },
        ] }],
    }));
    assert.equal(series.seasons[0].episodes[0].watchHistory.length,2);
    assert.equal(series.seriesContinuing,true);
    assert.equal(series.seriesNetwork,'');
    assert.equal(series.releaseDate,series.seriesStartDate);
    assert.equal(series.seasons[0].episodes[0].airDate,'2025-02-02');
    const savedAgain = Model.updateContent({ ...series,seasons:series.seasons });
    assert.equal(savedAgain.seasons[0].episodes[0].watchHistory.length,2);
    assert.equal(savedAgain.seasons[0].completionStatus,'Completed');
    const statistics = Model.getStatistics();
    assert.equal(statistics.summary.episodesWatched,2);
    assert.equal(statistics.summary.episodeWatchSessions,3);
    assert.equal(statistics.summary.seriesWatchCycles,1);
    assert.equal(statistics.summary.rewatchedEpisodes,1);
    assert.equal(statistics.summary.completedSeasons,1);
    assert.equal(statistics.summary.completedSeries,1);
    assert.equal(statistics.summary.partiallyWatchedSeries,0);
    assert.equal(statistics.summary.totalMinutesWatched,330);
    assert.equal(Model.buildExportPayload().episodeWatchHistory.length,3);
});

test('an ended series requires an end date',() => {
    assert.throws(() => Model.addContent(payload({ type:'series',subtype:'Limited Series',title:'Missing series end',releaseStatus:'Ended',seasons:[] })),/End date is required/);
});

test('trash can restore entries and permanent deletion creates a recovery backup',() => {
    const recoverable = Model.addContent(payload({ title:'Recoverable' }));
    Model.deleteContent(recoverable.id);
    assert.equal(Model.getContent({ trashed:'true' }).items.some((item) => item.id === recoverable.id),true);
    assert.equal(Model.restoreContent(recoverable.id).item.id,recoverable.id);
    Model.deleteContent(recoverable.id);
    const result = Model.permanentlyDeleteContent(recoverable.id);
    assert.equal(fs.existsSync(result.backupFile),true);
    assert.equal(Model.getContent({ trashed:'true',limit:100 }).items.some((item) => item.id === recoverable.id),false);
});

test('watch history and content links preserve row creation timestamps during updates',() => {
    const item=Model.addContent(payload({ title:'Stable child rows',status:'Watched',watchHistory:[{ watchedAt:'2025-01-02T10:00:00.000Z' }],contentLinks:[{ url:'https://example.com/old' }] }));
    const watchBefore=database.prepare('SELECT * FROM watch_history WHERE content_id=?').get(item.id);
    const linkBefore=database.prepare('SELECT * FROM content_links WHERE content_id=?').get(item.id);
    const updated=Model.updateContent({ ...item,watchHistory:[{ ...item.watchHistory[0],watchedAt:'2025-01-03T10:00:00.000Z' }],contentLinks:[{ ...item.contentLinks[0],url:'https://example.com/new' }] });
    const watchAfter=database.prepare('SELECT * FROM watch_history WHERE content_id=?').get(item.id);
    const linkAfter=database.prepare('SELECT * FROM content_links WHERE content_id=?').get(item.id);
    assert.equal(watchAfter.id,watchBefore.id); assert.equal(watchAfter.created_at,watchBefore.created_at);
    assert.equal(watchAfter.watched_at,'2025-01-03T10:00:00.000Z');
    assert.equal(linkAfter.id,linkBefore.id); assert.equal(linkAfter.created_at,linkBefore.created_at);
    assert.equal(updated.contentLinks[0].url,'https://example.com/new');
});

test('restore conflicts require an explicit replace or merge decision',() => {
    const original=Model.addContent(payload({ title:'Restore identity',status:'Watched',watchHistory:[{ watchedAt:'2025-01-02T10:00:00.000Z' }],tags:['Original'],contentLinks:[{ url:'https://example.com/original' }] }));
    Model.deleteContent(original.id);
    const active=Model.addContent(payload({ title:'Restore identity',status:'Watched',watchHistory:[{ watchedAt:'2025-01-03T10:00:00.000Z' }],tags:['Active'],contentLinks:[{ url:'https://example.com/active' }] }));
    assert.throws(() => Model.restoreContent(original.id),(error) => error.status === 409 && error.code === 'RESTORE_CONFLICT');
    const merged=Model.restoreContent(original.id,'merge');
    assert.equal(merged.resolution,'merge'); assert.equal(merged.item.id,active.id);
    assert.deepEqual(new Set(merged.item.tags),new Set(['Original','Active']));
    assert.equal(merged.item.contentLinks.length,2);
    assert.equal(database.prepare('SELECT 1 FROM content_items WHERE id=?').get(original.id),undefined);

    const replacedOriginal=Model.addContent(payload({ title:'Restore replacement' }));
    Model.deleteContent(replacedOriginal.id);
    const replacedActive=Model.addContent(payload({ title:'Restore replacement' }));
    const replaced=Model.restoreContent(replacedOriginal.id,'replace');
    assert.equal(replaced.item.id,replacedOriginal.id);
    assert.ok(database.prepare('SELECT deleted_at FROM content_items WHERE id=?').get(replacedActive.id).deleted_at);
});

test('JSON imports preview conflicts and apply only reviewed decisions',() => {
    const exported=Model.buildExportPayload();
    exported.content.push(payload({ id:'portable-new',title:'Portable new title' }));
    exported.content.push(payload({ id:'portable-history',title:'Portable historical chronology',releaseDate:'2025-01-02',watchHistory:[{ watchedAt:'2025-01-01T10:00:00.000Z' }] }));
    const preview=Model.previewImport(exported);
    assert.ok(preview.conflicts > 0);
    assert.equal(preview.newItems,2);
    assert.equal(preview.invalidItems,1);
    assert.match(preview.items.find((item) => item.importId === 'portable-history').issues[0],/before release date/);
    const result=Model.applyImport(exported,{}, {},{ validOnly:true });
    assert.equal(result.added,1);
    assert.equal(result.skippedInvalid,1);
    assert.equal(result.skipped,preview.conflicts);
    assert.equal(Model.getContent({ search:'Portable new title' }).total,1);
    assert.equal(Model.getContent({ search:'Portable historical chronology' }).total,0);

    const rejected={ schemaVersion:4,content:[
        payload({ id:'atomic-valid',title:'Atomic import valid' }),
        payload({ id:'atomic-invalid',title:'Atomic import invalid',releaseDate:'2025-01-02',watchHistory:[{ watchedAt:'2025-01-01T10:00:00.000Z' }] }),
    ] };
    assert.throws(() => Model.applyImport(rejected,{}),/before release date/);
    assert.equal(Model.getContent({ search:'Atomic import valid' }).total,0);
});

test('view-scoped complete and clean exports retain details without changing entries',() => {
    const source=Model.addContent(payload({ title:'Scoped export title',watchHistory:[{ watchedAt:'2025-01-03T10:00:00.000Z' }],contentLinks:[{ url:'https://example.com/watch' }] }));
    const before=Model.getById(source.id).modification;
    const complete=Model.buildExportPayload({ format:'complete',scope:'Selection',ids:[source.id] });
    assert.equal(complete.exportType,'complete');
    assert.equal(complete.isSubset,true);
    assert.equal(complete.content.length,1);
    assert.equal(complete.content[0].id,source.id);
    assert.equal(complete.watchHistory.length,1);
    assert.equal(complete.contentLinks.length,1);

    const clean=Model.buildExportPayload({ format:'clean',scope:'Filtered movies',query:{ search:'Scoped export title',type:'movie',sort:'title',order:'ascending' } });
    assert.equal(clean.exportType,'clean');
    assert.equal(clean.content.length,1);
    assert.equal(Object.hasOwn(clean.content[0],'id'),false);
    assert.equal(Object.hasOwn(clean.content[0],'creation'),false);
    assert.equal(Object.hasOwn(clean.content[0].watchHistory[0],'id'),false);
    assert.equal(clean.content[0].contentLinks[0].url,'https://example.com/watch');
    assert.equal(Model.getById(source.id).modification,before);

    const transferable=structuredClone(clean);
    transferable.content[0].title='Clean transfer rebuilt';
    const preview=Model.previewImport(transferable);
    assert.equal(preview.validItems,1);
    const imported=Model.applyImport(transferable,{});
    assert.equal(imported.added,1);
    const rebuilt=Model.getContent({ search:'Clean transfer rebuilt',limit:1 }).items[0];
    assert.notEqual(rebuilt.id,source.id);
    assert.equal(rebuilt.watchHistory.length,1);
    assert.equal(rebuilt.contentLinks.length,1);

    const trashed=Model.addContent(payload({ title:'Exported safety recovery' }));
    Model.deleteContent(trashed.id);
    const trashExport=Model.buildExportPayload({ format:'complete',scope:'Trash',ids:[trashed.id] });
    assert.equal(trashExport.content[0].deletedAt,null);
    assert.equal(Object.hasOwn(Model.buildExportPayload({ format:'clean',scope:'Trash',ids:[trashed.id] }).content[0],'trashed'),false);
});

test('import strategies either add new identities or transactionally replace the library',() => {
    const retained=Model.addContent(payload({ title:'Import strategy retained' }));
    const additive={ schemaVersion:4,exportType:'clean',content:[
        payload({ title:'Import strategy retained',id:undefined }),
        payload({ title:'Import strategy added',id:undefined }),
    ] };
    const appended=Model.applyImport(additive,{}, {},{ validOnly:true,strategy:'add-new' });
    assert.equal(appended.added,1); assert.equal(appended.skipped,1);
    assert.equal(Model.getById(retained.id).title,'Import strategy retained');

    const replacement={ schemaVersion:4,exportType:'clean',content:[payload({ title:'Replacement library title',id:undefined })] };
    const replaced=Model.applyImport(replacement,{}, {},{ strategy:'replace-library' });
    assert.equal(replaced.added,1);
    assert.equal(Model.getContent({ all:true }).total,1);
    assert.equal(Model.getContent({ search:'Replacement library title' }).total,1);
    assert.equal(Model.getContent({ search:'Import strategy retained' }).total,0);

    const partial={ ...replacement,scope:'Movies',isSubset:true,content:[payload({ title:'Confirmed subset replacement',id:undefined })] };
    assert.throws(() => Model.applyImport(partial,{}, {},{ strategy:'replace-library' }),/REPLACE WITH SUBSET/);
    assert.equal(Model.getContent({ search:'Replacement library title' }).total,1);
    const confirmed=Model.applyImport(partial,{}, {},{ strategy:'replace-library',subsetConfirmation:'REPLACE WITH SUBSET' });
    assert.equal(confirmed.added,1);
    assert.equal(Model.getContent({ search:'Confirmed subset replacement' }).total,1);
});

test('verified backups can be restored into an isolated data directory',() => {
    const backup = createBackup(database,'test-restore');
    const verification = new DatabaseSync(backup,{ readOnly:true });
    assert.equal(verification.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    verification.close();
    const restoreDirectory = fs.mkdtempSync(path.join(os.tmpdir(),'movie-tracker-restore-'));
    const active=path.join(restoreDirectory,'movie-tracker.sqlite');
    fs.copyFileSync(backup,active);
    fs.writeFileSync(`${active}-wal`,'stale-wal-sidecar');
    fs.writeFileSync(`${active}-shm`,'stale-shm-sidecar');
    const result = spawnSync(process.execPath,[path.join(__dirname,'..','scripts','restore.js'),backup],{
        env:{ ...process.env,MOVIE_TRACKER_DATA_DIR:restoreDirectory,MOVIE_TRACKER_SKIP_LEGACY_IMPORT:'1' },encoding:'utf8',
    });
    assert.equal(result.status,0,result.stderr);
    const preservedWal=fs.readdirSync(restoreDirectory).find((name) => name.includes('.before-restore-') && name.endsWith('-wal'));
    const preservedShm=fs.readdirSync(restoreDirectory).find((name) => name.includes('.before-restore-') && name.endsWith('-shm'));
    assert.equal(fs.readFileSync(path.join(restoreDirectory,preservedWal),'utf8'),'stale-wal-sidecar');
    assert.equal(fs.readFileSync(path.join(restoreDirectory,preservedShm),'utf8'),'stale-shm-sidecar');
    const restored = new DatabaseSync(active,{ readOnly:true });
    assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.ok(restored.prepare("SELECT 1 FROM audit_log WHERE action='restore'").get());
    restored.close();
    fs.rmSync(restoreDirectory,{ recursive:true,force:true });
});

test('off-device backups are encrypted and decrypt to an integral SQLite database',() => {
    const mirror=fs.mkdtempSync(path.join(os.tmpdir(),'movie-tracker-mirror-'));
    const recovered=path.join(mirror,'recovered.sqlite');
    process.env.BACKUP_MIRROR_DIR=mirror;
    process.env.BACKUP_ENCRYPTION_PASSPHRASE='test-only-long-passphrase';
    const backup=createBackup(database,'encrypted-test');
    const encrypted=fs.readdirSync(mirror).find((name) => name.endsWith('.cvbackup'));
    assert.ok(encrypted);
    assert.notEqual(fs.readFileSync(path.join(mirror,encrypted),{ encoding:'utf8' }).slice(0,16),'SQLite format 3\u0000');
    const result=spawnSync(process.execPath,[path.join(__dirname,'..','scripts','decrypt-backup.js'),path.join(mirror,encrypted),recovered],{
        env:{ ...process.env },encoding:'utf8',
    });
    assert.equal(result.status,0,result.stderr);
    const verification=new DatabaseSync(recovered,{ readOnly:true });
    assert.equal(verification.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    verification.close();
    delete process.env.BACKUP_MIRROR_DIR; delete process.env.BACKUP_ENCRYPTION_PASSPHRASE;
    fs.rmSync(backup,{ force:true }); fs.rmSync(mirror,{ recursive:true,force:true });
});

test('automatic backup retention keeps one daily snapshot for the current day',() => {
    process.env.AUTOMATIC_DAILY_RETENTION_DAYS='30'; process.env.AUTOMATIC_MONTHLY_RETENTION_MONTHS='12';
    createBackup(database,'automatic'); createBackup(database,'automatic');
    const automatic=fs.readdirSync(path.join(testDirectory,'backups')).filter((name) => name.startsWith('automatic.') && name.endsWith('.sqlite'));
    assert.equal(automatic.length,1);
    delete process.env.AUTOMATIC_DAILY_RETENTION_DAYS; delete process.env.AUTOMATIC_MONTHLY_RETENTION_MONTHS;
});

test.after(() => {
    database.close();
    fs.rmSync(testDirectory,{ recursive:true,force:true });
});
