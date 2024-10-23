'use strict';
import { GTA3DocumentationProvider, docrequest, CommandDoc, GameDoc, ArgumentDoc } from './interface';
import { GTA3ScriptController, Command, Argument } from '../controller';

const GAME = {
    "gta3": "gta3",
    "gtavc": "vc",
    "gtasa": "sa",
};

const LIBRARIES = {
    "gta3": "https://raw.githubusercontent.com/sannybuilder/library/master/gta3/gta3.json",
    "gtavc": "https://raw.githubusercontent.com/sannybuilder/library/master/vc/vc.json",
    "gtasa": "https://raw.githubusercontent.com/sannybuilder/library/master/sa/sa.json",
};

const SUPPORT_INFO = "https://library.sannybuilder.com/assets/support-info.json";

const SOURCE_TYPES = {
    "var_any": "var",
    "var_global": "global var",
    "var_local": "local var",
    "literal": "literal",
    "pointer": "pointer"
};

const ATTRS = {
    "is_branch": "This command branches the code",
    "is_condition": "This command can be used in conditional statements",
    "is_constructor": "This command creates a new in-game entity",
    "is_destructor": "This command deletes the in-game entity",
    "is_nop": "This command is a no-operation",
    "is_unsupported": "This command is unsupported in the given game and its usage is forbidden",
    "is_overload": "This command has multiple variations for different types of arguments",
    "is_segment": "This command is used to separate segments in SCM header",
    "is_static": "This command operates on a static property or in-game entity that can not be constructed dynamically",
    "is_positional": "This command's offset in the script is used as the created entity's id"
};

enum SupportLevel {
    DoesNotExist = -2,
    Unsupported = -1,
    Nop = 0,
    Supported = 1,
    SupportedDiffParams = 2,
};

const DEFAULT_EXTENSION = "default";

export class SannyBuilderDocumentationProvider implements GTA3DocumentationProvider {

    private cache = new Map<string, Map<number, CommandDoc>>();

    public getProviderName(): string {
        return "Sanny Builder Library";
    }

    protected getArgumentType(arg: Argument): string {
        if (arg.enum != null) return arg.enum;
        if (arg.entity != null) return arg.entity;
        return arg.type;
    }

    protected parseArgument(param): ArgumentDoc {
        let name = param.name;
        let source = param.source;
        let description = new Array<string>();

        if (source) source = SOURCE_TYPES[source];
        if (source) description.push(source);
        if (name) description.push(name);

        return {
            type: param.type,
            description: description.join(' ')
        };
    }

    protected parseArguments(command, def: Command): [Array<ArgumentDoc>, Array<ArgumentDoc>, Array<ArgumentDoc>] {
        let input = command.input;
        let output = command.output;
        let parsedInput = new Array<ArgumentDoc>();
        let parsedOutput = new Array<ArgumentDoc>();

        if (input != null) input.forEach((param) => parsedInput.push(this.parseArgument(param)));
        if (output != null) output.forEach((param) => parsedOutput.push(this.parseArgument(param)));

        let parsed = parsedInput.concat(parsedOutput);
        return [parsed, parsedInput, parsedOutput];
    }

    protected parseSupportedGames(supportInfo): Array<GameDoc> {
        let games = new Array<GameDoc>();

        for (let gameId = GameDoc.Liberty; gameId <= GameDoc.SanAndreas; gameId++) {
            let [level, _] = supportInfo[gameId]

            if (level >= SupportLevel.Supported) games.push(gameId);
        }

        return games;
    }

    protected parseLongDescription(command,
                                   inputArgs: Array<ArgumentDoc>,
                                   outputArgs: Array<ArgumentDoc>, 
                                   extension: string, 
                                   baseUrl: string): string
    {
        let shortDescription = command.short_desc;
        let attrs = command.attrs;
        let fromDefaultExtension = extension === DEFAULT_EXTENSION;
        let longDescription = new Array<string>();

        if (shortDescription) longDescription.push(shortDescription + '\n');

        let addParamsSection = (title: string, args: Array<ArgumentDoc>) => {
            if (args.length > 0) {
                longDescription.push(`### ${title}\n`);

                for (let i = 0; i < args.length; i++) {
                    let arg = args[i];
                    let description = arg.description;

                    if (description) description = `${description}: `;
                    longDescription.push(`${i + 1}. ${description}${arg.type}`);
                }

                longDescription.push("");
            }
        }

        addParamsSection("Parameters", inputArgs);
        addParamsSection("Result", outputArgs);

        let notes = new Array<string>();

        if (!fromDefaultExtension)
            notes.push(`This command is available with the [${extension}](${baseUrl}/${extension}) extension.\n`);

        if (inputArgs.length > 0) {
            let firstArg = inputArgs[0];

            if (firstArg.description.includes('self'))
                notes.push(`self: ${firstArg.type} must [exist](${baseUrl}?q=constructor:${firstArg.type}) prior to using this command.\n`);
        }
        
        if (attrs != null) {
            for (let attr in attrs) {
                let note = ATTRS[attr];

                if (note != null) notes.push(`${note}.\n`);
            }
        }

        if (notes.length > 0) {
            longDescription.push("***\n");
            longDescription.push("### Notes\n");
            longDescription.push(...notes);
        }

        return longDescription.join('\n');
    }

    protected getCommands(context: GTA3ScriptController): Promise<Map<number, CommandDoc>> {
        let config = context.getConfigName();

        if (this.cache[config] == null) {
            return docrequest(LIBRARIES[config])
                .then((body) => JSON.parse(body))
                .then((commands) => {
                    return docrequest(SUPPORT_INFO)
                        .then((body) => JSON.parse(body))
                        .then((supportInfo) => {
                            let game = GAME[config];
                            let baseUrl = commands.meta.url;
                            let extensions = commands.extensions;
                            let cachedCommands = new Map<number, CommandDoc>();

                            supportInfo = supportInfo[game];
                            extensions.forEach((extension) => {
                                let extensionName = extension.name;
                                let extensionSupportInfo = supportInfo[extensionName];

                                extension.commands.forEach((command) => {
                                    let commandId = parseInt(command.id, 16);
                                    let commandDef = context.getCommandById(commandId);

                                    if (commandDef == null) return;

                                    let commandSupportInfo = extensionSupportInfo[command.id].slice(0, 3); //We only need info about GTA3, VC and SA
                                    let [args, inputArgs, outputArgs] = this.parseArguments(command, commandDef);

                                    let result = {
                                        uri: `${baseUrl}/script/extensions/${extensionName}/${command.id}`,
                                        games: this.parseSupportedGames(commandSupportInfo),
                                        shortDescription: command.short_desc,
                                        longDescription: this.parseLongDescription(command, inputArgs, outputArgs, extensionName, baseUrl),
                                        args: args,
                                        examples: []
                                    };

                                    cachedCommands.set(commandId, result);
                                });
                            });
                            this.cache[config] = cachedCommands;
                            return cachedCommands;
                        });
                });
        } else {
            return Promise.resolve(this.cache[config]);
        }
    }

    public provideDocumentation(context: GTA3ScriptController,
                                command: Command): Promise<CommandDoc>
    {
        if (command.id == null) {
            return Promise.resolve(null);
        }

        return this.getCommands(context)
            .then((commands) => Promise.resolve(commands.get(command.id)));
    }
}
