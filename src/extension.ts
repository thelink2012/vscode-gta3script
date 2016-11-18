'use strict';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { GTA3ScriptController } from './controller';
import { GTA3CompletionItemProvider } from './providers/completion';
import { GTA3SignatureHelpProvider } from './providers/signature';
import { GTA3HoverProvider } from './providers/hover';
import { invokeCompiler } from './compiler';

const GTA3_MODE: vscode.DocumentFilter = { language: 'gta3script', scheme: 'file' };

let diagnosticCollection: vscode.DiagnosticCollection;

import { GTA3DocumentationController } from './documentation/controller';
import { GTAGDocumentationProvider } from './documentation/gtag';
import { GTAModdingDocumentationProvider } from './documentation/gtamodding';

export function activate(context: vscode.ExtensionContext) {
    
    console.log("gta3script extension being activated");

    let wsconfig = vscode.workspace.getConfiguration("gta3script");

    let docProviders = wsconfig.get<[string]>("docprovider").map(v => {
        if(v == "GTAModding") return new GTAModdingDocumentationProvider();
        if(v == "GTAG Opcode Database") return new GTAGDocumentationProvider();
        return null;
    }).filter(v => v != null);

    let docController = new GTA3DocumentationController(docProviders);
    let gta3ctx = new GTA3ScriptController(docController);
    gta3ctx.loadConfig(wsconfig.get<string>("config"));

	diagnosticCollection = vscode.languages.createDiagnosticCollection('gta3script');
	context.subscriptions.push(diagnosticCollection);

    let sighelp = new GTA3SignatureHelpProvider(gta3ctx);
    context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(GTA3_MODE, sighelp, '(', ',', ' '));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(GTA3_MODE, new GTA3CompletionItemProvider(gta3ctx, sighelp), '.'));////////////////////////////////////////////////
    context.subscriptions.push(vscode.languages.registerHoverProvider(GTA3_MODE, new GTA3HoverProvider(gta3ctx, sighelp)));

	context.subscriptions.push(vscode.commands.registerCommand('gta3script.build.build', () => {
		build();
	}));
}

export function deactivate() {
}

function build(): Promise<any>
{
    let mapTypeToSeverity = type => {
        switch(type) {
            case "fatal error": return vscode.DiagnosticSeverity.Error;
            case "error": return vscode.DiagnosticSeverity.Error;
            case "warning": return vscode.DiagnosticSeverity.Warning;
            case "note": return vscode.DiagnosticSeverity.Information;
            default: return vscode.DiagnosticSeverity.Error;
        }
    };

    let editor = vscode.window.activeTextEditor;
    if(!editor || editor.document.languageId !== 'gta3script') {
        return Promise.reject("Current file is not a GTA3script file.");
    }

    let wsconfig = vscode.workspace.getConfiguration("gta3script");
    let cfgname = wsconfig.get<string>("config");
    let filename = editor.document.uri.fsPath;

    return invokeCompiler(wsconfig, filename, cfgname).then(diags => {
        diagnosticCollection.clear();
        for(let diag in diags) {

        }
    });
}
