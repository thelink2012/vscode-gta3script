'use strict';
import {GTA3DocumentationProvider, GameDoc, CommandDoc} from './documentation/interface'
import {GTA3DocumentationController} from './documentation/controller'
import * as vscode from 'vscode';
import * as fs from 'fs';
const xml2js = require('xml2js');

export interface Argument {
    type: string;
    enum: string | null;
    entity: string | null;
    description: string | null;
    optional: boolean;
    out: boolean;
    ref: boolean;
}

export interface Command {
    name: string;
    id: number | null;
    hash: number | null;
    args: Argument[];
}

export interface CommandsDictionary {
    [command: string]: Command;
}

export class GTA3ScriptController {

    private configToken : number;
    private config : string | null;
    private commands: CommandsDictionary | null;
    private docs: GTA3DocumentationController;

    constructor(docs: GTA3DocumentationController) {
        this.configToken = 0;
        this.config = null;
        this.commands = null;
        this.docs = docs
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
        return this.commands || {};
    }

    /// Gets documentation for the specified command.
    public queryDocumentation(command: Command): Promise<CommandDoc> {
        return this.docs.queryDocumentation(this, command);
    }

    /// Gets **cached** documentation for the specified command.
    public queryCachedDocumentation(command: Command): CommandDoc | null {
        return this.docs.queryCachedDocumentation(command) || null;
    }

    public getGameSpec(games: GameDoc[], markdown: boolean): string {
        if(markdown)
            return this.docs.getMarkdownGameSpec(games);
        else
            return this.docs.getPlainTextGameSpec(games);
    }

    /// Loads the specified configuration name.
    public loadConfig(configname: string): Thenable<any> {
        return this.parseConfigPath("C:/Projects/source/gta3script/config/" + configname)
            .then((value) => {
                this.config = configname;
                this.commands = value;
                ++this.configToken;
            }).catch((err) => {
                console.log("failed to load gta3sc config", err.message);
            });
    }

    private parseConfigPath(configpath: string): Promise<CommandsDictionary> {
        return this.parseConfigFile(configpath + "/commands.xml");
    }

    private parseConfigFile(configfile: string): Promise<CommandsDictionary> {
        return new Promise((resolve, reject) =>{
            fs.readFile(configfile, (err, data) => {
                if(err) {
                    return reject(err);
                }
                xml2js.parseString(data, (err, result) => {
                    if(err) {
                        return reject(err);
                    }
                    let map: CommandsDictionary = {}
                    for(const command of result.GTA3Script.Commands[0].Command) {
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
                            description: arg.$.Desc || null,
                            optional: arg.$.Optional == "true",
                            out: arg.$.Out == "true",
                            ref: arg.$.Ref == "true",
                        }});

                        map[command.$.Name] = {
                            name: command.$.Name,
                            id: id,
                            hash: hash,
                            args: args,
                        };
                    }

                    resolve(map);
                });
            })
        });
    }
}
