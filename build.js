var fs = require('fs'),
    path = require('path'),
    glob = require('glob'),
    YAML = require('js-yaml'),
    _ = require('lodash'),
    jsonschema = require('jsonschema'),
    fieldSchema = require('./data/presets/schema/field.json'),
    presetSchema = require('./data/presets/schema/preset.json'),
    suggestions = require('name-suggestion-index/name-suggestions.json');

function readtxt(f) {
    return fs.readFileSync(f, 'utf8');
}

function read(f) {
    return JSON.parse(readtxt(f));
}

function r(f) {
    return read(__dirname + '/data/' + f);
}

function validate(file, instance, schema) {
    var validationErrors = jsonschema.validate(instance, schema).errors;
    if (validationErrors.length) {
        console.error(file + ": ");
        validationErrors.forEach(function(error) {
            if (error.property) {
                console.error(error.property + ' ' + error.message);
            } else {
                console.error(error);
            }
        });
        process.exit(1);
    }
}

var translations = {
    categories: {},
    fields: {},
    presets: {}
};

function generateCategories() {
    var categories = {};
    glob.sync(__dirname + '/data/presets/categories/*.json').forEach(function(file) {
        var field = read(file),
            id = 'category-' + path.basename(file, '.json');

        translations.categories[id] = {name: field.name};

        categories[id] = field;
    });
    return categories;
}

function generateFields() {
    var fields = {};
    glob.sync(__dirname + '/data/presets/fields/**/*.json').forEach(function(file) {
        var field = read(file),
            id = stripLeadingUnderscores(file.match(/presets\/fields\/([^.]*)\.json/)[1]);

        validate(file, field, fieldSchema);

        var t = translations.fields[id] = {
            label: field.label
        };

        if (field.placeholder) {
            t.placeholder = field.placeholder;
        }

        if (field.strings) {
            for (var i in field.strings) {
                t[i] = field.strings[i];
            }
        }

        fields[id] = field;
    });
    return fields;
}

