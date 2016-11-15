'use strict';
import * as vscode from 'vscode';
import * as fs from 'fs';

// How do I use this with Typescript's import?
const xml2js = require('xml2js');

const GTA3_MODE: vscode.DocumentFilter = { language: 'gta3script', scheme: 'file' };

interface Argument {
    type: string;
    enum: string | null;
    entity: string | null;
    description: string | null;
    optional: boolean;
    out: boolean;
    ref: boolean;
}

interface Command {
    name: string;
    id: number | null;
    hash: number | null;
    args: Argument[];
}


interface CommandsDictionary {
    [command: string]: Command;
}

//type CommandsDictionary = any;

interface LineContent {
    not_flag: boolean,
    command: string,
    args: string[],
}

class GTA3ScriptController {

    private configToken : number;
    private config : string | null;
    private commands: CommandsDictionary | null;

    constructor() {
        this.configToken = 0;
        this.config = null;
        this.commands = null;
    }

    // never negative
    public getConfigToken(): number {
        return this.configToken;
    }

    public getCommands(): CommandsDictionary {
        return this.commands || {};
    }

    public getCommand(name: string): Command | null {
        return this.commands[name] || null
    }

    public loadConfig(configname: string) {
        this.parseConfig("C:/Projects/source/gta3script/config/" + configname)
            .then((value) => {
                console.log(value["WAIT"]);
                this.config = configname;
                this.commands = value;
                ++this.configToken;
            }).catch((err) => {
                console.log("failed to load gta3sc config", err.message);
            });
    }

    private parseConfig(configpath: string): Promise<CommandsDictionary> {
        return new Promise((resolve, reject) => {
            fs.readFile(configpath + "/commands.xml", (err, data) => {
                if(err) return reject(err);
                xml2js.parseString(data, (err, result) => {
                    if(err) return reject(err);

                    let map: CommandsDictionary = {}
                    for(const command of result.GTA3Script.Commands[0].Command) {
                        let args = ((command.Args && command.Args[0].Arg && command.Args[0].Arg) || [])
                        map[command.$.Name] = {
                            name: command.$.Name,
                            id: (command.$.ID && Number(command.$.ID)) || null,
                            hash: (command.$.Hash && Number(command.$.Hash)) || null,
                            args: args.map((arg) => {
                                return {
                                    type: arg.$.Type,
                                    enum: arg.$.Enum || null,
                                    entity: arg.$.Entity || null,
                                    description: arg.$.Desc || null,
                                    optional: arg.$.Optional == "true",
                                    out: arg.$.Out == "true",
                                    ref: arg.$.Ref == "true",
                                };
                            }),
                        };
                    }

                    resolve(map);
                });
            })
        });
    }
}

class GTA3CompletionItemProvider implements vscode.CompletionItemProvider {

    private configToken: number = -1;
    private cachedItems: vscode.CompletionItem[];

    public constructor(private gta3ctx: GTA3ScriptController) {
    }

    public provideCompletionItems(document: vscode.TextDocument,
                                  position: vscode.Position,
                                  token: vscode.CancellationToken): Thenable<vscode.CompletionItem[]>
    {
        let currentLine = document.lineAt(position.line).text;
        let lineTillCurrentPosition = currentLine.substr(0, position.character);

        if(!lineTillCurrentPosition.match(/^\s*(?:\w+:)?\s*(?:(?:IF\s+)|(?:WHILE\s+))?(?:(?:AND\s+)|(?:OR\s+))?(?:NOT\s+)?([_\w]+)$/))
            return Promise.resolve(null);
        
        return this.cachedCompletions();
    }

    private cachedCompletions(): Promise<vscode.CompletionItem[]> {
        if(this.gta3ctx.getConfigToken() != this.configToken) {
            console.log("Caching completion list...");
            this.configToken = this.gta3ctx.getConfigToken();
            this.cachedItems = [];
            let commands = this.gta3ctx.getCommands();
            for(const key in commands) {
                if(commands.hasOwnProperty(key)) {
                    let command = commands[key];
                    this.cachedItems.push(new vscode.CompletionItem(command.name, vscode.CompletionItemKind.Function));
                }
            }
        }
        return Promise.resolve(this.cachedItems);
    }
}

