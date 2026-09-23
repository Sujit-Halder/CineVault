const POPULAR_COUNTRIES = ['US','GB','IN','CN','FR','IT','JP','DE','KR','BR','ES','MX','AU','CA'];
const COUNTRY_CODES = `AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW`.split(' ');
const COUNTRY_ALIASES = {
    'united states of america':'US','usa':'US','u.s.a.':'US','uk':'GB','great britain':'GB',
    'south korea':'KR','north korea':'KP','russia':'RU','czech republic':'CZ','taiwan':'TW',
    'vietnam':'VN','iran':'IR','syria':'SY','laos':'LA','bolivia':'BO','tanzania':'TZ',
    'venezuela':'VE','moldova':'MD','brunei':'BN','cape verde':'CV','ivory coast':'CI',
    'hong kong':'HK','macao':'MO','macau':'MO','palestine':'PS','state of palestine':'PS','turkey':'TR',
};
const { normalizeSingleLineText } = require('./text-normalization');

// Defines the curated BCP 47 language tags used for audiovisual works and viewing audio.
const LANGUAGES = [
    ['af','Afrikaans'],['ar','Arabic'],['as','Assamese'],['bn','Bengali'],['bg','Bulgarian'],
    ['cmn','Mandarin'],['yue','Cantonese'],['zh','Chinese (unspecified)'],['hr','Croatian'],['cs','Czech'],
    ['da','Danish'],['nl','Dutch'],['en','English'],['fa','Persian'],['fil','Filipino'],['fi','Finnish'],
    ['fr','French'],['de','German'],['el','Greek'],['gu','Gujarati'],['he','Hebrew'],['hi','Hindi'],
    ['hu','Hungarian'],['id','Indonesian'],['it','Italian'],['ja','Japanese'],['kn','Kannada'],['ko','Korean'],
    ['ml','Malayalam'],['ms','Malay'],['mr','Marathi'],['ne','Nepali'],['no','Norwegian'],['or','Odia'],
    ['pa','Punjabi'],['pl','Polish'],['pt','Portuguese'],['ro','Romanian'],['ru','Russian'],['sr','Serbian'],
    ['si','Sinhala'],['es','Spanish'],['sv','Swedish'],['ta','Tamil'],['te','Telugu'],['th','Thai'],
    ['tr','Turkish'],['uk','Ukrainian'],['ur','Urdu'],['vi','Vietnamese'],
].map(([tag,label]) => ({ tag,label }));

const LANGUAGE_ALIASES = new Map(LANGUAGES.flatMap(({ tag,label }) => [[tag.toLowerCase(),tag],[label.toLowerCase(),tag]]));
[
    ['bangla','bn'],['farsi','fa'],['mandarin chinese','cmn'],['cantonese chinese','yue'],
    ['chinese','zh'],['oriya','or'],['tagalog','fil'],['bahasa indonesia','id'],['bahasa melayu','ms'],
].forEach(([name,tag]) => LANGUAGE_ALIASES.set(name,tag));

// Converts supported language names and tags to canonical BCP 47 language tags.
function normalizeLanguageTags(values = []) {
    return [...new Set((Array.isArray(values) ? values : []).map((value) => {
        const text=String(value || '').trim();
        return LANGUAGE_ALIASES.get(text.toLowerCase()) || '';
    }).filter(Boolean))];
}

// Creates the country catalog with popular territories ordered first.
function buildCountries() {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    return COUNTRY_CODES.map((code) => ({ code, name: displayNames.of(code), popular: POPULAR_COUNTRIES.includes(code) }))
        .sort((a, b) => Number(b.popular) - Number(a.popular) || a.name.localeCompare(b.name));
}

// Converts country names and aliases into stable two-letter country codes.
function normalizeCountryCodes(values = []) {
    const countries = buildCountries();
    const byName = new Map(countries.map((country) => [country.name.toLowerCase(), country.code]));
    return [...new Set(values.map((value) => {
        const text = String(value || '').trim();
        const upper = text.toUpperCase();
        if (COUNTRY_CODES.includes(upper)) return upper;
        return COUNTRY_ALIASES[text.toLowerCase()] || byName.get(text.toLowerCase()) || text;
    }).filter(Boolean))];
}

