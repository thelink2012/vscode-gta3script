'use strict';
import * as vscode from 'vscode';
import {GTA3ScriptController} from '../controller';
import {GTA3SignatureHelpProvider} from './signature';

export class GTA3HoverProvider implements vscode.HoverProvider {
    
    public constructor(private gta3ctx: GTA3ScriptController,
                       private signatureProvider: GTA3SignatureHelpProvider)
    {
    }

    public provideHover(document: vscode.TextDocument,
                        position: vscode.Position,
                        token: vscode.CancellationToken): Thenable<vscode.Hover>
    {
        let wordRange = document.getWordRangeAtPosition(position);
        let hoverText = document.getText(wordRange);
        
        let command = this.gta3ctx.getCommand(hoverText);
        if(command == null) {
            return Promise.resolve(null);
        }

        let signatureMarkdown = {
            language: "gta3script",
            value: this.signatureProvider.getCompleteSignatureForCommand(command)
        };

        return this.gta3ctx.queryDocumentation(command).then((doc) => {
            let descriptionText = doc.longDescription;
            if(doc.uri != null) {
                descriptionText = `${descriptionText}\n\n[See online reference.](${doc.uri})`;
            }
            return new vscode.Hover([signatureMarkdown, descriptionText]);
        }).catch(e => { // fallback
            return new vscode.Hover([signatureMarkdown]);
        });
    }
}