class GTA3SignatureHelpProvider implements GTA3SignatureHelpProvider {

    public constructor(private gta3ctx: GTA3ScriptController) {
    }

    public provideSignatureHelp(document: vscode.TextDocument,
                                position: vscode.Position,
                                token: vscode.CancellationToken): Thenable<vscode.SignatureHelp>
    {
        let currentLine = document.lineAt(position.line).text.substring(0, position.character);
        let tokens = this.splitTokens(currentLine);
        if(tokens == null || tokens.length == 0) {
            return Promise.resolve(null);
        }

        let itok_cmd = this.findCommandName(tokens);
        if(itok_cmd == null) {
            return Promise.resolve(null);
        }

        let command = this.gta3ctx.getCommand(tokens[itok_cmd]);
        if(command == null) {
            return Promise.resolve(null);
        }

        let currentArg = (tokens.length - 1) - itok_cmd;
        if(currentLine.length >= 2 && currentLine[currentLine.length-1] == ' ')
            ++currentArg;

        if(currentArg == 0) {
            return Promise.resolve(null);
        }
        
        let descriptions = this.makeArgumentDescriptions(command.args)

        let signature = new vscode.SignatureInformation(command.name + ' ' + descriptions.join(', '), "Doc string");
        signature.parameters = descriptions.map(desc => new vscode.ParameterInformation(desc));

        let result = new vscode.SignatureHelp();
        result.signatures = [signature];
        result.activeSignature = 0;
        result.activeParameter = currentArg - 1;
        return Promise.resolve(result);
    }

    private getArgumentDescription(arg: Argument): string {
        if(arg.enum != null) return arg.enum;
        if(arg.entity != null) return arg.entity;
        if(arg.description != null) return arg.description;
        return arg.type;
    }

    private makeArgumentDescriptions(args: Argument[]): string[] {
        let desc = new Array<string>();
        for(let i = 0; i < args.length; ++i) {
            let argspec = '\u200B'.repeat(i)
            desc.push(argspec + this.getArgumentDescription(args[i]) + argspec);
        }
        return desc
    }

    private findCommandName(tokens: string[]): number | null {
        let i = 0

        // TODO label
        // TODO expr

        if(tokens.length <= i)
            return null;
        if(tokens[i] == "REPEAT" || tokens[i] == "SWITCH")
            return null;
        else if(tokens[i] == "WHILE")
            ++i;
        else if(tokens[i] == "IF")
            ++i;

        if(tokens.length <= i)
            return null;
        if(tokens[i] == "AND" || tokens[i] == "OR")
            ++i;

        if(tokens.length <= i)
            return null;
        if(tokens[i] == "NOT")
            ++i;

        if(tokens.length <= i)
            return null;
        return i;
    }

    private splitTokens(line: string): string[] {
        return line.match(/\w+|"(?:\\"|[^"])+"/g);
    }
}

/*
class GTA3HoverProvider implements vscode.HoverProvider {
    public provideHover(
        document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken):
        Thenable<vscode.Hover> {
            return new Promise((resolve, reject) => {
                resolve(new vscode.Hover(""));
            });
    }
}
*/


export function activate(context: vscode.ExtensionContext) {

    // TODO hover
    // TODO completion
    // TODO help with signature

    let gta3ctx = new GTA3ScriptController();
    gta3ctx.loadConfig("gtasa");

    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(GTA3_MODE, new GTA3CompletionItemProvider(gta3ctx), '.'));
    context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(GTA3_MODE, new GTA3SignatureHelpProvider(gta3ctx), '(', ',', ' '));
    //context.subscriptions.push(vscode.languages.registerHoverProvider(GTA3_MODE, new GTA3HoverProvider()));
}

export function deactivate() {
}