const RATING_SYSTEMS = [
    { territory:'US', authority:'Motion Picture Association / TV Parental Guidelines', codes:['G','PG','PG-13','R','NC-17','TV-Y','TV-Y7','TV-G','TV-PG','TV-14','TV-MA'] },
    { territory:'GB', authority:'British Board of Film Classification', codes:['U','PG','12A','12','15','18','R18'] },
    { territory:'IN', authority:'Central Board of Film Certification', codes:['U','UA 7+','UA 13+','UA 16+','A','S'] },
    { territory:'AU', authority:'Australian Classification Board', codes:['G','PG','M','MA 15+','R 18+','X 18+','RC'] },
    { territory:'CA', authority:'Provincial classification systems', codes:['G','PG','14A','18A','R','A'] },
    { territory:'DE', authority:'FSK', codes:['FSK 0','FSK 6','FSK 12','FSK 16','FSK 18'] },
    { territory:'FR', authority:'CNC', codes:['Tous publics','-12','-16','-18'] },
    { territory:'IT', authority:'Italian classification system', codes:['T','6+','14+','18+'] },
    { territory:'JP', authority:'Eirin', codes:['G','PG12','R15+','R18+'] },
    { territory:'KR', authority:'KMRB', codes:['All','12','15','19','Restricted'] },
    { territory:'BR', authority:'ClassInd', codes:['L','10','12','14','16','18'] },
    { territory:'ES', authority:'ICAA', codes:['A','7','12','16','18','X'] },
    { territory:'MX', authority:'RTC', codes:['AA','A','B','B15','C','D'] },
    { territory:'CN', authority:'No national age classification system', codes:['Unrated'] },
];

const RATING_TERRITORY_ALIASES = { USA:'US', IND:'IN', UK:'GB' };

// Converts stored rating records to the maintained territory and authority catalog.
function normalizeContentRatings(values = []) {
    const normalized = values.map((value) => {
        const rating = typeof value === 'string' ? { code:value } : (value || {});
        const territory = RATING_TERRITORY_ALIASES[String(rating.territory || '').toUpperCase()]
            || String(rating.territory || '').toUpperCase();
        const inferredTerritory = territory || (['U','U/A','A','S'].includes(rating.code) ? 'IN' : 'US');
        const system = RATING_SYSTEMS.find((entry) => entry.territory === inferredTerritory);
        const result = { territory:inferredTerritory, system:system?.authority || rating.system || 'Unspecified', code:String(rating.code || '').trim() };
        if (inferredTerritory === 'IN' && result.code === 'U/A') {
            result.code = 'UA 13+';
            result.previousCode = 'U/A';
            result.classificationBasis = 'Historical U/A baseline';
            result.classificationConfidence = 'moderate';
        }
        return result;
    }).filter((rating) => rating.code);
    return [...new Map(normalized.map((rating) => [rating.territory, rating])).values()];
}

const GENRES = [
    { name:'Action', children:['Buddy Cop','Martial Arts','Superhero','Spy','War'] },
    { name:'Adventure', children:['Disaster','Road','South-Seas','Survival','Sword and Sorcery','Wuxia'] },
    { name:'Comedy', children:['Dark Comedy','Romantic Comedy','Satire','Slapstick','Screwball Comedy'] },
    { name:'Crime', children:['Gangster','Heist','Police Procedural','Prison Film'] },
    { name:'Drama', children:['Coming of Age','Courtroom Drama','Family Drama','Melodrama','Period Drama','Political Drama','Psychological Drama','Social Drama'] },
    { name:'Erotic', children:['Sex'] },
    { name:'Family', children:['Teen'] },
    { name:'Fantasy', children:['Dark Fantasy','High Fantasy','Urban Fantasy'] },
    { name:'Historical', children:['Biographical','Biblical','Epic','Period','Prehistoric'] },
    { name:'Horror', children:['Body Horror','Folk Horror','Found Footage','Gothic','Monster','Slasher','Supernatural','Vampire','Zombie'] },
    { name:'Musical', children:['Backstage Musical','Dance','Jukebox Musical','Music Drama','Opera'] },
    { name:'Mystery', children:['Detective','Locked-Room Mystery','Neo-Noir','Whodunit'] },
    { name:'Indie', children:[] },
    { name:'LGBTQ', children:[] },
    { name:'Masala', children:[] },
    { name:'Religious', children:['Christian','Devotion','Mythology'] },
    { name:'Romance', children:['Historical Romance','Romantic Drama','Tragic Romance'] },
    { name:'Science Fiction', children:['Apocalyptic','Cyberpunk','Dystopian','Space Opera','Time Travel'] },
    { name:'Thriller', children:['Crime Thriller','Erotic Thriller','Legal Thriller','Political Thriller','Psychological Thriller','Techno-Thriller'] },
    { name:'Sport', children:[] },
    { name:'Western', children:['Anti-Western','Contemporary Western','Spaghetti Western'] },
];

