# GTA3script for Visual Studio Code

This is an extension for VSCode which adds support for GTA3script:
 
 + Syntax highlighting.
 + Auto-completion.
 + Documentation for commands and its arguments.

## Features

![Features in 15 Seconds](http://i.imgur.com/4pAZhGC.gif)

## Using

### Installing & Configuring

First, you will need to install [Visual Studio Code](https://code.visualstudio.com/). Then, in the command pallete (`ctrl-shift-p`) select `Install Extension` and choose `GTA3script`.

Then, you need to configure the extension with the path to a compiler and path to the game executable (optional). Go to `File > Preferences > User Settings` and paste the following within the curly brackets:

```json
    "gta3script.compiler": "<PATH_TO_COMPILER_EXECUTABLE>",
    "gta3script.gamebin": {
        "gta3": [],
        "gtavc": [],
        "gtasa": ["<PATH_TO_YOUR_GAME_EXECUTABLE>"]
    }
```

And replace the settings apropriately. The final result should [look like this](http://i.imgur.com/6Sdfx2q.png).

### Coding

Open any `.sc` script file using Visual Studio Code and start coding! When in doubt of what to type, try pressing `ctrl-space` for auto-completion.

 + Press `f6` or execute `GTA3script: Build` to compile this script.
 + Press `f7` or execute `GTA3script: Build and Run` to compile and run the game in case of success.
 + Press `ctrl-f7` or execute `GTA3script: Run` to run the game.

If, instead of opening a `.sc` file, you open a workspace (`File > Open Folder`), all the `*.sc` files in the root of the workspace folder are going to be compiled instead of the one currently open in the editor.

Additionally, do notice the status bars at the lower right corner while a `.sc` file is open:

![Status Bar](http://i.imgur.com/nYSdJuo.png)

 + Click on the game status (`GTASA` in the image above) to select the target game to compile and run.
 + Click on the type flag (`CS` in the image above) to select compilation options, including whether to compile a custom script, custom mission or a multifile script.

The commands `GTA3script: Select Game` and `GTA3script: Build Flags` are the analogues of this status bar.

Selecting a game is always set as a user setting (i.e. not a workspace setting). Build flags, however, are set as workspace settings if there's a workspace open, otherwise as a user setting.

### Extension Settings

Although, most of the settings can be set within commands embeded in VSCode by this extension, advanced users may desire to have more control over their settings. The following Visual Studio Code settings are available. These can be set in user preferences (`ctrl+,`) or workspace settings (`.vscode/settings.json`).

```json
                "gta3script.compiler": null,
                "gta3script.configpath": null,
                "gta3script.buildflags": {
                    "gta3": ["--cs"],
                    "gtavc": ["--cs"],
                    "gtasa": ["--guesser", "--cs"]
                },
                "gta3script.gamebin": {
                    "gta3": [null],
                    "gtavc": [null],
                    "gtasa": [null]
                }
                "gta3script.docprovider": ["GTAModding", "GTAG Opcode Database"],
                "gta3script.config": "gtasa"
```

Do note tweaking the `gta3script.buildflags` is currently prone to break the `GTA3script: Build Flags` command. For instance, this command uses `-fno-entity-tracking` as a base, if you set `-fentity-tracking` on your settings, the command won't recognize that. There is no problem, however, in setting other arbitrary flags (like `-farrays`).

## Building and Debugging the Extension

VSCode provides a easy and [well documented](https://code.visualstudio.com/Docs/extensionAPI/overview) extension API. You can set up a development environment for debugging the extension during extension development.

First make sure you do not have the extension installed in `~/.vscode/extensions`. Then clone the repo somewhere else on your machine, run `npm install` and open a development instance of Code.

```bash
rm -rf ~/.vscode/extensions/thelink2012.gta3script
cd ~
git clone https://github.com/thelink2012/vscode-gta3script
cd vscode-gta3script
npm install
code . 
```

You can now go to the Debug viewlet and select Launch Extension then hit run (F5). You can now hit breakpoints and step through the extension.
