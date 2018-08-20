'use strict';
import {GTA3ScriptController, Command} from '../controller';
var http = require('follow-redirects').http;
var https = require('follow-redirects').https;

export enum GameDoc {
    Liberty,
    Miami,
    SanAndreas,
}

export interface ArgumentDoc {
    type: string | null,
    description: string | null,     //< Description in plaintext.
}

export interface CommandDoc {
    uri: string | null,
    games: GameDoc[],
    shortDescription: string | null,    //< Short description in plaintext.
    longDescription: string | null,     //< Long description in Markdown.
    args: ArgumentDoc[],
}

export interface GTA3DocumentationProvider {
    /// Gets the name of the documentation provider.
    getProviderName(): string;

    /// Provides documentation for the specified command.
    ///
    /// In case there's no documentation for the specified command in the provider, returns Promise.resolve(null).
    provideDocumentation(context: GTA3ScriptController, command: Command): Promise<CommandDoc>;
}

export function docrequest(uri: string): Promise<string> {
    // TODO provide timeout
    return new Promise((resolve, reject) => {
        let http_get = uri.startsWith("https:")? https.get : http.get;
        http_get(uri, (res) => {
            const statusCode = res.statusCode;
            const contentType = res.headers['content-type'];

            if(statusCode === 404) {
                res.resume(); // consume response data to free up memory
                return resolve(null);
            } else if(statusCode !== 200) {
                res.resume(); // consume response data to free up memory
                return reject(`Request Failed.\nStatus Code: ${statusCode}`);
            }

            res.setEncoding('utf8');
            let rawData = '';
            res.on('data', (chunk) => rawData += chunk);
            res.on('end', () => resolve(rawData));
        }).on('error', (e) => {
            reject(`Got error: ${e.message}`);
        });
    })
}