const PRESENTATION_FORMS = {
    movie:[
        { name:'Live Action',children:[] },
        { name:'Animation',children:['Anime','Adult Animation','Stop Motion'] },
        { name:'Documentary',children:['Biographical Documentary','Docudrama','Nature Documentary','Propaganda'] },
        { name:'Experimental',children:['Absurdist','Art Film','Surrealist'] },
        { name:'Silent',children:[] },{ name:'Educational',children:[] },{ name:'Concert',children:[] },{ name:'Compilation',children:[] },
    ],
    series:[
        { name:'Live Action',children:[] },
        { name:'Animation',children:['Anime','Adult Animation','Stop Motion'] },
        { name:'Documentary',children:['Biographical Documentary','Docudrama','Nature Documentary','Propaganda'] },
        { name:'Experimental',children:['Absurdist','Art Film','Surrealist'] },
        { name:'Reality',children:[] },{ name:'Talk',children:[] },{ name:'Game/Competition',children:[] },
        { name:'Variety',children:[] },{ name:'News',children:[] },{ name:'Educational',children:[] },
    ],
};

// Keeps only presentation forms supported by the selected content type.
function normalizePresentationForms(type, values = []) {
    const groups=PRESENTATION_FORMS[type === 'series' ? 'series' : 'movie'];
    const allowed=new Set(groups.flatMap((group) => [group.name,...group.children]));
    const selected=[...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter((value) => allowed.has(value)))];
    groups.forEach((group) => {
        if (selected.some((value) => group.children.includes(value))) {
            const parentIndex=selected.indexOf(group.name);
            if (parentIndex >= 0) selected.splice(parentIndex,1);
        }
    });
    return selected;
}

const WATCH_SOURCES = [
    { id:'cinema', label:'Cinema' }, { id:'broadcast-tv', label:'Broadcast television' },
    { id:'subscription-streaming', label:'Subscription streaming' }, { id:'ad-supported-streaming', label:'Ad-supported streaming' },
    { id:'free-legal-streaming', label:'Free legal streaming' }, { id:'digital-rental', label:'Digital rental' },
    { id:'digital-purchase', label:'Digital purchase' }, { id:'physical-media', label:'Physical media' },
    { id:'local-file', label:'Local digital file' }, { id:'library', label:'Library' },
    { id:'festival-screening', label:'Festival or screening' }, { id:'institutional', label:'Educational or institutional access' },
    { id:'travel-entertainment', label:'Airline or hotel entertainment' }, { id:'other', label:'Other' },
    { id:'blu-ray-dvd', label:'Blu-ray / DVD' }, { id:'file-transfer', label:'File Transfer' },
    { id:'free-streaming-site', label:'Free Streaming Site' }, { id:'ott-platform', label:'OTT Platform' },
    { id:'piracy-website', label:'Piracy Website' }, { id:'tv-broadcast', label:'TV Broadcast' },
    { id:'torrent-download', label:'Torrent Download' }, { id:'youtube', label:'YouTube' },
];

const CONTENT_SUBTYPES = {
    movie:['Feature Film','Featurette','Short Film','Television Film','Television Special','Interactive Film'],
    series:['Regular Series','Limited Series','Anthology Series'],
};

