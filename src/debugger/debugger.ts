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
	private socket: net.Socket;
	private handshaked: boolean;
	private currentSequenceId: number;
	private responseHandlers: {};

	constructor() {
		this.socket = null;
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

			console.log("UU");
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
			// TODO
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

class MockDebugSession extends DebugSession {

	private debugClient: GTA3DebugClient;

	// we don't support multiple threads, so we can use a hardcoded ID for the default thread
	private static THREAD_ID = 1;

	// since we want to send breakpoint events, we will assign an id to every event
	// so that the frontend can match events with breakpoints.
	private _breakpointId = 1000;

	// This is the next line that will be 'executed'
	private __currentLine = 0;
	private get _currentLine() : number {
		return this.__currentLine;
    }
	private set _currentLine(line: number) {
		this.__currentLine = line;
		this.sendEvent(new OutputEvent(`line: ${line}\n`));	// print current line on debug console
	}

	// the initial (and one and only) file we are 'debugging'
	private _sourceFile: string;

	// the contents (= lines) of the one and only file
	private _sourceLines = new Array<string>();

	// maps from sourceFile to array of Breakpoints
	private _breakPoints = new Map<string, DebugProtocol.Breakpoint[]>();

	private _variableHandles = new Handles<string>();


	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor() {
		super();

		this.debugClient = new GTA3DebugClient();

		// this debugger uses zero-based lines and columns
		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);
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

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		// TODO
	}

	protected attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments): void
	{
		console.log("AA");
		this.debugClient.attach('localhost', null, ATTACH_TIMEOUT).then((handle) => {
			handle.onDisconnect = () => {
				console.log("Disconnecting debugger...");
				this.sendEvent(new TerminatedEvent());
			};
			console.log("Attached!");
			//this.sendResponse(response);
			this.sendEvent(new InitializedEvent());
			this.beginDebugMock(response, args);
		}).catch((e) => {
			console.log(`Attach failed: ${e}`);
			this.sendEvent(new TerminatedEvent());
		});
	}

	/**
	 * Overridden from DebugSession:
	 * attach: disconnect
	 * launch: kill
	 */
	public shutdown(): void {
		this.debugClient.detach();
		super.shutdown();
	}


	public request(command: string, args: Object): Thenable<any> {
		return this.debugClient.request(command, args).catch((e) => {
			// TODO
			console.log(`request failed: ${e}`)
		});
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		this.request('script_list', {}).then(json => {
			response.body = { threads: [] };
			for(let item of json.body.scripts) {
				response.body.threads.push(new Thread(item.script.id, item.script.name));
			}
			this.sendResponse(response);
		});
	}






















	protected beginDebugMock(response: DebugProtocol.AttachResponse, args: AttachRequestArguments) {
		this._sourceFile = args.program;
		this._sourceLines = readFileSync(this._sourceFile).toString().split('\n');

		if (args.stopOnEntry) {
			this._currentLine = 0;
			this.sendResponse(response);

			// we stop on the first line
			this.sendEvent(new StoppedEvent("entry", MockDebugSession.THREAD_ID));
		} else {
			// we just start to run until we hit a breakpoint or an exception
			this.continueRequest(<DebugProtocol.ContinueResponse>response, { threadId: MockDebugSession.THREAD_ID });
		}
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {

		var path = args.source.path;
		var clientLines = args.lines;

		// read file contents into array for direct access
		var lines = readFileSync(path).toString().split('\n');

		var breakpoints = new Array<Breakpoint>();

		// verify breakpoint locations
		for (var i = 0; i < clientLines.length; i++) {
			var l = this.convertClientLineToDebugger(clientLines[i]);
			var verified = false;
			if (l < lines.length) {
				const line = lines[l].trim();
				// if a line is empty or starts with '+' we don't allow to set a breakpoint but move the breakpoint down
				if (line.length == 0 || line.indexOf("+") == 0)
					l++;
				// if a line starts with '-' we don't allow to set a breakpoint but move the breakpoint up
				if (line.indexOf("-") == 0)
					l--;
				// don't set 'verified' to true if the line contains the word 'lazy'
				// in this case the breakpoint will be verified 'lazy' after hitting it once.
				if (line.indexOf("lazy") < 0) {
					verified = true;    // this breakpoint has been validated
				}
			}
			const bp = <DebugProtocol.Breakpoint> new Breakpoint(verified, this.convertDebuggerLineToClient(l));
			bp.id = this._breakpointId++;
			breakpoints.push(bp);
		}
		this._breakPoints.set(path, breakpoints);

		// send back the actual breakpoint positions
		response.body = {
			breakpoints: breakpoints
		};
		this.sendResponse(response);
	}



	/**
	 * Returns a fake 'stacktrace' where every 'stackframe' is a word from the current line.
	 */
	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {

		const words = this._sourceLines[this._currentLine].trim().split(/\s+/);

		const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
		const maxLevels = typeof args.levels === 'number' ? args.levels : words.length-startFrame;
		const endFrame = Math.min(startFrame + maxLevels, words.length);

		const frames = new Array<StackFrame>();
		// every word of the current line becomes a stack frame.
		for (let i= startFrame; i < endFrame; i++) {
			const name = words[i];	// use a word of the line as the stackframe name
			frames.push(new StackFrame(i, `${name}(${i})`, new Source(basename(this._sourceFile),
				this.convertDebuggerPathToClient(this._sourceFile)),
				this.convertDebuggerLineToClient(this._currentLine), 0));
		}
		response.body = {
			stackFrames: frames,
			totalFrames: words.length
		};
		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {

		const frameReference = args.frameId;
		const scopes = new Array<Scope>();
		scopes.push(new Scope("Local", this._variableHandles.create("local_" + frameReference), false));
		scopes.push(new Scope("Closure", this._variableHandles.create("closure_" + frameReference), false));
		scopes.push(new Scope("Global", this._variableHandles.create("global_" + frameReference), true));

		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {

		const variables = [];
		const id = this._variableHandles.get(args.variablesReference);
		if (id != null) {
			variables.push({
				name: id + "_i",
				type: "integer",
				value: "123",
				variablesReference: 0
			});
			variables.push({
				name: id + "_f",
				type: "float",
				value: "3.14",
				variablesReference: 0
			});
			variables.push({
				name: id + "_s",
				type: "string",
				value: "hello world",
				variablesReference: 0
			});
			variables.push({
				name: id + "_o",
				type: "object",
				value: "Object",
				variablesReference: this._variableHandles.create("object_")
			});
		}

		response.body = {
			variables: variables
		};
		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {

		for (var ln = this._currentLine+1; ln < this._sourceLines.length; ln++) {
			if (this.fireEventsForLine(response, ln)) {
				return;
			}
		}
		this.sendResponse(response);
		// no more lines: run to end
		this.sendEvent(new TerminatedEvent());
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {

		for (let ln = this._currentLine+1; ln < this._sourceLines.length; ln++) {
			if (this.fireStepEvent(response, ln)) {
				return;
			}
		}
		this.sendResponse(response);
		// no more lines: run to end
		this.sendEvent(new TerminatedEvent());
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {

		response.body = {
			result: `evaluate(context: '${args.context}', '${args.expression}')`,
			variablesReference: 0
		};
		this.sendResponse(response);
	}

	//---- some helpers

	/**
	 * Fire StoppedEvent if line is not empty.
	 */
	private fireStepEvent(response: DebugProtocol.Response, ln: number): boolean {

		if (this._sourceLines[ln].trim().length > 0) {	// non-empty line
			this._currentLine = ln;
			this.sendResponse(response);
			this.sendEvent(new StoppedEvent("step", MockDebugSession.THREAD_ID));
			return true;
		}
		return false;
	}

	/**
	 * Fire StoppedEvent if line has a breakpoint or the word 'exception' is found.
	 */
	private fireEventsForLine(response: DebugProtocol.Response, ln: number): boolean {

		// find the breakpoints for the current source file
		const breakpoints = this._breakPoints.get(this._sourceFile);
		if (breakpoints) {
			const bps = breakpoints.filter(bp => bp.line === this.convertDebuggerLineToClient(ln));
			if (bps.length > 0) {
				this._currentLine = ln;

				// 'continue' request finished
				this.sendResponse(response);

				// send 'stopped' event
				this.sendEvent(new StoppedEvent("breakpoint", MockDebugSession.THREAD_ID));

				// the following shows the use of 'breakpoint' events to update properties of a breakpoint in the UI
				// if breakpoint is not yet verified, verify it now and send a 'breakpoint' update event
				if (!bps[0].verified) {
					bps[0].verified = true;
					this.sendEvent(new BreakpointEvent("update", bps[0]));
				}
				return true;
			}
		}

		// if word 'exception' found in source -> throw exception
		if (this._sourceLines[ln].indexOf("exception") >= 0) {
			this._currentLine = ln;
			this.sendResponse(response);
			this.sendEvent(new StoppedEvent("exception", MockDebugSession.THREAD_ID));
			this.sendEvent(new OutputEvent(`exception in line: ${ln}\n`, 'stderr'));
			return true;
		}

		return false;
	}
}

DebugSession.run(MockDebugSession);
