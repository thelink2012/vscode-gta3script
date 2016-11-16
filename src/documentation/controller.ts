'use strict';
import {GTA3DocumentationProvider, CommandDoc} from './interface'
import {GTA3ScriptController, Command} from '../controller'

interface CachedCommandDoc {
    version: number,        //< The version of vscode-gta3script on which this command was fetched.
    timestamp: number,      //< The last time this command was fetched from the database (UNIX Timestamp).
    provider: string,       //< The name of the provider of this documentation.
    doc: CommandDoc | null; //< The documentation or null if the provider doesn't contain this command.
}

interface CachedDocDatabase {
    // may be null if provider does not contain the command 
    // (i.e. previous web request returned a 404).
    [command: string]: CachedCommandDoc | null;
}

interface CachedDocDictionary {
    [provider: string]: CachedDocDatabase;
}


export class GTA3DocumentationController {

    private docs: GTA3DocumentationProvider[];
    private cachedDocs: CachedDocDictionary;

    constructor(providers: GTA3DocumentationProvider[]) {
        this.docs = providers;
        this.cachedDocs = {};
        for(let provider of this.docs) {
            this.cachedDocs[provider.getProviderName()] = {}
        }
    }

    public loadCache() {
        // TODO
    }

    public saveCache() {
        // TODO
    }

    /// Gets documentation for the specified command.
    public queryDocumentation(context: GTA3ScriptController, command: Command): Promise<CommandDoc> {

        let cachedDoc = this.queryCachedDocumentation(command);
        if(cachedDoc) {
            console.log(`queryDocumentation got cached command ${command.name}`);
            return Promise.resolve(cachedDoc);
        } else if(cachedDoc === null) {
            console.log(`queryDocumentation got cached command ${command.name} which doesn't exist anywhere`);
            return Promise.reject("Command not documented.");
        }

        return this.queryWebDocumentation(context, command).then(tuple => {
            let [provider, doc] = tuple;
            console.log(`queryDocumentation got command ${command.name} from web provider ${provider.getProviderName()}`);
            return doc;
        });
    }

    /// Gets documentation for the specified command in the memory/filesystem cache.
    ///
    /// Returns `null` for "tried all web providers, but they don't have documentation for this",
    /// and `undefined` when there's no trace of documentation for this command on cache (i.e. go try the web).
    public queryCachedDocumentation(command: Command): CommandDoc | null | undefined {

        let neverTriedToFetchCount = 0;
        let notFoundCount = 0;

        let performQuery = (i) => {
            if(i < this.docs.length) {
                let providerName = this.docs[i].getProviderName();
                let providerDb = this.cachedDocs[providerName];
                if(providerDb) {
                    let providerDoc = providerDb[command.name];
                    if(providerDoc && providerDoc.doc) {
                        return providerDoc.doc;
                    } else if(providerDoc === undefined) { // never tried to fetch from web
                        ++neverTriedToFetchCount;
                    } else if(providerDoc.doc === null) { // tried to fetch the web and got 404
                        ++notFoundCount;
                    }
                }
                return performQuery(i+1);
            }

            // All of the doc'kers were fetched before, but this command
            // does not exist in any of their databases.
            if(notFoundCount == this.docs.length)
                return null;

            // The cache doesn't contain this command.
            return undefined;
        };
        return performQuery(0);
    }

    /// Gets documentation for the specified command using the web.
    public queryWebDocumentation(context: GTA3ScriptController,
                                  command: Command): Promise<[GTA3DocumentationProvider, CommandDoc]> 
    {
        let failedCount = 0;
        let performQuery = (i) => {
            if(i < this.docs.length) {
                let provider = this.docs[i];
                return provider.provideDocumentation(context, command).catch(e => {
                    this.cacheCommandProviderError(provider, command, e);
                    return performQuery(i+1);
                }).then(doc => {
                    if(doc == null) {
                        this.cacheCommandDoesNotExist(provider, command);
                        return performQuery(i+1);
                    }
                    this.cacheCommandDoc(provider, command, doc);
                    return [provider, doc];
                });
            }
            // Either undocumented or unavailable.
            return Promise.reject("Command not available in any web provider.");
        };
        return performQuery(0);
    }

    private cacheCommandProviderError(provider: GTA3DocumentationProvider,
                                      command: Command, error: any)
    {
        // Do nothing, the cache doesn't need to know about this.
        console.log(`cacheCommandProviderError: ${provider.getProviderName()}: ${error}`);
    }

    private cacheCommandDoesNotExist(provider: GTA3DocumentationProvider,
                                     command: Command)
    {
        this.cacheCommandDoc(provider, command, null);
    }

    private cacheCommandDoc(provider: GTA3DocumentationProvider,
                            command: Command, doc: CommandDoc)
    {
        let providerName = provider.getProviderName();

        if(doc != null)
            console.log(`Caching command ${command.name} from ${providerName}`);
        else
            console.log(`Caching that command ${command.name} does not exist in ${providerName}`);

        this.cachedDocs[providerName][command.name] = {
                version: 1,
                timestamp: Math.floor((new Date).getTime() / 1000),
                provider: providerName,
                doc: doc,
        };
    }
}