const CONTENT_SUBTYPE_DESCRIPTIONS = {
    'Feature Film':'A full-length movie intended as the primary presentation.',
    Featurette:'A medium-length film longer than a short but shorter than a typical feature.',
    'Short Film':'A self-contained film with a substantially shorter runtime than a feature.',
    'Television Film':'A standalone movie produced primarily for television or a television platform.',
    'Television Special':'A standalone television presentation outside a regular episodic season.',
    'Interactive Film':'A film whose viewer choices can influence its sequence or outcome.',
    'Regular Series':'An episodic series designed to continue across one or more seasons.',
    'Limited Series':'A series planned as a finite story with a limited number of episodes or seasons.',
    'Anthology Series':'A series whose stories, settings, or principal characters change between episodes or seasons.',
};

const EPISODE_TYPES = ['Regular','Pilot','Backdoor Pilot','Season Premiere','Midseason Premiere','Midseason Finale','Season Finale','Series Finale','Special','Holiday Special','Recap','Clip Show','Crossover','Two-Part Episode','Bonus','Webisode','Minisode','Unaired Episode'];

const SUBTYPE_ALIASES = {
    feature:'Feature Film',short:'Short Film','documentary-feature':'Documentary Feature','tv-movie':'Television Film','anthology-film':'Anthology Film',
    scripted:'Regular Series','Scripted Series':'Regular Series','Continuing Series':'Regular Series',miniseries:'Limited Series',Miniseries:'Limited Series','limited-series':'Limited Series','anthology-series':'Anthology Series',
    'documentary-series':'Documentary Series',animation:'Animated Series',anime:'Anime Series','web-series':'Web Series',
    reality:'Reality Series',variety:'Variety Series',
    'Animated Feature':'Feature Film','Animation Feature':'Feature Film','Animated Short':'Short Film','Short Animation':'Short Film',
};

// Converts subtype aliases to maintained display labels for the selected content type.
function normalizeSubtype(type, value) {
    const normalized = SUBTYPE_ALIASES[value] || value;
    const options = CONTENT_SUBTYPES[type === 'series' ? 'series' : 'movie'];
    return options.includes(normalized) ? normalized : options[0];
}

const WATCH_SOURCE_PROVIDER_METHODS = new Map(WATCH_SOURCES.map((source) => [source.label.toLowerCase(), source.id]));
const WATCH_SOURCE_BY_ID = new Map(WATCH_SOURCES.map((source) => [source.id,source]));
const WATCH_SOURCE_METHOD_ALIASES = {
    'custom-legacy':'piracy-website','free-streaming-legacy':'free-streaming-site','local-file-legacy':'torrent-download',
    'shared-access-legacy':'shared-account',
};

// Converts viewing-source records into maintained catalog entries without discarding provider details.
function normalizeWatchSources(values = []) {
    const normalized = values.map((value) => {
        const source = typeof value === 'string' ? { provider:value } : (value || {});
        const provider = normalizeSingleLineText(source.provider);
        const providerMethod = WATCH_SOURCE_PROVIDER_METHODS.get(provider.toLowerCase());
        const method = providerMethod || WATCH_SOURCE_METHOD_ALIASES[source.method] || source.method || (provider ? 'other' : '');
        const catalogLabel = WATCH_SOURCE_BY_ID.get(method)?.label || '';
        const result = { method,provider:provider.toLowerCase() === catalogLabel.toLowerCase() ? '' : provider };
        return result;
    }).filter((source) => source.provider || source.method);
    const unique = new Map();
    normalized.forEach((source) => {
        const key=`${source.method}\u0000${source.provider.toLowerCase()}`;
        if (!unique.has(key)) unique.set(key,source);
    });
    return [...unique.values()];
}

// Returns every maintained selection catalog used by the frontend.
function getCatalogs() {
    return { countries:buildCountries(),languages:LANGUAGES,ratingSystems:RATING_SYSTEMS, genres:GENRES,presentationForms:PRESENTATION_FORMS,watchSources:WATCH_SOURCES,subtypes:CONTENT_SUBTYPES,subtypeDescriptions:CONTENT_SUBTYPE_DESCRIPTIONS,episodeTypes:EPISODE_TYPES };
}

module.exports = { getCatalogs, normalizeCountryCodes,normalizeLanguageTags, normalizeContentRatings, normalizeWatchSources, normalizeSubtype,normalizePresentationForms,EPISODE_TYPES,LANGUAGES };
