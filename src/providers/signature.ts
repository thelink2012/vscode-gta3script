'use strict';
import * as vscode from 'vscode';
import {GTA3ScriptController, Command, Argument} from '../controller';

interface BasicSignatureHelp {
    /// The command being signaled.
    command: Command,

    /// The active argument or null if none.
    /// Also see notes in `activeArgumentId`.
    activeArgument: Argument | null,

    /// The active argument id.
    ///
    /// Do note this mayn't reflect the number of arguments in command.args,
    /// in such case `activeArgument` is a reference to the last argument in `command.args`.
    activeArgumentId: number, // 0... | -1
};

type TokenList = Array<[number, number]>;

export class GTA3SignatureHelpProvider implements vscode.SignatureHelpProvider {

    public constructor(private gta3ctx: GTA3ScriptController) {
    }

    public provideSignatureHelp(document: vscode.TextDocument,
                                position: vscode.Position,
                                token: vscode.CancellationToken): Thenable<vscode.SignatureHelp>
    {
        let basicSignature = this.provideBasicSignatureHelp(document, position);
        if(basicSignature == null || basicSignature.activeArgument == null) {
            return Promise.resolve(null);
        }

        let command = basicSignature.command;
        let [fullSignatureString, types] = this.getSignatureForCommand(command);

        return this.gta3ctx.queryDocumentation(command).then((doc) => {

            let signature = new vscode.SignatureInformation(fullSignatureString, doc.shortDescription);
            signature.parameters = types.map((type, i) => {
                if(i < doc.args.length)
                    return new vscode.ParameterInformation(type, doc.args[i].description);
                return new vscode.ParameterInformation(type);
            });

            return this.makeSignatureHelp(signature, basicSignature.activeArgumentId);

        }).catch((e) => {   // fallback
            let signature = new vscode.SignatureInformation(fullSignatureString);
            signature.parameters = types.map(desc => new vscode.ParameterInformation(desc));
            return Promise.resolve(this.makeSignatureHelp(signature, basicSignature.activeArgumentId));
        });
    }

    public provideBasicSignatureHelp(document: vscode.TextDocument,
                                     position: vscode.Position): BasicSignatureHelp | null
    {
        let currentLine = document.lineAt(position.line).text.substring(0, position.character);
        let tokens = this.findTokens(currentLine);

        let cmdTokenIndex = this.findCommandName(currentLine, tokens);
        if(cmdTokenIndex == null) {
            return null;
        }

        let cmdToken = tokens[cmdTokenIndex];

        let command = this.gta3ctx.getCommand(currentLine.slice(cmdToken[0], cmdToken[1]));
        if(command == null || command.internal) {
            return null;
        }

        // Perform a, more or less, lower-bound search on the tokens list.
        let currentToken : number;
        for(currentToken = 0; currentToken < tokens.length; ++currentToken) {
            let [tokenBegin, tokenEnd] = tokens[currentToken];
            if(position.character >= tokenBegin) {
                if(position.character <= tokenEnd)
                    break;
            } else {
                // the cursor is before this token and any other token following it.
                --currentToken;
                break;
            }
        }

        // Clamp the value of currentToken within [0, tokens.length] (inclusive).
        currentToken = Math.min(currentToken, tokens.length);
        currentToken = Math.max(0, currentToken);

        // The cursor is way before the command token.
        if(currentToken < cmdTokenIndex) {
            return null;
        }

        let activeArgumentId = (currentToken - cmdTokenIndex) - 1; // will become -1 if typing command
        let activeArgument = null;

        if(command.args.length == 0 || activeArgumentId < 0) {
            activeArgument = null;
        } else if(activeArgumentId < command.args.length) {
            activeArgument = command.args[activeArgumentId];
        } else {
            activeArgument = command.args[command.args.length - 1];
        }

        return {
            command: command,
            activeArgument: activeArgument,
            activeArgumentId: activeArgumentId,
        };
    }
    
    /// Gets the complete signature and argument types for a command.
    public getSignatureForCommand(command: Command): [string, Array<string>] {
        let types = this.makeArgumentTypes(command.args)
        let signt =  command.name + ' ' + types.join(', ');
        return [signt, types];
    }

    /// Gets the complete signature for a command.
    public getCompleteSignatureForCommand(command: Command): string {
        return this.getSignatureForCommand(command)[0];
    }



    private makeSignatureHelp(signature: vscode.SignatureInformation, activeParameter: number): vscode.SignatureHelp {
        let result = new vscode.SignatureHelp();
        result.signatures = [signature];
        result.activeSignature = 0;
        result.activeParameter = activeParameter;
        return result;
    }

    private getArgumentType(arg: Argument): string {
        if(arg.enum != null) return arg.enum;
        if(arg.entity != null) return arg.entity;
        if(arg.hint != null) return arg.hint; // previously known as "Desc"
        return arg.type;
    }

    private makeArgumentTypes(args: Argument[]): string[] {
        let desc = new Array<string>();
        for(let i = 0; i < args.length; ++i) {
            // VSCode expects each argument name to be unique, and we are giving only type names,
            // which may conflict with each other. As a solution, we're using the invisible character
            // U+200B * i at the bounds of the arguments. Dirty but clever.
            let argspec = '\u200B'.repeat(i)
            desc.push(argspec + this.getArgumentType(args[i]) + argspec);
        }
        return desc
    }

    private findTokens(line: string): TokenList {
        let tokens = new Array<[number, number]>();
        let nextTokenPos = 0;
        let insideQuotes = false;
        for(let i = 0; i < line.length; ++i) {
            switch(line[i]) {
                case ' ':
                case '\t':
                case ',':
                case '(':
                case ')':
                    if(!insideQuotes) {
                        if(i > nextTokenPos) { // whitespaces followed by whitespaces
                            tokens.push([nextTokenPos, i]);
                        }
                        nextTokenPos = i+1;
                    }
                    break;
                case '"':
                    insideQuotes = !insideQuotes;
                    break;
            }
        }
        if(nextTokenPos != line.length) {
            tokens.push([nextTokenPos, line.length]);
        }
        return tokens;
    }

    private findCommandName(line: string, tokens: TokenList): number | null {

        let i = 0;
        let lastFetchedTokenIndex = -1;
        let lastFetchedTokenValue = null;

        let getTokenValue = (index): string => {
            if(tokens.length <= index)
                return undefined;

            if(lastFetchedTokenIndex == index)
                return lastFetchedTokenValue;

            let token = tokens[index];
            lastFetchedTokenIndex = index;
            lastFetchedTokenValue = line.slice(token[0], token[1]).toUpperCase();
            return lastFetchedTokenValue;
        };

        if(true) {
            let value = getTokenValue(i);
            if(value[value.length - 1] == ':') // label
                ++i;
        }
        
        switch(getTokenValue(i))
        {
            case undefined:
            case "REPEAT":
            case "SWITCH":
                return null;

            case "WHILE": case "WHILENOT":
            case "IF": case "IFNOT":
                ++i;
                break;
        }

        switch(getTokenValue(i))
        {
            case "AND": case "OR":
                ++i;
                break;
        }

        if(getTokenValue(i) == "NOT")
            ++i;
        
        return tokens.length <= i? null : i;
    }
}
