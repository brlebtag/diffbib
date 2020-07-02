const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const bibParse = require('bibtex-parse');
const util = require('util');
const crypto = require('crypto');
const leven = require('leven');

const readFile = util.promisify(fs.readFile);

const SIMILARITY_RATE = 0.3;

const Strategies = {
    'hash': hashStrategy,
    'bruteforce': bruteforceStrategy,
};

program.version('0.0.1');

function normalizePath(pathname) {
    if (pathname.indexOf('/') === -1) {
        pathname = path.join(process.cwd(), pathname);
    }

    return path.normalize(pathname);
}

async function readBib(filename) {
    return await readFile(filename, 'utf8');
}

async function LoadBib(filename) {
    const file = await readBib(normalizePath(filename));
    return bibParse.entries(file);
}

function normalizeFields(fields) {
    return fields.map(field =>
        field == 'key'
            ? field
            : field.toUpperCase()
    );
}

function formatOptions(options) {
    return options.map(option => `"${option}"`).join(', ');
}

function getOptions() {
    return formatOptions(Object.keys(Strategies));
}

function hash(str) {
    return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function getKey(el, fields) {
    return hash(
            fields
            .map(field => el[field] || '')
            .join('###')
        );
}

function buildLookupTable(list, fields) {
    const table = {};

    for(el of list) {
        const key = getKey(el, fields);
        table[key] = el;
    }

    return table;
}

function hashStrategy(fields, origBib, destBib) {
    const listA = buildLookupTable(origBib, fields); 
    const listB = buildLookupTable(destBib, fields);
    const status = {
        AB: [],
        OnlyA: [],
        OnlyB: [],
    };

    for(let key in listA) {
        if (listB[key] !== undefined ) {
            status['AB'].push(listA[key]);
        } else {
            status['OnlyA'].push(listA[key]);
        }
    }

    for(let key in listB) {
        if (listA[key] === undefined) {
            status['OnlyB'].push(listB[key]);
        }
    }

    return status;
}

function findSmallestSimilar(element, fields, list) {
    let smallest = undefined;
    let computedLeven = {};
    
    for (let el of list) {
        for (field of fields) {
            let newLeven = leven(element[field], el[field]);
            let max = Math.max(element[field].length || 1, el[field].length || 1);
            let similarity = newLeven / max;

            if (similarity > SIMILARITY_RATE)
                break;

            if (smallest === undefined)
            {
                smallest = el;
                computedLeven = {[field]: newLeven};
                break;
            }

            let currLeven =
                computedLeven[field] || leven(element[field], smallest[field]);

            if (newLeven > currLeven)
                break;
            
            if (currLeven > newLeven) {
                smallest = el;
                computedLeven = {[field]: newLeven};
                break;
            } 
        }
    }


    return smallest;
}

function bruteforceStrategy(fields, origBib, destBib) {
    const status = {
        AB: [],
        OnlyA: [],
        OnlyB: [],
    };

    for(let el of origBib) {
        const similar = findSmallestSimilar(el, fields, destBib);

        if (similar !== undefined) {
            status['AB'].push(el);
        } else {
            status['OnlyA'].push(el);
        }
    }

    for(let el of destBib) {
        const similar = findSmallestSimilar(el, fields, origBib);

        if (similar === undefined) {
            status['OnlyB'].push(el);
        }
    }

    return status;
}

function keys(arr) {
    return arr.map(el => el.key || '').join(', ');
}

function line() {
    console.log('-------------------------------');
}

function printStatus(status, originBib, destinyBib) {
    console.log(`Origin entries: ${originBib.length}, Destiny entries: ${destinyBib.length}`);

    line();

    console.log(`Common keys: ${status.AB.length}`);

    if (status.AB.length > 0) {
        console.log(`Keys: ${keys(status.AB)}`);
    }

    line();

    console.log(`Only in the origin file: ${status.OnlyA.length}`);

    if (status.OnlyA.length > 0) {
        console.log(`Keys: ${keys(status.OnlyA)}`);
    }

    line();

    console.log(`Only in the destiny file: ${status.OnlyB.length}`);

    if (status.OnlyB.length > 0) {
        console.log(`Keys: ${keys(status.OnlyB)}`);
    }
}

async function main() {
    program
        .name("diffbib")
        .option('-o, --origin <origin>', 'origin .bib file')
        .option('-d, --destiny <destiny>', 'destiny .bib file')
        .option('-f, --field <field>', 'comma separeted list of fields to compare in diff check.', 'key,title')
        .option('-s, --strategy <strategy>', `diff strategy, options: [${getOptions()}].`, 'hash')
        .parse(process.argv)
        ;

    if (Strategies[program.strategy] === undefined) {
        console.log('Unknown strategy! Options are hash or bruteforce.');
        process.exit(-1);
    }

    const strategy = Strategies[program.strategy];

    const fields = normalizeFields(program.field.split(','));

    if (program.origin && program.destiny) {
        
        let originBib, destinyBib;

        try {
            originBib = await LoadBib(program.origin);
        } catch(e) {
            console.log('origin file is not a valid bibtex file');
        }

        try {
            destinyBib = await LoadBib(program.destiny);
        } catch(e) {
            console.log('destiny file is not a valid bibtex file');
        }

        const status = strategy(fields, originBib, destinyBib);
        
        printStatus(status, originBib, destinyBib);

    } else {
        console.log('No origin and destiny file specified!');
    }
}


main();