function suggestionsToPresets(presets) {
    var existing = {};

    for (var key in suggestions) {
        for (var value in suggestions[key]) {
            for (var name in suggestions[key][value]) {
                var item = key + '/' + value + '/' + name,
                    tags = {},
                    count = suggestions[key][value][name].count;

                if (existing[name] && count > existing[name].count) {
                    delete presets[existing[name].category];
                    delete existing[name];
                }
                if (!existing[name]) {
                    tags = _.extend({name: name.replace(/"/g, '')}, suggestions[key][value][name].tags);
                    addSuggestion(item, tags, name.replace(/"/g, ''), count);
                }
            }
        }
    }

    function addSuggestion(category, tags, name, count) {
        var tag = category.split('/'),
            parent = presets[tag[0] + '/' + tag[1]];

        if (!parent) {
            console.log('WARN: no preset for suggestion = ' + tag);
            return;
        }

        presets[category.replace(/"/g, '')] = {
            tags: parent.tags ? _.merge(tags, parent.tags) : tags,
            name: name,
            icon: parent.icon,
            geometry: parent.geometry,
            fields: parent.fields,
            suggestion: true
        };

        existing[name] = {
            category: category,
            count: count
        };
    }

    return presets;
}

function stripLeadingUnderscores(str) {
    return str.split('/').map(function(s) {return s.replace(/^_/,''); }).join('/');
}

function generatePresets() {
    var presets = {};

    glob.sync(__dirname + '/data/presets/presets/**/*.json').forEach(function(file) {
        var preset = read(file),
            id = stripLeadingUnderscores(file.match(/presets\/presets\/([^.]*)\.json/)[1]);

        validate(file, preset, presetSchema);

        translations.presets[id] = {
            name: preset.name,
            terms: (preset.terms || []).join(',')
        };
        presets[id] = preset;
    });

    presets = _.merge(presets, suggestionsToPresets(presets));
    return presets;

}

function generateTranslate(fields, presets) {
    var translate = _.cloneDeep(translations);

    _.forEach(translate.fields, function(field, id) {
        var f = fields[id];
        if (f.keys) {
            field['label#'] = _.each(f.keys).map(function(key) { return key + '=*'; }).join(', ');
            if (!_.isEmpty(field.options)) {
                _.each(field.options, function(v,k) {
                    if (id === 'access') {
                        field.options[k]['title#'] = field.options[k]['description#'] = 'access=' + k;
                    } else {
                        field.options[k + '#'] = k + '=yes';
                    }
                });
            }
        } else if (f.key) {
            field['label#'] = f.key + '=*';
            if (!_.isEmpty(field.options)) {
                _.each(field.options, function(v,k) {
                    field.options[k + '#'] = f.key + '=' + k;
                });
            }
        }

        if (f.placeholder) {
            field['placeholder#'] = id + ' field placeholder';
        }
    });

    _.forEach(translate.presets, function(preset, id) {
        var p = presets[id];
        if (!_.isEmpty(p.tags))
            preset['name#'] = _.toPairs(p.tags).map(function(pair) { return pair[0] + '=' + pair[1]; }).join(', ');
        if (p.terms && p.terms.length)
            preset['terms#'] = 'terms: ' + p.terms.join();
        preset.terms = "<translate with synonyms or related terms for '" + preset.name + "', separated by commas>";
    });

    return translate;
}

function validateCategoryPresets(categories, presets) {
    _.forEach(categories, function(category) {
        if (category.members) {
            category.members.forEach(function(preset) {
                if (presets[preset] === undefined) {
                    console.error('Unknown preset: ' + preset + ' in category ' + category.name);
                    process.exit(1);
                }
            });
        }
    });
}

function validatePresetFields(presets, fields) {
    _.forEach(presets, function(preset) {
        if (preset.fields) {
            preset.fields.forEach(function(field) {
                if (fields[field] === undefined) {
                    console.error('Unknown preset field: ' + field + ' in preset ' + preset.name);
                    process.exit(1);
                }
            });
        }
    });
}

// comment keys end with '#' and should sort immediately before their related key.
function sortKeys(a, b) {
    return (a === b + '#') ? -1
        : (b === a + '#') ? 1
        : (a > b ? 1 : a < b ? -1 : 0);
}

var categories = generateCategories(),
    fields = generateFields(),
    presets = generatePresets(),
    translate = generateTranslate(fields, presets);

// additional consistency checks
validateCategoryPresets(categories, presets);
validatePresetFields(presets, fields);

// Save individual data files
fs.writeFileSync('data/presets/categories.json', JSON.stringify(categories, null, 4));
fs.writeFileSync('data/presets/fields.json', JSON.stringify(fields, null, 4));
fs.writeFileSync('data/presets/presets.json', JSON.stringify(presets, null, 4));
fs.writeFileSync('data/presets.yaml',
    YAML.safeDump({en: {presets: translate}}, {sortKeys: sortKeys, lineWidth: -1})
        .replace(/\'.*#\':/g, '#')
);

// Write taginfo data
var taginfo = {
    "data_format": 1,
    "data_url": "https://raw.githubusercontent.com/openstreetmap/iD/master/data/taginfo.json",
    "project": {
        "name": "iD Editor",
        "description": "Online editor for OSM data.",
        "project_url": "https://github.com/openstreetmap/iD",
        "doc_url": "https://github.com/openstreetmap/iD/blob/master/data/presets/README.md",
        "icon_url": "https://raw.githubusercontent.com/openstreetmap/iD/master/dist/img/logo.png",
        "keywords": [
            "editor"
        ]
    },
    "tags": []
};

_.forEach(presets, function(preset) {
    if (preset.suggestion)
        return;

    var keys = Object.keys(preset.tags),
        last = keys[keys.length - 1],
        tag = {key: last};

    if (!last)
        return;

    if (preset.tags[last] !== '*') {
        tag.value = preset.tags[last];
    }

    taginfo.tags.push(tag);
});

fs.writeFileSync('data/taginfo.json', JSON.stringify(taginfo, null, 4));

// Push changes from data/core.yaml into en.json
var core = YAML.load(fs.readFileSync('data/core.yaml', 'utf8'));
var presets = {en: {presets: translations}};
var en = _.merge(core, presets);
fs.writeFileSync('dist/locales/en.json', JSON.stringify(en.en, null, 4));

