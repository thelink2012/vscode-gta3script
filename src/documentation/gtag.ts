'use strict';
import {GTA3DocumentationProvider, docrequest, CommandDoc, GameDoc, ArgumentDoc} from './interface';
import {GTA3ScriptController, Command} from '../controller';
const json = require('jsonify');
const toMarkdown = require('to-markdown');

export class GTAGDocumentationProvider implements GTA3DocumentationProvider {
    public getProviderName(): string {
        return "GTAG Opcode Database";
    }

    public provideDocumentation(context: GTA3ScriptController,
                                command: Command): Promise<CommandDoc>
    {
        if(command.id == null) {
            return Promise.resolve(null);
        }

        let configName = context.getConfigName();
        let opcode = ("0000" + (command.id).toString(16)).slice(-4).toUpperCase();
        let uri = `http://gtag.gtagaming.com/api/opcodedb/v1/opcodes?id=${opcode}`;
        return docrequest(uri).then(body => {
            let result = { 
                uri: uri, 
                games: new Array<GameDoc>(),
                shortDescription: null,
                longDescription: null,
                args: new Array<ArgumentDoc>(),
                examples: [],
            };

            let info = json.parse(body);
            if (!info.hasOwnProperty("status") || info.status != "200")
                Promise.reject("GTAG OpcodeDB API request failed (status: "+info.status+")");
            if (!info.length) Promise.reject("GTAG OpcodeDB API request: opcode not found");

            for (var id in info.data) {
                let doc = info.data[id];
                // replace [opcode]0FFF[/opcode] with the command names
                let description = doc.description.replace(/\[opcode\]([0-9A-F]{4})\[\/opcode\]/gi, (_, match) => {
                    let cmd = context.getCommandById(parseInt(match, 16));
                    if (typeof(cmd) !== 'undefined')
                        return cmd.name;
                    return match;
                });
                result.longDescription = this.htmlToMarkdown(description);
                result.shortDescription = description.split('\n')[0];
                if (doc.supports.gtasa) result.games.push(GameDoc.SanAndreas);
                if (doc.supports.gtavc) result.games.push(GameDoc.Miami);
                if (doc.supports.gta3) result.games.push(GameDoc.Liberty);
                result.args = doc.params.map(p => {
                    return { type: p.type, description: p.description };
                });
                result.uri = doc.url;
            }
            return result;
        });
    }

    private htmlToMarkdown(html: string): string {
        return toMarkdown(html.replace(/<div[^>]*>([^<]*)<\/div>/g, "$1")
                              .replace(/<span[^>]*>([^<]*)<\/span>/g, "$1")
                              .split('\n').join('<br><br>'));
    }
}
