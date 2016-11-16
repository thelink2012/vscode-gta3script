'use strict';
import * as vscode from 'vscode';
import {GTA3ScriptController, Command, Argument} from '../controller';

export class GTA3SignatureHelpProvider implements vscode.SignatureHelpProvider {

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
        let fullSignatureString = command.name + ' ' + descriptions.join(', ');

        return this.gta3ctx.queryDocumentation(command).then((doc) => {

            let signature = new vscode.SignatureInformation(fullSignatureString, doc.shortDescription);
            signature.parameters = descriptions.map((desc, i) => {
                if(i < doc.args.length)
                    return new vscode.ParameterInformation(desc, doc.args[i].description);
                return new vscode.ParameterInformation(desc);
            });

            return this.makeSignatureHelp(signature, currentArg - 1);

        }).catch((e) => {   // fallback
            let signature = new vscode.SignatureInformation(fullSignatureString);
            signature.parameters = descriptions.map(desc => new vscode.ParameterInformation(desc));
            return Promise.resolve(this.makeSignatureHelp(signature, currentArg - 1));
        });
    }

    private makeSignatureHelp(signature: vscode.SignatureInformation, activeParameter: number): vscode.SignatureHelp {
        let result = new vscode.SignatureHelp();
        result.signatures = [signature];
        result.activeSignature = 0;
        result.activeParameter = activeParameter;
        return result;
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
