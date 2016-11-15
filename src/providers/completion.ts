'use strict';
import * as vscode from 'vscode';
import {GTA3ScriptController} from '../controller';

export class GTA3CompletionItemProvider implements vscode.CompletionItemProvider {

    private configToken: number = -1;
    private cachedItems: vscode.CompletionItem[];

    public constructor(private gta3ctx: GTA3ScriptController) {
    }

    public provideCompletionItems(document: vscode.TextDocument,
                                  position: vscode.Position,
                                  token: vscode.CancellationToken): Thenable<vscode.CompletionItem[]>
    {
        let lineTillCurrentPosition = document.getText(new vscode.Range(position.line, 0, position.line, position.character));

        // Check if in the middle of typing a command name.
        if(!lineTillCurrentPosition.match(/^\s*(?:\w+:)?\s*(?:(?:IF\s+)|(?:WHILE\s+))?(?:(?:AND\s+)|(?:OR\s+))?(?:NOT\s+)?([_\w]+)$/i))
            return Promise.resolve(null);
        
        return this.getCachedCompletions();
    }

    private getCachedCompletions(): Promise<vscode.CompletionItem[]> {
        if(this.gta3ctx.getConfigToken() != this.configToken) {
            console.log("Caching completion list...");
            this.configToken = this.gta3ctx.getConfigToken();
            this.cachedItems = [];
            let commands = this.gta3ctx.getCommands();
            for(const key in commands) {
                if(commands.hasOwnProperty(key)) {
                    let command = commands[key];
                    let completion = new vscode.CompletionItem(command.name, vscode.CompletionItemKind.Function);
                    this.cachedItems.push(completion);
                }
            }
        }
        return Promise.resolve(this.cachedItems);
    }
}
