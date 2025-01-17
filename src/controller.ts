'use strict';
import {GTA3DocumentationProvider, GameDoc, CommandDoc} from './documentation/interface'
import {GTA3DocumentationController} from './documentation/controller'
import {queryConfigPath, queryModels} from './compiler';
import * as vscode from 'vscode';
import * as fs from 'fs';
const xml2js = require('xml2js');
const readline = require('readline');

export interface Argument {
    type: string;
    enum: string | null;
    entity: string | null;
    hint: string | null;
    optional: boolean;
    out: boolean;
    ref: boolean;
}

export interface Command {
    name: string;
    id: number | null;
    hash: number | null;
    args: Argument[];
    internal: boolean;
}

export interface CommandsDictionary {
    [command: string]: Command;
}

export interface AlternatorsDictionary {
    [alternator: string]: Set<string>;
}

export interface EnumerationDictionary {
    [enumName: string]: Array<[string, number]>;
}

export interface ConfigData {
    commands: CommandsDictionary,
    alternators: AlternatorsDictionary,
    enums: EnumerationDictionary,
}

export interface ModelsData {
    default: Array<[string, number]>,
    level: Array<[string, number]>,
}

export class GTA3ScriptController {

    private configToken : number;
    private config : string | null;
    private commands: CommandsDictionary | null;
    private commandsById: {};
    private alternators: {};
    private enums: {};
    private models: ModelsData;

    constructor(private docs: GTA3DocumentationController) {
        this.configToken = 0;
        this.config = null;
        this.commands = {};
        this.commandsById = [];
        this.alternators = {};
        this.enums = {};
        this.models = { default: [], level: [] };
    }

    /// Gets the current configuration name.
    public getConfigName(): string | null {
        return this.config;
    }

    /// Whenever the loaded configuration changes, this token changes as well.
    /// This token is never a negative number.
    public getConfigToken(): number {
        return this.configToken;
    }

    /// Gets information regarding the specified command.
    public getCommand(name: string): Command | null {
        return this.commands[name] || null
    }

    /// Gets the dictionary of currently loaded commands.
    public getCommands(): CommandsDictionary {
        return this.commands;
    }

    /// Gets a command by its opcode id.
    public getCommandById(id: number): Command | null {
        return this.commandsById[id];
    }

    /// Gets a specific constant list.
    public getEnumeration(name: string) : Array<[string, number]> {
        if(name == "DEFAULTMODEL") {
            return this.models.default;
        } else if(name == "MODEL") {
            // TODO FIXME this doesn't look very efficient.
            return this.models.default.concat(this.models.level);
        } else {
            return this.enums[name];
        }
    }

    /// Gets documentation for the specified command.
    public queryDocumentation(command: Command): Promise<CommandDoc> {
        return this.docs.queryDocumentation(this, command);
    }

    /// Gets **cached** documentation for the specified command.
    public queryCachedDocumentation(command: Command): CommandDoc | null {
        return this.docs.queryCachedDocumentation(command) || null;
    }

    /// Gets an string specifying the supported games.
    /// For Markdown, uses icons.
    public getGameSpec(games: GameDoc[], markdown: boolean): string {
        if(markdown)
            return this.docs.getMarkdownGameSpec(games);
        else
            return this.docs.getPlainTextGameSpec(games);
    }

    /// Loads the specified configuration name.
    public loadConfig(cfgname: string): Thenable<any> {
        let wsconfig = vscode.workspace.getConfiguration("gta3script");
        return queryConfigPath(wsconfig).then(configpath => {
            return this.loadConfigPath(`${configpath}/${cfgname}`).then(config => {
                return queryModels(wsconfig, cfgname).catch(e => {
                    // ignore failure of model querying
                    return Promise.resolve({ default: [], level: [] });
                }).then(models => {
                    this.config = cfgname;
                    this.commands = config.commands;
                    this.alternators = config.alternators;
                    this.enums = config.enums;
                    this.models = models;
                    this.computeByIdTable();
                    ++this.configToken;
                    console.log(`Loaded configuration ${cfgname}`);
                });
            })
        }).catch(err => {
            console.log(`Failed to load config at ${cfgname}; Reason: ${err}`);
        });
    }

    private async loadAdditionalConfigs(configpath: string): Promise<Array<string>> {
        const rl = readline.createInterface({
            input: fs.createReadStream(`${configpath}/commandline.txt`),
            crlfDelay: Infinity
        });
        const addConfigs = new Array<string>();

        try {
            for await (const line of rl) {
                const arg = line.split("=");
    
                if (arg.length == 2 && arg[0].trim() === "--add-config") {
                    addConfigs.push(arg[1].trim());
                }
            }
        } catch (err) {
            return Promise.resolve([]);
        }

        return addConfigs;
    }

