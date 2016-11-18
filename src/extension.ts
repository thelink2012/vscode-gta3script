'use strict';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { GTA3ScriptController } from './controller';
import { GTA3CompletionItemProvider } from './providers/completion';
import { GTA3SignatureHelpProvider } from './providers/signature';
import { GTA3HoverProvider } from './providers/hover';

const GTA3_MODE: vscode.DocumentFilter = { language: 'gta3script', scheme: 'file' };

import { GTA3DocumentationController } from './documentation/controller';
import { GTAGDocumentationProvider } from './documentation/gtag';
import { GTAModdingDocumentationProvider } from './documentation/gtamodding';

export function activate(context: vscode.ExtensionContext) {

    let docController = new GTA3DocumentationController([
        // Order matters.
        new GTAModdingDocumentationProvider(),
        new GTAGDocumentationProvider(),
    ]);

    let gta3ctx = new GTA3ScriptController(docController);
    gta3ctx.loadConfig("gtasa");

    let sighelp = new GTA3SignatureHelpProvider(gta3ctx);
    context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(GTA3_MODE, sighelp, '(', ',', ' '));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(GTA3_MODE, new GTA3CompletionItemProvider(gta3ctx, sighelp), '.'));////////////////////////////////////////////////
    context.subscriptions.push(vscode.languages.registerHoverProvider(GTA3_MODE, new GTA3HoverProvider(gta3ctx, sighelp)));
}

export function deactivate() {
}
