'use strict';
import * as vscode from 'vscode';
import {GTA3ScriptController} from '../controller';

export class GTA3HoverProvider implements vscode.HoverProvider {

    public constructor(private gta3ctx: GTA3ScriptController) {
    }

    public provideHover(document: vscode.TextDocument,
                        position: vscode.Position,
                        token: vscode.CancellationToken): Thenable<vscode.Hover>
    {
        if(true)
            return Promise.resolve(new vscode.Hover(["<strong>Yay</strong>You**Suck**", "<strong>Yay</strong>You**Suck**"]));

        /*
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

        if(currentArg != 0) {
            return Promise.resolve(null);
        }

        return this.gta3ctx.queryDocumentation(command).then((doc) => {
            return new vscode.Hover(doc.longDescription);
        });*/
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