    private loadConfigPath(configpath: string): Promise<ConfigData> {
        let promiseList = [];
        
        let tryParsingConfigFile = (configname): Promise<ConfigData> => {
            // this promise must always be fulfilled!
            return new Promise((resolve, reject) => {
                return this.parseConfigFile(`${configpath}/${configname}`).catch(e => {
                    console.log(`Failed to load config file ${configname}`, e);
                    return Promise.resolve({ // ConfigData
                        commands: {},
                        alternators: {},
                        enums: {}
                    });
                }).then(cfg => resolve(cfg));
            });
        };

        promiseList.push(tryParsingConfigFile("../gta3sc.xml"));
        promiseList.push(tryParsingConfigFile("alternators.xml"));
        promiseList.push(tryParsingConfigFile("commands.xml"));
        promiseList.push(tryParsingConfigFile("constants.xml"));
        promiseList.push(tryParsingConfigFile("cleo.xml"));

        return this.loadAdditionalConfigs(configpath).then(addConfigs => {
            promiseList.push(...addConfigs.map(configFile => tryParsingConfigFile(configFile)));
            return Promise.all(promiseList).then(cfgList => {
                let allCommands = cfgList.map(c => c.commands);
                let allAlternators = cfgList.map(c => c.alternators);
                let allEnums = cfgList.map(c => c.enums);
    
                return {  // ConfigData
                    commands: Object.assign({}, ...allCommands),
                    alternators: Object.assign({}, ...allAlternators),
                    enums: Object.assign({}, ...allEnums),
                };
            });
        });
    }

    private parseConfigFile(configfile: string): Promise<ConfigData> {
        return new Promise((resolve, reject) =>{
            fs.readFile(configfile, (err, data) => {
                if(err) {
                    return reject(err);
                }
                xml2js.parseString(data, (err, result) => {
                    if(err) {
                        return reject(err);
                    }

                    if(!result || !result.GTA3Script) {
                        return reject("Missing GTA3Script node on config XML.")
                    }
                    
                    let commands: CommandsDictionary = {}
                    let enums: EnumerationDictionary = {};
                    let alternators: AlternatorsDictionary = {};

                    let CfgNode = result.GTA3Script;

                    if(CfgNode.Commands && CfgNode.Commands.length > 0) {
                        for(const command of (CfgNode.Commands[0].Command || [])) {
                            let id = null;
                            let hash = null;
                            let args = []

                            if(command.$.ID != null)
                                id = Number(command.$.ID);
                            if(command.$.Hash != null)
                                hash = Number(command.$.Hash);
                            if(command.Args && command.Args[0].Arg && command.Args[0].Arg)
                                args = command.Args[0].Arg;

                            args = args.map((arg) => { return {
                                type: arg.$.Type,
                                enum: arg.$.Enum || null,
                                entity: arg.$.Entity || null,
                                hint: arg.$.Desc || null,
                                optional: arg.$.Optional == "true",
                                out: arg.$.Out == "true",
                                ref: arg.$.Ref == "true",
                            }});

                            commands[command.$.Name] = {
                                name: command.$.Name,
                                id: id,
                                hash: hash,
                                args: args,
                                internal: command.$.Internal == "true",
                            };
                        }
                    }

                    if(CfgNode.Alternators && CfgNode.Alternators.length > 0) {
                        for(const node of CfgNode.Alternators[0].Alternator) {
                            alternators[node.$.Name] = new Set<string>();
                            let set = alternators[node.$.Name];
                            for(const alternative of (node.Alternative || [])) {
                                set.add(alternative.$.Name);
                            }
                        }
                    }

                    if(CfgNode.Constants && CfgNode.Constants.length > 0) {
                        for(const node of CfgNode.Constants[0].Enum) {
                            enums[node.$.Name] = new Array<[string, number]>();
                            let enumArray = enums[node.$.Name];
                            let currentValue = 0;

                            for(const constant of (node.Constant || [])) {
                                if(constant.$.Value != null)
                                    currentValue = constant.$.Value;
                                enumArray.push([constant.$.Name, currentValue++])
                            }
                        }
                    }

                    resolve({
                        commands: commands,
                        alternators: alternators,
                        enums: enums,
                    });
                });
            })
        });
    }

    private computeByIdTable() {
        this.commandsById = {}
        for(let name in this.commands) {
            if(this.commands.hasOwnProperty(name)) {
                let command = this.commands[name];
                if(command.id != null) {
                    this.commandsById[command.id] = command;
                }
            }
        }
    }
}
