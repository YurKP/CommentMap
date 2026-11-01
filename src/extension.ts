import * as vscode from 'vscode';

type TagSetting = {
    name: string;
    color: string;
};

type CommentItem = {
    line: number;
    text: string;
    tag: string;
};

const SETTINGS_KEY = 'commentmap.settings';

const defaultTags: TagSetting[] = [
    { name: 'TODO', color: '#4da3ff' },
    { name: 'FIXME', color: '#ff6b6b' },
    { name: 'NOTE', color: '#ffd166' }
];

export function activate(context: vscode.ExtensionContext) {
    const openCommand = vscode.commands.registerCommand('commentmap.open', () => {
        openCommentMap(context);
    });

    const createDocumentCommand = vscode.commands.registerCommand(
        'commentmap.createDocument',
        () => {
            vscode.window.showInformationMessage('пока ничего нет');
        }
    );

    context.subscriptions.push(openCommand, createDocumentCommand);
}

export function deactivate() {}

function getTags(context: vscode.ExtensionContext): TagSetting[] {
    return context.globalState.get<TagSetting[]>(SETTINGS_KEY, defaultTags);
}

async function saveTags(context: vscode.ExtensionContext, tags: TagSetting[]) {
    await context.globalState.update(SETTINGS_KEY, tags);
}

function collectComments(text: string, tags: TagSetting[]): CommentItem[] {
    const result: CommentItem[] = [];
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const commentText = getCommentPart(lines[i]);

        if (!commentText) {
            continue;
        }

        let foundTag = 'COMMENT';

        for (const tag of tags) {
            const tagRegex = new RegExp('\\b' + escapeRegExp(tag.name) + '\\b', 'i');

            if (tagRegex.test(commentText)) {
                foundTag = tag.name.toUpperCase();
                break;
            }
        }

        result.push({
            line: i + 1,
            text: commentText.trim(),
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

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

async function openCommentMap(context: vscode.ExtensionContext) {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
        vscode.window.showWarningMessage('CommentMap: откройте файл в редакторе.');
        return;
    }

    const tags = getTags(context);
    const comments = collectComments(editor.document.getText(), tags);

    const panel = vscode.window.createWebviewPanel(
        'commentmap',
        'CommentMap',
        vscode.ViewColumn.Beside,
        { enableScripts: true }
    );

    panel.webview.html = createWebviewHtml(editor.document.fileName, comments, tags);

    panel.webview.onDidReceiveMessage(async message => {
        if (message.command === 'saveTags') {
            const newTags = cleanTags(message.tags);
            await saveTags(context, newTags);

            const currentEditor = vscode.window.activeTextEditor;

            if (currentEditor) {
                const newComments = collectComments(currentEditor.document.getText(), newTags);
                panel.webview.html = createWebviewHtml(
                    currentEditor.document.fileName,
                    newComments,
                    newTags
                );
            }
        }
    });
}

function cleanTags(value: unknown): TagSetting[] {
    if (!Array.isArray(value)) {
        return defaultTags;
    }

    const tags: TagSetting[] = [];

    for (const item of value) {
        if (!item || typeof item.name !== 'string') {
            continue;
        }

        const name = item.name.trim().toUpperCase();
        const color = typeof item.color === 'string' ? item.color : '#888888';

        if (name.length > 0) {
            tags.push({ name, color });
        }
    }

    return tags.length > 0 ? tags : defaultTags;
}

function createWebviewHtml(
    fileName: string,
    comments: CommentItem[],
    tags: TagSetting[]
): string {
    const groups = groupComments(comments);
    const tagColors: Record<string, string> = {};

    for (const tag of tags) {
        tagColors[tag.name.toUpperCase()] = tag.color;
    }

    tagColors['COMMENT'] = '#9aa0a6';

    let commentsHtml = '';

    for (const groupName of Object.keys(groups)) {
        const color = tagColors[groupName] || '#9aa0a6';
        commentsHtml += `<h3><span style="color:${escapeHtml(color)}">●</span> ${escapeHtml(groupName)} (${groups[groupName].length})</h3>`;

        for (const item of groups[groupName]) {
            commentsHtml += `<p>Строка ${item.line}: ${escapeHtml(item.text)}</p>`;
        }
    }

    if (commentsHtml.length === 0) {
        commentsHtml = '<p>Комментарии не найдены.</p>';
    }

    let tagsHtml = '';

    for (const tag of tags) {
        tagsHtml += `
            <div class="tag-row">
                <input class="tag-name" value="${escapeHtml(tag.name)}" />
                <input class="tag-color" type="color" value="${escapeHtml(tag.color)}" />
                <button class="remove-tag">Удалить</button>
            </div>`;
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
        .tag-row { display: flex; gap: 8px; margin-bottom: 8px; }
        button { margin-right: 8px; }
    </style>
</head>
<body>
    <h1>CommentMap</h1>
    <p>${escapeHtml(fileName)}</p>

    <h2>Комментарии (${comments.length})</h2>
    ${commentsHtml}

    <h2>Настройки тегов</h2>
    <div id="tags">${tagsHtml}</div>
    <button id="addTag">Добавить тег</button>
    <button id="saveTags">Сохранить теги</button>

    <script>
        const vscode = acquireVsCodeApi();

        document.getElementById('addTag').addEventListener('click', function () {
            const row = document.createElement('div');
            row.className = 'tag-row';
            row.innerHTML = '<input class="tag-name" value="NEW_TAG" />' +
                '<input class="tag-color" type="color" value="#888888" />' +
                '<button class="remove-tag">Удалить</button>';
            document.getElementById('tags').appendChild(row);
            connectRemoveButtons();
        });

        document.getElementById('saveTags').addEventListener('click', function () {
            const rows = document.querySelectorAll('.tag-row');
            const tags = [];

            rows.forEach(function (row) {
                const name = row.querySelector('.tag-name').value;
                const color = row.querySelector('.tag-color').value;
                tags.push({ name: name, color: color });
            });

            vscode.postMessage({ command: 'saveTags', tags: tags });
        });

        function connectRemoveButtons() {
            const buttons = document.querySelectorAll('.remove-tag');

            buttons.forEach(function (button) {
                button.onclick = function () {
                    button.parentElement.remove();
                };
            });
        }

        connectRemoveButtons();
    </script>
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
