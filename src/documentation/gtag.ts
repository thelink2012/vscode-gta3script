'use strict';
import {GTA3DocumentationProvider, docrequest, CommandDoc, GameDoc, ArgumentDoc} from './interface';
import {GTA3ScriptController, Command} from '../controller';
const cheerio = require('cheerio')

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

        let opcode = ("0000" + (command.id).toString(16)).slice(-4).toUpperCase();
        let uri = `http://gtag.gtagaming.com/opcode-database/opcode/${opcode}/`;
        return docrequest(uri).then(body => {
            let result = { 
                uri: uri, 
                games: new Array<GameDoc>(),
                shortDescription: null,
                longDescription: null,
                args: new Array<ArgumentDoc>(),
                examples: [],
            };

            let $ = cheerio.load(body);
            $(".opcodeinfo > tbody > tr > td").each((i, elem) => {
                if(i == 0) { // Description
                    let description = $(elem).html().replace(/<br>(?:<\/?br>)?/g, "\n");
                    if(description) {
                        result.shortDescription = description.split(/\.|\n/)[0]
                        result.longDescription = description
                    }
                } else if(i == 1) { // Parameters
                    let params = $(elem).html().split(/<br>(?:<\/?br>)?/g)
                    result.args = params.map(p => {
                        let m = p.match(/^\d+\)\s*(?:\(Returned\))?\s*([^\(]*)/);
                        return { type: null, description: (m && m[0]) || null };
                    });
                } else if(i == 2) { // Games 
                    result.games = $(elem).children("img").map((_, img) => {
                        let src = $(img).attr('src');
                        if(src.endsWith("/sa.gif")) return GameDoc.SanAndreas;
                        if(src.endsWith("/vc.gif")) return GameDoc.Miami;
                        if(src.endsWith("/iii.gif")) return GameDoc.Liberty;
                        return null;
                    }).filter(x => x != null);
                }
            });

            return result;
        });
    }
}
