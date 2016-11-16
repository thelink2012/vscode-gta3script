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
        let wordRange = document.getWordRangeAtPosition(position);
        let hoverText = document.getText(wordRange);
        
        console.log(`Hovering ${hoverText}`);

        let command = this.gta3ctx.getCommand(hoverText);
        if(command == null) {
            return Promise.resolve(null);
        }

        return this.gta3ctx.queryDocumentation(command).then((doc) => {
            return new vscode.Hover(doc.longDescription);
        });
    }
}

