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
        let typedLettersM = lineTillCurrentPosition.match(/^\s*(?:\w+:)?\s*(?:(?:IF\s+)|(?:WHILE\s+))?(?:(?:AND\s+)|(?:OR\s+))?(?:NOT\s+)?([_\w]+)$/i);
        if(!typedLettersM)
            return Promise.resolve(null);

        console.log(`Completing ${typedLettersM[1]}`);
        return this.getCommandCompletions();
    }

    public resolveCompletionItem(item: vscode.CompletionItem,
                                 token: vscode.CancellationToken): Thenable<vscode.CompletionItem>
    {
        if(item.kind != vscode.CompletionItemKind.Function || item.documentation != null)
            return Promise.resolve(item);

        let command = this.gta3ctx.getCommand(item.label);
        return this.gta3ctx.queryDocumentation(command).then((doc) => {
            // Note: this mutates this.cachedItems, but it's fine.
            item.documentation = doc.longDescription;
            return item;
        });
    }

    private getCommandCompletions(): Promise<vscode.CompletionItem[]> {
        if(this.gta3ctx.getConfigToken() != this.configToken) {
            console.log("Caching completion list...");
            this.configToken = this.gta3ctx.getConfigToken();
            this.cachedItems = new Array<vscode.CompletionItem>();
            let commands = this.gta3ctx.getCommands();
            for(const name in commands) {
                if(commands.hasOwnProperty(name)) {
                    let completion = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
                    this.cachedItems.push(completion);
                }
            }
        }
        return Promise.resolve(this.cachedItems);
    }
}
