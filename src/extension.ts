import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('CommentMap activated');

    const openCommand = vscode.commands.registerCommand(
        'commentmap.open',
        () => {
            vscode.window.showInformationMessage(
                'CommentMap: Open works!'
            );
        }
    );

    const createDocumentCommand = vscode.commands.registerCommand(
        'commentmap.createDocument',
        () => {
            vscode.window.showInformationMessage(
                'CommentMap: Create Comment Document works!'
            );
        }
    );

    context.subscriptions.push(
        openCommand,
        createDocumentCommand
    );
}

export function deactivate() {
    console.log('CommentMap deactivated');
}