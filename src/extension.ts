'use strict';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as cp from 'child_process';
import { GTA3ScriptController } from './controller';
import { GTA3CompletionItemProvider } from './providers/completion';
import { GTA3SignatureHelpProvider } from './providers/signature';
import { GTA3HoverProvider } from './providers/hover';
import { invokeCompiler } from './compiler';
import { BUILD_FLAGS, getFlagStates, toggleFlag, getFlagNameByLabel } from './buildflags';

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

    let docController = new GTA3DocumentationController(docProviders, context.globalState);
    context.subscriptions.push(docController);

    let gta3ctx = new GTA3ScriptController(docController);

    diagnosticCollection = vscode.languages.createDiagnosticCollection('gta3script');
    context.subscriptions.push(diagnosticCollection);

    let sighelp = new GTA3SignatureHelpProvider(gta3ctx);
    context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(GTA3_MODE, sighelp, '(', ',', ' '));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(GTA3_MODE, new GTA3CompletionItemProvider(gta3ctx, sighelp)));
    context.subscriptions.push(vscode.languages.registerHoverProvider(GTA3_MODE, new GTA3HoverProvider(gta3ctx, sighelp)));

    let gameStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, Number.MIN_VALUE + 1);
    gameStatusBar.command = "gta3script.cmd.selectgame";
    gameStatusBar.tooltip = "Which game to compile for and work with";
    gameStatusBar.show();
    context.subscriptions.push(gameStatusBar);

    let flagsStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, Number.MIN_VALUE + 0);
    flagsStatusBar.command = "gta3script.cmd.buildflags";
    flagsStatusBar.tooltip = "Build flags";
    flagsStatusBar.show();
    context.subscriptions.push(flagsStatusBar);

    let buildingBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MIN_VALUE + 0);
    buildingBar.hide();
    context.subscriptions.push(buildingBar);
    
    const startBuildingBar = (): NodeJS.Timer => {
        const spinning = "|/-\\";
        let currentSpin = 0;
        buildingBar.text = spinning[currentSpin++];
        buildingBar.show();
        return setInterval(() => {
            buildingBar.text = spinning[currentSpin++ % spinning.length];
        }, 50);
    };

    const stopBuildingBar = (timer: NodeJS.Timer) => {
        clearInterval(timer);
        buildingBar.hide();
    };

    context.subscriptions.push(vscode.commands.registerCommand('gta3script.cmd.cleardocs', () => {
        docController.clearCache();
        docController.saveCache();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('gta3script.cmd.build', () => {
        vscode.workspace.saveAll(false).then(() => {
            let timer = startBuildingBar();
            build().catch(_ => {}).then(_ => stopBuildingBar(timer))
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('gta3script.cmd.buildrun', () => {
        vscode.workspace.saveAll(false).then(() => {
            let timer = startBuildingBar();
            build().then(() => rungame()).catch(_ => {}).then(_ => stopBuildingBar(timer))
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('gta3script.cmd.run', () => {
        rungame().catch(() => {});
    }));

    context.subscriptions.push(vscode.commands.registerCommand('gta3script.cmd.selectgame', () => {
        let games = Object.keys(wsconfig.get("buildflags")).map(v => v.toUpperCase());
        vscode.window.showQuickPick(games).then(selection => {
            if(selection) {
                (<any>wsconfig).update("config", selection.toLowerCase(), true);
            }
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('gta3script.cmd.buildflags', () => {
        let config = wsconfig.get<string>("config");
        let setflags = wsconfig.get<string[]>(`buildflags.${config}`, []);
        let flagstates = getFlagStates(setflags);
        let labels = [];
        for(let flagname in flagstates) {
            let switchTo = flagstates[flagname]? "Disable" : "Enable";
            labels.push(`${switchTo} ${BUILD_FLAGS[flagname].label}`);
        }
        vscode.window.showQuickPick(labels).then(selection => {
            if(selection) {
                let fullconfig = wsconfig.get("buildflags", {});
                let flagname = getFlagNameByLabel(selection);
                let global = (vscode.workspace.rootPath === undefined);
                fullconfig[config] = toggleFlag(setflags, flagname);
                (<any>wsconfig).update("buildflags", fullconfig, global);
            }
        });
    }));

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        if(!editor || !vscode.languages.match(GTA3_MODE, editor.document)) {
            gameStatusBar.hide();
            flagsStatusBar.hide();
        } else {
            gameStatusBar.show();
            flagsStatusBar.show();
        }
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => {
        return updateConfig(gta3ctx, gameStatusBar, flagsStatusBar);
    }));

    updateConfig(gta3ctx, gameStatusBar, flagsStatusBar);
}

function updateConfig(gta3ctx: GTA3ScriptController,
                      gameStatusBar: vscode.StatusBarItem,
                      flagsStatusBar: vscode.StatusBarItem) 
{
    let wsconfig = vscode.workspace.getConfiguration("gta3script");
    let configSetting = wsconfig.get<string>("config");
    let buildflags = wsconfig.get<string[]>(`buildflags.${configSetting}`, []);

    if(gta3ctx.getConfigName() !== configSetting) {
        gta3ctx.loadConfig(configSetting);
    }

    gameStatusBar.text = configSetting.toUpperCase();
    flagsStatusBar.text = buildflags.indexOf("--cs") >= 0? "CS" :
                          buildflags.indexOf("--cm") >= 0? "CM" : "MAIN";
}

function rungame(): Promise<void> 
{
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

function build(): Promise<void>
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

    return new Promise((resolve, reject) => {
        vscode.workspace.findFiles("*.sc", "").then(uris => {
            let promise = Promise.resolve();
            uris.map(uri => uri.fsPath).forEach(file => { // build one after the other
                promise = promise.then(() => buildFile(wsconfig, cfgname, file));
            });
            promise.then(_ => resolve(null)).catch(e => reject(e));
        });
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
                else if(severity == vscode.DiagnosticSeverity.Warning)
                    vscode.window.showWarningMessage("GTA3script: " + diag.message);
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
