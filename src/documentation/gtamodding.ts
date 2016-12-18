'use strict';
import {GTA3DocumentationProvider, docrequest, CommandDoc, GameDoc, ArgumentDoc} from './interface';
import {GTA3ScriptController, Command} from '../controller';
const cheerio = require('cheerio')

export class GTAModdingDocumentationProvider implements GTA3DocumentationProvider {

    public getProviderName(): string {
        return "GTAModding";
    }

    public provideDocumentation(context: GTA3ScriptController,
                                command: Command): Promise<CommandDoc>
    {
        if(command.id == null) {
            return Promise.resolve(null);
        }

        let opcode = ("0000" + (command.id).toString(16)).slice(-4).toUpperCase();
        let query = `http://www.gtamodding.com/api.php?action=query&titles=${opcode}&prop=revisions&format=json&rvprop=content&rvexpandtemplates&rvsection=0`;
        return docrequest(query).then(body => {
            let result = { 
                uri: `http://www.gtamodding.com/wiki/${opcode}`, 
                games: new Array<GameDoc>(),
                shortDescription: null,
                longDescription: null,
                args: new Array<ArgumentDoc>(),
                examples: [],
            };

            let queryResult = JSON.parse(body);
            let queryPages  = queryResult.query.pages;
            let pageContent = null;

            // pick first entry in queryPages into pageContent
            for(let pageid in queryPages) {
                let page = queryPages[pageid];
                if(page.hasOwnProperty("missing")) {
                    return Promise.resolve(null);
                }
                pageContent = page.revisions[0]["*"];
                break;
            }

            let $ = cheerio.load(pageContent);

            let gameIcons = $("span.icon-align").html();
            if(gameIcons.indexOf("File:Sa.png") != -1) result.games.push(GameDoc.SanAndreas);
            if(gameIcons.indexOf("File:Vc.png") != -1) result.games.push(GameDoc.Miami);
            if(gameIcons.indexOf("File:Gta3.png") != -1) result.games.push(GameDoc.Liberty);

            let i = -1;
            let dtTable = { "Description": 1, "Parameter": 3 }
            $("dl.opcode").children().each((_, elem) => {
                if(elem.name == "dt") {
                    i = dtTable[$(elem).html()] || -1;
                } else if(elem.name == "dd") {
                    if(i == 1) { // Description
                        result.shortDescription = this.toPlainText($(elem).text());
                    } else if(i == 3) { // Parameter
                        $(elem.firstChild).children().each((pid, pelem) => {
                            // Assumes even nodes are <dt> and odd are <dd>
                            if((pid % 2) != 0) { // <dd>
                                result.args.push({
                                    type: null,
                                    description: this.toPlainText($(pelem).text()),
                                });
                            }
                        });
                    }
                }
            });
            
            let pageText = $.root().contents().last().text();
            let signString = "[[Category:OpCodes]]\n\n";
            let thisOpString = "This opcode ";
            if(pageText && pageText.startsWith(signString)) {
                let longDescription = pageText.substr(signString.length);
                // Check if long description is not a table or something weird else not texty.
                if(longDescription[0].toUpperCase() >= 'A' && longDescription[0].toUpperCase() <= 'Z') {
                    // Remove "^This opcode x" portion of the string and capitalize it.
                    if(longDescription.startsWith(thisOpString) && longDescription.length > thisOpString.length+2) {
                        longDescription = longDescription[thisOpString.length].toUpperCase() +
                                            longDescription.slice(thisOpString.length+1);
                    }
                    // Additional fix ups.
                    longDescription = this.replaceOpcodesByCommands(longDescription, context);
                    result.longDescription = this.toMarkdown(longDescription);
                }
            }
            
            if(!result.longDescription) {
                result.longDescription = result.shortDescription;
            }

            if(!result.shortDescription) {
                return Promise.resolve(null);
            }

            return result;
        });
    }

    /// Parses a MediaWiki paragraph into Markdown.
    private toMarkdown(text: string): string {
        return text.replace(/\[\[([\w\(\) ]+)\|([^\]]+)\]\]/g, "[$2](http://www.gtamodding.com/wiki/$1)")
                   .replace(/\[\[([^\]]+)\]\]/g, "[$1](http://www.gtamodding.com/wiki/$1)")
                   .replace(/'''([^']+)'''/g, "**$1**")
                   .replace(/''([^']+)''/g, " _$1_");
    }

    /// Parses a MediaWiki paragraph into plaintext.
    private toPlainText(text: string): string {
        return text.replace(/\[\[([\w\(\) ]+)(?:#[\w ]+)?\|([^\]]+)\]\]/g, "$2")
                   .replace(/\[\[([^\]]+)\]\]/g, "$1")
                   .replace(/'/g, "");
    }

    /// Replaces, in a MediaWiki paragraph, links to opcodes into links to commands.
    /// Additionally, replaces "opcode" by "command" in the text.
    private replaceOpcodesByCommands(text: string, gta3ctx: GTA3ScriptController): string {

        let result = "";
        let lastIndex = 0;

        let regex = /\[\[([0-9A-Fa-f]{4})\]\]/g;
        let match = regex.exec(text);

        while (match != null) {
            result += text.slice(lastIndex, match.index).replace(/\bopcode\b/g, "command");
            lastIndex = match.index + 4 + 2 + 2;

            let opid = parseInt(match[1], 16);
            let command = gta3ctx.getCommandById(opid);
            if(command != null) {
                result += `'''[[${match[1]}|${command.name}]]'''`;
            } else { // keep opcode
                result += `[[${match[1]}]]`;
            }

            match = regex.exec(text);
        }

        if(lastIndex > 0)
            return result + text.slice(lastIndex).replace(/\bopcode\b/g, "command");
        return text.replace(/\bopcode\b/g, "command");
    }
}

// TODO compare the cost of requesting the full page and performing our parsing,
// versus doing as we it is currently, quering only the first part with MediaWiki,
//    parsing the JSON, then performing our parsing.
