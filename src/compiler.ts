'use strict';
import {ModelsData} from './controller'
import {outputChannel} from './status';
import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';

//
// Function naming scheme:
//
//  + Those named `requireSomething` will produce output to the user in case of failure, plus the broken promise is returned.
//  + Those named `querySomething` won't  give any output to the user, but the broken promise is returned.
//  + Those named `invokeSomething` behaves like `requireSomething`.
//

interface CompilerResult {
    file: string | null,
    line: number | null,
    column: number | null,
    type: string | null,
    message: string,
}

export function invokeCompiler(wsconfig: vscode.WorkspaceConfiguration,
                               filename: string, cfgname: string): Promise<CompilerResult[]>
{
    let cwd = path.dirname(filename);

    return requireCompilerPath(wsconfig).then(gta3sc => {
        return new Promise((resolve, reject) => {
            let args = pushDataDirToArgs(wsconfig, cfgname, ["compile", filename, `--config=${cfgname}`]);
            let buildflags = wsconfig.get(`buildflags.${cfgname}`, [])
            cp.execFile(gta3sc, args.concat(buildflags), (err, stdout, stderr) => {
                if(err != null && (<any>err).code === 'ENOENT') {
                    vscode.window.showInformationMessage("Compiler set in gta3script.compiler does not exist.");
                    return resolve([]);
                }

                let results = new Array<CompilerResult>();
                let regex = /^((?:\w:[\\/])?[^:]+):(?:(\d+):)?(?:(\d+):)?(?: (error|warning|note|fatal error):)? (.*)$/;

				for(let pipeLine of stderr.split(/\r?\n/g)) {

                    console.log(pipeLine);
                    outputChannel.appendLine(pipeLine);

					if(pipeLine[0] === ' ' || pipeLine[0] === '\t' && results.length > 0) {
						results[results.length - 1].message += '\n' + pipeLine;
						continue;
					}

					let match = regex.exec(pipeLine);
					if(match) {
                        let [file, lineno, colno, type, message] = match;
                        results.push({
                            file: file == "gta3sc"? null : path.resolve(cwd, file),
                            line: lineno? +lineno : null,
                            column: colno? +colno : null,
                            type: type || null,
                            message: message,
                        });
                    }
				}
                
				return resolve(results);
            });
        });
    });
}

/// Queries where is the config/ path with GTA3script configurations.
export function queryConfigPath(wsconfig: vscode.WorkspaceConfiguration): Promise<string>
{
    let configpath = wsconfig.get<string|null>("configpath");
    if(configpath != null)
        return Promise.resolve(configpath);

    return requireCompilerPath(wsconfig).then(gta3sc => {
        return new Promise((resolve, reject) => {
            cp.execFile(gta3sc, ["query-config-path"], (err, stdout, stderr) => {
                if(err != null) {
                    return reject(`${err.message}\n${stderr}`);
                }
                return resolve(stdout);
            });
        });
    }).catch(err => {
        return Promise.reject(`Failed to query config path: ${err}`);
    });
}

/// Queries list of models from the script compiler.
export function queryModels(wsconfig: vscode.WorkspaceConfiguration,
                    cfgname: string,
                    askingfor: string = "default"): Promise<ModelsData>
{
    return requireCompilerPath(wsconfig).then(gta3sc => {
        return new Promise((resolve, reject) => {
            let args = pushDataDirToArgs(wsconfig, cfgname, ["query-models", askingfor, `--config=${cfgname}`]);
            cp.execFile(gta3sc, args, (err, stdout, stderr) => {
                if(err != null) {
                    return reject(`${err.message}\n${stderr}`);
                }

                let type = -1;
                let models: ModelsData = {
                    default: [],
                    level: [],
                };

                for(let line of stdout.split(/\r?\n/g)) {
                    if(line && line[0] == '=') {
                        switch(line) {
                            case "=DEFAULT":
                                type = 1;
                                break;
                            case "=LEVEL":
                                type = 2;
                                break;
                            default:
                                type = -1;
                                break;
                        }
                    } else if(line) {
                        let data = line.split(' ');
                        if(type == 1) {
                            models.default.push([data[0].toUpperCase(), parseInt(data[1])]);
                        } else if(type == 2) {
                            models.level.push([data[0].toUpperCase(), parseInt(data[1])]);
                        }
                    }
                }

                return resolve(models);
            });
        });
    }).catch(err => {
        return Promise.reject(`Failed to query models from compiler: ${err}`);
    });
}


function pushDataDirToArgs(wsconfig: vscode.WorkspaceConfiguration,
                          cfgname: string, args: string[]): string[]
{
    let datadir = getGameDataPath(wsconfig, cfgname);
    if(datadir) {
        args.push(`--datadir=${datadir}`);
    }
    return args;
}

function getGameDataPath(wsconfig: vscode.WorkspaceConfiguration,
                         cfgname: string): string | null
{
    let gamebin = wsconfig.get<string[]>(`gamebin.${cfgname}`, [null]);
    if(gamebin && gamebin[0]) {
        let components = gamebin[0].split(/\\|\//g);
        components.pop();
        return path.join(...components, "data");
    }
    return null;
}

function requireCompilerPath(wsconfig: vscode.WorkspaceConfiguration): Promise<string>
{
    const message = "Cannot find the GTA3script compiler, please configure the extension appropriately.";

    let gta3sc = wsconfig.get<string|null>("compiler");
    if(gta3sc == null) {
        vscode.window.showInformationMessage(message);
        return Promise.reject("gta3script.compiler not set");
    }

    return Promise.resolve(gta3sc);
}
