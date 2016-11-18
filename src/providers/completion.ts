'use strict';
import * as vscode from 'vscode';
import {GTA3ScriptController} from '../controller';
import {GTA3SignatureHelpProvider} from './signature';

export class GTA3CompletionItemProvider implements vscode.CompletionItemProvider {

    private configToken: number = -1;
    private cachedItems: vscode.CompletionItem[];

    public constructor(private gta3ctx: GTA3ScriptController,
                       private signatureProvider: GTA3SignatureHelpProvider)
    {
    }

    public provideCompletionItems(document: vscode.TextDocument,
                                  position: vscode.Position,
                                  token: vscode.CancellationToken): Thenable<vscode.CompletionItem[]>
    {
        let lineTillCurrentPosition = document.getText(new vscode.Range(position.line, 0, position.line, position.character));

        // Check if in the middle of typing a command name.
        let typingCommand = lineTillCurrentPosition.match(/^\s*(?:\w+:\s*)?(?:IF\s+|WHILE\s+|IFNOT\s+|WHILENOT\s+)?(?:AND\s+|OR\s+)?(?:NOT\s+)?([_\w]+)$/i);
        if(typingCommand) {
            return this.getCommandCompletions();
        }

        // Check if in the middle of a argument then.
        let basicSignature = this.signatureProvider.provideBasicSignatureHelp(document, position);
        if(basicSignature == null || basicSignature.activeArgument == null)
            return Promise.resolve(null);

        // Check if argument is an enumeration.
        let enumName = basicSignature.activeArgument.enum || (basicSignature.activeArgument.hint == "Bool"? "BOOL" : null);
        if(enumName) {
            let constants = this.gta3ctx.getEnumeration(enumName);
            let items = constants.map(([name, value]) => {
                let item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Enum);
                item.detail = value.toString();
                return item;
            });
            return Promise.resolve(items);
        }

        return Promise.resolve(null);
    }

    public resolveCompletionItem(item: vscode.CompletionItem,
                                 token: vscode.CancellationToken): Thenable<vscode.CompletionItem>
    {
        if(item.kind != vscode.CompletionItemKind.Function || item.documentation != null)
            return Promise.resolve(item);

        let command = this.gta3ctx.getCommand(item.label);
        return this.gta3ctx.queryDocumentation(command).then((doc) => {
            // Note: this mutates this.cachedItems, but it's okay.
            item.documentation = doc.longDescription;
            item.detail = this.gta3ctx.getGameSpec(doc.games, false);
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
