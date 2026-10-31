import * as vscode from 'vscode';

type CommentItem = {
    line: number;
    text: string;
    tag: string;
};

const defaultTags = ['TODO', 'FIXME', 'NOTE'];

export function activate(context: vscode.ExtensionContext) {
    const openCommand = vscode.commands.registerCommand('commentmap.open', () => {
        openCommentMap();
    });

    const createDocumentCommand = vscode.commands.registerCommand(
        'commentmap.createDocument',
        () => {
            vscode.window.showInformationMessage('Экспорт появится в следующей версии.');
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

function groupComments(comments: CommentItem[]) {
    const groups: Record<string, CommentItem[]> = {};

    for (const comment of comments) {
        if (!groups[comment.tag]) {
            groups[comment.tag] = [];
        }

        groups[comment.tag].push(comment);
    }

    return groups;
}

function openCommentMap() {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
        vscode.window.showWarningMessage('CommentMap: откройте файл в редакторе.');
        return;
    }

    const comments = collectComments(editor.document.getText());
    const panel = vscode.window.createWebviewPanel(
        'commentmap',
        'CommentMap',
        vscode.ViewColumn.Beside,
        { enableScripts: false }
    );

    panel.webview.html = createWebviewHtml(editor.document.fileName, comments);
}

function createWebviewHtml(fileName: string, comments: CommentItem[]): string {
    const groups = groupComments(comments);
    let commentsHtml = '';

    for (const groupName of Object.keys(groups)) {
        commentsHtml += `<h2>${escapeHtml(groupName)} (${groups[groupName].length})</h2>`;

        for (const item of groups[groupName]) {
            commentsHtml += `<p>Строка ${item.line}: ${escapeHtml(item.text)}</p>`;
        }
    }

    if (commentsHtml.length === 0) {
        commentsHtml = '<p>Комментарии не найдены.</p>';
    }

    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>CommentMap</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 18px;
        }
    </style>
</head>
<body>
    <h1>CommentMap</h1>
    <p>${escapeHtml(fileName)}</p>
    <h2>Комментарии (${comments.length})</h2>
    ${commentsHtml}
</body>
</html>`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
