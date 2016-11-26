/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

// <reference types="es6-collections" />
/// <reference types="node" />

import {
	DebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent, Event,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint
} from 'vscode-debugadapter';
import {DebugProtocol} from 'vscode-debugprotocol';
import {readFileSync} from 'fs';
import {basename} from 'path';
import * as net from 'net';

const ATTACH_TIMEOUT = 10000;
const REQUEST_TIMEOUT = 5000;
const HANDSHAKE_TIMEOUT = 3000;

interface GTA3DebugClientConnection
{
	onDisconnect: any,
}

class GTA3DebugClient
{
	private eventHandlers: {};

	private socket: net.Socket;
	private handshaked: boolean;
	private currentSequenceId: number;
	private responseHandlers: {};

	constructor() {
		this.socket = null;
		this.eventHandlers = {};
	}

	public on(event: string, cb: any) {
		this.eventHandlers[event] = cb;
	}

	public detach()
	{
		if(this.socket) {
			this.socket.destroy();
			this.socket = null;
		}
	}

	public attach(host: string, port: number, timeout: number): Promise<GTA3DebugClientConnection>
	{
		if(this.socket != null)
			return Promise.reject("there's a gta3debug connection already open");

		let connected = false;
		let dataBuffer = "";
		let socket = new net.Socket();

		// initialise
		this.currentSequenceId = 0;
		this.handshaked = false;
		this.responseHandlers = {};
		this.socket = socket;

		if(host == "localhost") {
			host = "127.0.0.1";
		}

		if(!port) {
			port = 58754;
		}
		
		return new Promise((resolve, reject) => {
			let connectionHandle: GTA3DebugClientConnection = {
				onDisconnect: null,
			}

			let onTerminate = (reason) => {
				this.detach();
				
				if(connected) {
					if(connectionHandle.onDisconnect) {
						connectionHandle.onDisconnect();
					}
				} else {
					reject(reason || "no reason");
				}
			};

			let onFatalError = (reason) => {
				onTerminate(reason);
			};

			socket.connect(port, host, () => {
				connected = true;
				this.request('capabilities_get', {}).then((json) => {
					this.handshaked = true;
					resolve(connectionHandle);
				}).catch(e => {
					onFatalError(e);
				});
			});

			socket.on('data', (data) => {
				try {
					let string = data.toString('utf8');
					let currentIndex = 0;
					for(let currentIndex = 0; currentIndex < string.length; ) {
						let nextNull = string.indexOf('\0', currentIndex);
						if(nextNull == -1) {
							dataBuffer += string.slice(currentIndex);
							currentIndex = string.length + 1;
						} else {
							dataBuffer += string.slice(currentIndex, nextNull);
							// TODO what if not a json
							this.handleMessage(JSON.parse(dataBuffer));
							dataBuffer = "";
							currentIndex = nextNull + 1;
						}
					}
				} catch(e) {
					if(e instanceof SyntaxError) // JSON.parse error
						onFatalError(e.message);
					else
						throw e;
				}
			});

			socket.on('end', () => {
				onTerminate(null);
			});

			const endTime = new Date().getTime() + timeout;
			socket.on('error', (err) => {
				if(connected) {
					onFatalError("socket error")
				} else {
					// we are not yet connected so retry a few times
					if ((<any>err).code === 'ECONNREFUSED' || (<any>err).code === 'ECONNRESET') {
						const now = new Date().getTime();
						if (now < endTime)
							setTimeout(() => socket.connect(port), 200); // retry after 200 ms
						else
							onFatalError("Connection timeout");
					} else {
						onFatalError(`Connection failed: ${err.message}`);
					}
				}
			});
		});
	}

	public request(command: string, args: Object): Promise<any> {
		if(this.socket == null) {
			return Promise.reject("no connection open");
		}

		let sequenceId = this.currentSequenceId;

		this.socket.write(JSON.stringify({
			"type": "request",
			"id": sequenceId,
			"command": command,
			"arguments": args,
		}) + '\0');

		if(this.currentSequenceId >= 2147483647)
			this.currentSequenceId = 0;
		else
			this.currentSequenceId++;

		return new Promise((resolve, reject) => {
			if(this.responseHandlers[sequenceId] !== undefined) {
				return reject("sequenceId overlapping!");
			}

			let timer = setTimeout(() => {
				delete this.responseHandlers[sequenceId];
				reject("request timed out");
			}, REQUEST_TIMEOUT)

			this.responseHandlers[sequenceId] = (json) => {
				clearTimeout(timer);
				delete this.responseHandlers[sequenceId];
				resolve(json);
			};
		});
	}

