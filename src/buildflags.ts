
interface BuildFlag {
    /// The type of the build flag.
    ///
    ///   'bool' if it can be switched like "-f" and "-fno-".
    ///   'tautology' if it can only be switched on.
    ///
    type: string,

    /// Small text to be used in "Enable <LABEL>" or "Disable <LABEL>" contexts.
    label: string,

    /// Explanation of the flag.
    explain: string,
}

// TODO put this outside the function?
export function buildFlagsTable() {
    return {
        "--cs": {
            type: "tautology",
            label: "Building of Custom Script (.cs)",
            explain: "",
        },
        "--cm": {
            type: "tautology",
            label: "Building of Custom Mission (.cm)",
            explain: "",
        },
        "-pedantic": {
            type: "tautology",
            label: "Strictness",
            explain: "",
        },
        "-O": {
            type: "tautology",
            label: "Optimization",
            explain: "",
        },
        "-fno-entity-tracking": {
            type: "bool",
            label: "Entity Tracking",
            explain: "",
        },
        "-fno-script-name-check": {
            type: "bool",
            label: "Script Name Check",
            explain: "",
        },
        "-fcleo": {
            type: "tautology",
            label: "CLEO Features",
            explain: "",
        },
    };
}

function getDefaultStates() 
{
    let table = buildFlagsTable();

    let defaultStates = {};

    for(let key in table) {
        if(table.hasOwnProperty(key)) {
            if(key.startsWith("-fno-") || key.startsWith("-mno-")) {
                defaultStates[key] = true; // flag not present means it's switched on
            } else {
                defaultStates[key] = false; // flag present means it's switched on
            }
        }
    }

    return defaultStates;
}

export function getFlagsStates(flags: string[]): {} {
    let table = buildFlagsTable();
    let defaultStates = getDefaultStates();

    let states = Object.assign({}, defaultStates);
    for(let flag of flags) {
        if(table[flag] != null) {
            states[flag] = !defaultStates[flag];
        }
    }

    return states;
}

export function getFlagnameByLabel(label: string): string | null
{
    let table = buildFlagsTable();

    label = /^(?:Enable\s+|Disable\s+)(.*)$/.exec(label)[1];

    for(let key in table) {
        if(table.hasOwnProperty(key)) {
            let item = table[key];
            if(item.label == label)
                return key;
        }
    }

    return null;
}

export function toggleFlag(flags: string[], flagname: string): string[]
{
    let flagindex = flags.indexOf(flagname);
    if(flagindex != -1) {
        let result = new Array<string>(...flags);
        result.splice(flagindex, 1);
        return result;
    } else {
        return flags.concat([flagname]);
    }
}
