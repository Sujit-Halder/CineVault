const { normalizeSingleLineText } = require('./text-normalization');

const CORPORATE_FORMS = [
    [/Co\.?(?=$)/g,' Company'],
    [/\bCo\.?(?=\s|,|$)/gi,'Company'],[/\bLtd\.?(?=\s|,|$)/gi,'Limited'],[/\bInc\.?(?=\s|,|$)/gi,'Incorporated'],
    [/\bCorp\.?(?=\s|,|$)/gi,'Corporation'],[/\bPvt\.?(?=\s|,|$)/gi,'Private'],[/\bIntl\.?(?=\s|,|$)/gi,'International'],
    [/\bLLC\.?(?=\s|,|$)/gi,'Limited Liability Company'],[/\bLLP\.?(?=\s|,|$)/gi,'Limited Liability Partnership'],
    [/\bPLC\.?(?=\s|,|$)/gi,'Public Limited Company'],[/\bL\.P\.?(?=\s|,|$)/gi,'Limited Partnership'],
];

// Expands common corporate abbreviations while preserving the remaining official name.
function fullCompanyName(value='') {
    let name=normalizeSingleLineText(value);
    CORPORATE_FORMS.forEach(([pattern,replacement]) => { name=name.replace(pattern,replacement); });
    return name.replace(/\s+([,.)])/g,'$1').replace(/([(])\s+/g,'$1').replace(/\s+/g,' ').trim();
}

// Produces a punctuation-insensitive key used only for matching aliases and review suggestions.
function companyKey(value='') {
    return fullCompanyName(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'');
}

module.exports={ fullCompanyName,companyKey };
