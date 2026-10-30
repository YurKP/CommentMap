import * as vscode from 'vscode';

type CommentItem = {
    line: number;
    text: string;
    tag: string;
};

const defaultTags = ['TODO', 'FIXME', 'NOTE'];

export function activate(context: vscode.ExtensionContext) {
    const openCommand = vscode.commands.registerCommand('commentmap.open', () => {
        showComments();
    });

    const createDocumentCommand = vscode.commands.registerCommand(
        'commentmap.createDocument',
        () => {
            showComments();
        }
    );

    context.subscriptions.push(openCommand, createDocumentCommand);
}

export function deactivate() {}

function collectComments(text: string): CommentItem[] {
    const result: CommentItem[] = [];
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const commentText = getCommentPart(lines[i]);

        if (!commentText) {
            continue;
        }

        let foundTag = 'COMMENT';

        for (const tag of defaultTags) {
            if (commentText.toUpperCase().includes(tag)) {
                foundTag = tag;
                break;
            }
        }

        result.push({
            line: i + 1,
            text: commentText,
            tag: foundTag
        });
    }

    return result;
}

function getCommentPart(line: string): string | null {
    const markers = ['//', '#', '--'];

    for (const marker of markers) {
        const index = line.indexOf(marker);

        if (index >= 0) {
            return line.substring(index + marker.length).trim();
        }
    }

    return null;
}

async function showComments() {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
        vscode.window.showWarningMessage('CommentMap: откройте файл в редакторе.');
        return;
    }

    const comments = collectComments(editor.document.getText());
    let output = '# CommentMap\n\n';

    for (const comment of comments) {
        output += `- [${comment.tag}] Строка ${comment.line}: ${comment.text}\n`;
    }

    if (comments.length === 0) {
        output += 'Комментарии не найдены.\n';
    }

    const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: output
    });

    await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
}