	private handleMessage(json: any) {
		
		console.log("Got object", json);

		// ensure handshake is correct
		if(!this.handshaked) {
			if(json["type"] == "response" && "id" in json && "body" in json && "debugprotocol" in json["body"]) {
				if("error" in json) {
					// let timeout take care of erroing
					return;
				}
			} else {
				// let timeout take care of erroing
				return;
			}
		}

		if(json["type"] == "response") {
			let handler = this.responseHandlers[json["id"]]
			if(handler) handler(json);
		} else if(json["type"] == "event") {
			let handler = this.eventHandlers[json["event"]];
			if(handler) handler(json);
		}
	}
}


/**
 * This interface should always match the schema found in the mock-debug extension manifest.
 */
export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the program to debug. */
	program: string;
	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
}

export interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
	/** An absolute path to the program to debug. */
	program: string;
	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
}

interface VarHandle
{
	frame: number,
	varindex?: number,
};

class GTA3DebugSession extends DebugSession {

	private debugClient: GTA3DebugClient;
	private _variableHandles = new Handles<VarHandle>();
	private breakpointInFile = new Map<string, number[]>();


	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor() {
		super();

		// this debugger uses zero-based lines and columns
		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);

		this.debugClient = new GTA3DebugClient();
		this.debugClient.on('break', (json) => {
			let thread = Number(json["body"]["script"]["id"]);
			this.sendEvent(new StoppedEvent("breakpoint", thread));
		});
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

		// This debug adapter implements the configurationDoneRequest.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code to use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = true;

