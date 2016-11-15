'use strict';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { GTA3ScriptController } from './controller';
import { GTA3CompletionItemProvider } from './providers/completion';
import { GTA3SignatureHelpProvider } from './providers/signature';
import { GTA3HoverProvider } from './providers/hover';

// TODO replace match with test

const GTA3_MODE: vscode.DocumentFilter = { language: 'gta3script', scheme: 'file' };

import { GTAGDocumentationProvider } from './documentation/gtag';
import { GTAModdingDocumentationProvider } from './documentation/gtamodding';

export function activate(context: vscode.ExtensionContext) {

    let gta3ctx = new GTA3ScriptController([new GTAModdingDocumentationProvider()]);
    gta3ctx.loadConfig("gtasa").then(_ => {
        console.log("UAU");
        new GTAModdingDocumentationProvider().provideDocumentation(gta3ctx, gta3ctx.getCommand("CREATE_CAR"));
    });

    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(GTA3_MODE, new GTA3CompletionItemProvider(gta3ctx), '.'));
    context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(GTA3_MODE, new GTA3SignatureHelpProvider(gta3ctx), '(', ',', ' '));
    context.subscriptions.push(vscode.languages.registerHoverProvider(GTA3_MODE, new GTA3HoverProvider(gta3ctx)));
}

export function deactivate() {
}
