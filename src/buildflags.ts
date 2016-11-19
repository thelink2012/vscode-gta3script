
interface BuildFlag {
    /// The type of the build flag.
    ///
    ///   'bool' if it can be switched like "-f" and "-fno-".
    ///   'tautology' if it can only be switched on.
    ///
    type: string,

    /// Small text to be used in "Enable <LABEL>" or "Disable <LABEL>" contexts.
    label: string,

    /// Explanation of the flag (currently unused).
    explain: string,
}

export const BUILD_FLAGS = {
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
        label: "CLEO Features (for main.scm)",
        explain: "",
    },
};

/// Gets the state of the flags when they aren't specified in the buildflags options.
function getDefaultStates()
{
    let defaultStates = {};

    for(let key in BUILD_FLAGS) {
        if(BUILD_FLAGS.hasOwnProperty(key)) {
            if(key.startsWith("-fno-") || key.startsWith("-mno-")) {
                defaultStates[key] = true; // flag not present means it's switched on
            } else {
                defaultStates[key] = false; // flag present means it's switched on
            }
        }
    }

    return defaultStates;
}

export function getFlagStates(flags: string[])
{
    let defaultStates = getDefaultStates();

    let states = Object.assign({}, defaultStates);
    for(let flagname of flags) {
        if(BUILD_FLAGS[flagname] != undefined) {
            states[flagname] = !defaultStates[flagname];
        }
    }

    return states;
}

export function getFlagNameByLabel(label: string): string | null
{
    label = /^(?:Enable\s+|Disable\s+)(.*)$/.exec(label)[1];

    for(let key in BUILD_FLAGS) {
        if(BUILD_FLAGS.hasOwnProperty(key)) {
            if(BUILD_FLAGS[key].label == label)
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

        // Few things that needs to be handled manually.
        if(flagname == "--cm" && flags.indexOf("--cs") != -1) {
            flags = toggleFlag(flags, "--cs");
        } else if(flagname == "--cs" && flags.indexOf("--cm") != -1) {
            flags = toggleFlag(flags, "--cm");
        }

        return flags.concat([flagname]);
    }
}
