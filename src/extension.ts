'use strict';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as cp from 'child_process';
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

export function activate(context: vscode.ExtensionContext) 
{
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

    context.subscriptions.push(vscode.commands.registerCommand('gta3script.cmd.build', () => {
        build();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('gta3script.cmd.buildrun', () => {
        build().then(() => rungame());
    }));

    context.subscriptions.push(vscode.commands.registerCommand('gta3script.cmd.run', () => {
        rungame();
    }));
}

export function deactivate()
{
}

function rungame(): Thenable<void> {

    let wsconfig = vscode.workspace.getConfiguration("gta3script");
    let cfgname = wsconfig.get<string>("config");

    let gamebin = wsconfig.get<string[]>(`gamebin.${cfgname}`, [null]);
    if(!gamebin || !gamebin.length || !gamebin[0]) {
        vscode.window.showInformationMessage("Cannot find the game executable, please configure the extension appropriately.");
        return Promise.reject(null);
    }

    // spawn dettached process.
    cp.spawn(gamebin[0], gamebin.slice(1), {
        detached: true,
        stdio: 'ignore',
        cwd: gamebin[0].split(/\\|\//g).slice(0,-1).join('/'),
    }).unref();

    return Promise.resolve(null);
}

function build(): Thenable<void>
{
    let wsconfig = vscode.workspace.getConfiguration("gta3script");
    let cfgname = wsconfig.get<string>("config");

    diagnosticCollection.clear();

    if(vscode.workspace.rootPath === undefined) {
        let editor = vscode.window.activeTextEditor;
        if(!editor || editor.document.languageId !== 'gta3script') {
            vscode.window.showInformationMessage("Current file is not a GTA3script file.");
            return Promise.reject(null);
        }
        return buildFile(wsconfig, cfgname, editor.document.uri.fsPath);
    }

    return vscode.workspace.findFiles("*.sc", "").then(uris => {
        let promise = Promise.resolve();
        uris.map(uri => uri.fsPath).forEach(file => { // build one after the other
            promise = promise.then(() => buildFile(wsconfig, cfgname, file));
        });
        return promise;
    });
}

function buildFile(wsconfig: vscode.WorkspaceConfiguration,
                   cfgname: string,
                   filename: string): Promise<void> 
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

    return invokeCompiler(wsconfig, filename, cfgname).then(diags => {
        let anyError = false;

        let diagnosticMap: Map<string, vscode.Diagnostic[]> = new Map();

        for(let diag of diags) {
            let severity = mapTypeToSeverity(diag.type);
            anyError = anyError || (severity == vscode.DiagnosticSeverity.Error);

            if(!diag.file) {
                if(severity == vscode.DiagnosticSeverity.Error)
                    vscode.window.showErrorMessage("GTA3script: " + diag.message);
                else
                    vscode.window.showInformationMessage("GTA3script: " + diag.message);
                continue;
            }

            let canonicalFile = vscode.Uri.file(diag.file).toString();
            let lineno = diag.line || 1;
            let colno  = diag.column || 1;
            let length = diag.length || 1;

            let range = new vscode.Range(lineno-1, colno-1, lineno-1, colno+length-1);
            let diagnostic = new vscode.Diagnostic(range, diag.message, severity);

            let diagnostics = diagnosticMap.get(canonicalFile);
            if (!diagnostics) {
                diagnostics = [];
            }
            diagnostics.push(diagnostic);
            diagnosticMap.set(canonicalFile, diagnostics);
        }

        diagnosticMap.forEach((diags, file) => {
            diagnosticCollection.set(vscode.Uri.parse(file), diags);
        });

        if(anyError) {
            return Promise.reject("Compilation failed.")
        }
    });
}