		this.sendResponse(response);
	}

	/**
	 * Overridden from DebugSession:
	 * for attach: disconnect from process
	 * for launch: kill process
	 */
	public shutdown(): void {
		// TODO
		this.debugClient.detach();
		super.shutdown();
	}

	//======================= Launch Request ======================//

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		// TODO
	}

	protected attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments): void {
		this.debugClient.attach('localhost', null, ATTACH_TIMEOUT).then((handle) => {
			handle.onDisconnect = () => {
				console.log("Disconnecting debugger...");
				this.sendEvent(new TerminatedEvent());
			};
			console.log("Attached!");
			this.breakpointInFile.clear();
			this.sendResponse(response);
			this.sendEvent(new InitializedEvent());
		}).catch((e) => {
			console.log(`Attach failed: ${e}`);
			this.sendEvent(new TerminatedEvent());
		});
	}

	//======================= Basic Requests ======================//

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		this.request('script_list', {}).then(json => {
			response.body = { threads: [] };
			for(let item of json.body.scripts) {
				response.body.threads.push(new Thread(item.script.id, item.script.name));
			}
			this.sendResponse(response);
		}).catch(e => {
			this.sendErrorResponse(response, 0, "");
		});
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {

		var path = this.convertClientPathToDebugger(args.source.path);
		var breakpoints = new Array<Breakpoint>();
		let addPromises = new Array<Promise<number>>();
		let remPromises = new Array<Promise<void>>();

		if(this.breakpointInFile.has(path)) {
			this.breakpointInFile.get(path).forEach(id => {
				remPromises.push(this.request('breakpoint_delete', {"breakpoint": id}));
			});
			this.breakpointInFile.set(path, []);
		}

		for(let lineno of args.lines)
		{
			addPromises.push(new Promise((resolve, reject) => {
				this.request('breakpoint_set', {
					"location": {
						"type": "line",
						"target": this.convertClientLineToDebugger(lineno),
						"path": path,
					},
					"enabled": true,
				}).then(json => {
					return Number(json["body"]["breakpoint"]);
				});
			}));
		}

		Promise.all(remPromises).catch(e => {
			// ????
		});

		Promise.all(addPromises).then(ids => {
			response.body = {
				breakpoints: ids.map(id => {
					let breakpoint: DebugProtocol.Breakpoint = new Breakpoint(true);
					breakpoint.id = Number(id);
					return breakpoint;
				})
			};

			this.breakpointInFile.set(path, ids);

			this.sendResponse(response);
		}).catch(_ => {
			this.sendErrorResponse(response, 0, "");
		});
	}

	//======================= Step Requests ======================//

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.request('breakpoint_continue', {}).then(json => {
			this._variableHandles.reset();
			this.sendResponse(response);
		}).catch(e => {
			this.sendErrorResponse(response, 0, "");
		})
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.request('breakpoint_continue', {stepaction: "next"}).then(json => {
			this._variableHandles.reset();
			this.sendResponse(response);
		}).catch(e => {
			this.sendErrorResponse(response, 0, "");
		})
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments) : void {
		this.request('breakpoint_continue', {stepaction: "stepin"}).then(json => {
			this._variableHandles.reset();
			this.sendResponse(response);
		}).catch(e => {
			this.sendErrorResponse(response, 0, "");
		})
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments) : void {
		this.request('breakpoint_continue', {stepaction: "stepout"}).then(json => {
			this._variableHandles.reset();
			this.sendResponse(response);
		}).catch(e => {
			this.sendErrorResponse(response, 0, "");
		})
	}

	//======================= Frames Requests ======================//

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {

		this.request('frame_list', {"script": {"id": args.threadId }}).then(json => {

			let frames = new Array<StackFrame>();
			let jsonFrames = <any[]>json["body"]["frames"];

			const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
			const maxLevels = typeof args.levels === 'number' ? args.levels : jsonFrames.length-startFrame;
			const endFrame = Math.min(startFrame + maxLevels, jsonFrames.length);
			
			for(let i = startFrame; i < endFrame; ++i)
			{
				let jsonFrame = jsonFrames[i];
				let isLineLocation = jsonFrame.location.type == "line";
				let sourceFile   = isLineLocation? jsonFrame.location.path : "";
				let sourceLine   = isLineLocation? jsonFrame.location.target : 0;
				frames.push(new StackFrame(jsonFrame.frame, "noname", // TODO give a name to this stack frame?
							   !isLineLocation? undefined : new Source(basename(sourceFile), this.convertDebuggerPathToClient(sourceFile)),
							   this.convertDebuggerLineToClient(sourceLine), 0));
			}

			response.body = {
				stackFrames: frames,
				totalFrames: jsonFrames.length,
			};
			this.sendResponse(response);

		}).catch(e => {
			this.sendErrorResponse(response, 0, "");
		})
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		let scopes = new Array<Scope>();
		scopes.push(new Scope("Local", this._variableHandles.create({ frame: args.frameId }), false));
		scopes.push(new Scope("Global", this._variableHandles.create({ frame: -1 }), true));

		response.body = {
			scopes: scopes
		};

		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {

		let variables = new Array<DebugProtocol.Variable>();
		const varh = this._variableHandles.get(args.variablesReference);

		if(varh.frame == -1)
		{
			// TODO
			this.sendErrorResponse(response, 0, "");
		}
		else
		{
			if(varh.varindex === undefined)
			{
				this.request('frame_varlist', {"frame": varh.frame}).then(json => {
					for(let vardata of json["body"]["vars"]) {
						let v = vardata["var"]

						let respVar = {
							name: v.name.toLowerCase(),
							type: v.type,
							variablesReference: 0,
							value: "",
						};

						if(v.count !== undefined) {
							respVar["indexedVariables"] = v.count;
							respVar["variablesReference"] = this._variableHandles.create({frame: varh.frame, varindex: v.index });
							respVar["value"] = `${v.type}[${v.count}]`;
						} else {
							respVar["value"] = vardata["value"];
						}

						variables.push(respVar)
					}

					response.body = {
						variables: variables
					};

					this.sendResponse(response);

				}).catch(e => {
					this.sendErrorResponse(response, 0, "");
				});
			}
			else
			{
				// TODO improve performance of request (i.e. add a varindex field)
				this.request('frame_varlist', {"frame": varh.frame}).then(json => {
					for(let vardata in json["body"]["vars"]) {
						let v = vardata["var"]

						if(v.index != varh.varindex)
							continue;

						for(let i = 0; i < v.count; ++i) {
							variables.push({
								name: v.name.toLowerCase(),
								type: v.type,
								variablesReference: 0,
								value: vardata["value"][i],
							});
						}
					}

					response.body = {
						variables: variables
					};
					
					this.sendResponse(response);

				}).catch(e => {
					this.sendErrorResponse(response, 0, "");
				});
			}
		}
	}

	//======================= Evaluate Requests ======================//

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		// TODO
		response.body = {
			result: `evaluate(context: '${args.context}', '${args.expression}')`,
			variablesReference: 0
		};
		this.sendResponse(response);
	}


	//======================= Helpers ======================//

	public request(command: string, args: Object): Promise<any> {
		return this.debugClient.request(command, args).catch((e) => {
			// TODO
			console.log(`request failed: ${e}`)
			return Promise.reject(e);
		});
	}

	protected convertClientPathToDebugger(clientPath: string): string {
		return super.convertClientPathToDebugger(clientPath).replace(/\\/g, '/');
	}
}

DebugSession.run(GTA3DebugSession);
