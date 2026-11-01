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

type Statistics = {
    scans: number;
    totalComments: number;
    byTag: Record<string, number>;
};

const SETTINGS_KEY = 'commentmap.settings';
const STATS_KEY = 'commentmap.statistics';

const defaultTags: TagSetting[] = [
    { name: 'TODO', color: '#4da3ff' },
    { name: 'FIXME', color: '#ff6b6b' },
    { name: 'NOTE', color: '#ffd166' }
];

export function activate(context: vscode.ExtensionContext) {
    const openCommand = vscode.commands.registerCommand('commentmap.open', () => {
        openCommentMap(context);
    });

    const createDocumentCommand = vscode.commands.registerCommand('commentmap.createDocument', () => {
        createCommentDocument(context);
    });

    context.subscriptions.push(openCommand, createDocumentCommand);
}

export function deactivate() {}

function getTags(context: vscode.ExtensionContext): TagSetting[] {
    return context.globalState.get<TagSetting[]>(SETTINGS_KEY, defaultTags);
}

async function saveTags(context: vscode.ExtensionContext, tags: TagSetting[]) {
    await context.globalState.update(SETTINGS_KEY, tags);
}

function getStatistics(context: vscode.ExtensionContext): Statistics {
    return context.globalState.get<Statistics>(STATS_KEY, {
        scans: 0,
        totalComments: 0,
        byTag: {}
    });
}

async function saveStatistics(context: vscode.ExtensionContext, statistics: Statistics) {
    await context.globalState.update(STATS_KEY, statistics);
}

function collectComments(text: string, tags: TagSetting[]): CommentItem[] {
    const result: CommentItem[] = [];
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const commentText = getCommentPart(line);

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

    const blockStart = line.indexOf('/*');
    if (blockStart >= 0) {
        let text = line.substring(blockStart + 2);
        const blockEnd = text.indexOf('*/');
        if (blockEnd >= 0) {
            text = text.substring(0, blockEnd);
        }
        return text.trim();
    }

    const htmlStart = line.indexOf('<!--');
    if (htmlStart >= 0) {
        let text = line.substring(htmlStart + 4);
        const htmlEnd = text.indexOf('-->');
        if (htmlEnd >= 0) {
            text = text.substring(0, htmlEnd);
        }
        return text.trim();
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

async function updateStatistics(context: vscode.ExtensionContext, comments: CommentItem[]) {
    const statistics = getStatistics(context);
    statistics.scans += 1;
    statistics.totalComments += comments.length;

    for (const comment of comments) {
        if (!statistics.byTag[comment.tag]) {
            statistics.byTag[comment.tag] = 0;
        }
        statistics.byTag[comment.tag] += 1;
    }

    await saveStatistics(context, statistics);
}

async function getActiveComments(context: vscode.ExtensionContext) {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
        vscode.window.showWarningMessage('CommentMap: откройте файл в редакторе.');
        return null;
    }

    const tags = getTags(context);
    const text = editor.document.getText();
    const comments = collectComments(text, tags);

    await updateStatistics(context, comments);

    return {
        fileName: editor.document.fileName,
        tags,
        comments
    };
}

async function createCommentDocument(context: vscode.ExtensionContext) {
    const data = await getActiveComments(context);
    if (!data) {
        return;
    }

    const groups = groupComments(data.comments);
    let output = '# CommentMap\n\n';
    output += `Файл: ${data.fileName}\n\n`;
    output += `Всего комментариев: ${data.comments.length}\n\n`;

    const groupNames = Object.keys(groups);

    if (groupNames.length === 0) {
        output += 'Комментарии не найдены.\n';
    }

    for (const groupName of groupNames) {
        output += `## ${groupName}\n\n`;

        for (const item of groups[groupName]) {
            output += `- Строка ${item.line}: ${item.text}\n`;
        }

        output += '\n';
    }

    const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: output
    });

    await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
}

async function openCommentMap(context: vscode.ExtensionContext) {
    const data = await getActiveComments(context);
    if (!data) {
        return;
    }
    const panel = vscode.window.createWebviewPanel(
        'commentmap',
        'CommentMap',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true
        }
    );
    panel.webview.html = createWebviewHtml(
        data.fileName,
        data.comments,
        data.tags,
        getStatistics(context)
    );
    panel.webview.onDidReceiveMessage(async message => {
        if (message.command === 'saveTags') {
            const tags = cleanTags(message.tags);
            await saveTags(context, tags);
            vscode.window.showInformationMessage('CommentMap: теги сохранены.');
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const comments = collectComments(editor.document.getText(), tags);
                panel.webview.html = createWebviewHtml(
                    editor.document.fileName,
                    comments,
                    tags,
                    getStatistics(context)
                );
            }
        }
        if (message.command === 'refresh') {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            const tags = getTags(context);
            const comments = collectComments(editor.document.getText(), tags);
            await updateStatistics(context, comments);
            panel.webview.html = createWebviewHtml(
                editor.document.fileName,
                comments,
                tags,
                getStatistics(context)
            );
        }
        if (message.command === 'resetStatistics') {
            await saveStatistics(context, {
                scans: 0,
                totalComments: 0,
                byTag: {}
            });
            const editor = vscode.window.activeTextEditor;
            const tags = getTags(context);
            const comments = editor ? collectComments(editor.document.getText(), tags) : [];
            panel.webview.html = createWebviewHtml(
                editor ? editor.document.fileName : '',
                comments,
                tags,
                getStatistics(context)
            );
        }
        if (message.command === 'createDocument') {
            await createCommentDocument(context);
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
    tags: TagSetting[],
    statistics: Statistics
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
        commentsHtml += `<section class="group">`;
        commentsHtml += `<h3><span class="dot" style="background:${escapeHtml(color)}"></span>${escapeHtml(groupName)} (${groups[groupName].length})</h3>`;

        for (const item of groups[groupName]) {
            commentsHtml += `
                <div class="comment-item">
                    <span class="line">${item.line}</span>
                    <span>${escapeHtml(item.text)}</span>
                </div>`;
        }

        commentsHtml += `</section>`;
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

    let barsHtml = '';
    const statEntries = Object.entries(statistics.byTag);
    let maxValue = 1;

    for (const [, count] of statEntries) {
        if (count > maxValue) {
            maxValue = count;
        }
    }

    for (const [name, count] of statEntries) {
        const width = Math.round((count / maxValue) * 100);
        const color = tagColors[name] || '#9aa0a6';
        barsHtml += `
            <div class="bar-row">
                <div class="bar-label">${escapeHtml(name)}: ${count}</div>
                <div class="bar-background">
                    <div class="bar-fill" style="width:${width}%; background:${escapeHtml(color)}"></div>
                </div>
            </div>`;
    }

    if (barsHtml.length === 0) {
        barsHtml = '<p>Статистика пока пуста.</p>';
    }

    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CommentMap</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 18px;
        }
        h1, h2, h3 { margin-top: 0; }
        .top-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
        button {
            color: var(--vscode-button-foreground);
            background: var(--vscode-button-background);
            border: 0;
            padding: 7px 12px;
            cursor: pointer;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
        .card {
            border: 1px solid var(--vscode-panel-border);
            padding: 14px;
            margin-bottom: 16px;
            border-radius: 5px;
        }
        .group { margin-bottom: 20px; }
        .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 7px; }
        .comment-item { display: flex; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border); }
        .line { min-width: 42px; opacity: 0.7; }
        .tag-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
        .tag-name {
            flex: 1;
            color: var(--vscode-input-foreground);
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            padding: 6px;
        }
        .tag-color { width: 44px; height: 30px; border: 0; padding: 0; background: transparent; }
        .bar-row { margin-bottom: 12px; }
        .bar-label { margin-bottom: 4px; }
        .bar-background { height: 18px; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); }
        .bar-fill { height: 100%; min-width: 2px; }
        .small { opacity: 0.75; font-size: 12px; }
    </style>
</head>
<body>
    <h1>CommentMap</h1>
    <p class="small">${escapeHtml(fileName)}</p>

    <div class="top-actions">
        <button id="refresh">Обновить</button>
        <button id="createDocument">Создать документ</button>
    </div>

    <div class="card">
        <h2>Комментарии (${comments.length})</h2>
        ${commentsHtml}
    </div>

    <div class="card">
        <h2>Настройки тегов</h2>
        <div id="tags">${tagsHtml}</div>
        <button id="addTag">Добавить тег</button>
        <button id="saveTags">Сохранить теги</button>
    </div>

    <div class="card">
        <h2>Статистика</h2>
        <p>Сканирований: ${statistics.scans}</p>
        <p>Найдено комментариев за все сканирования: ${statistics.totalComments}</p>
        ${barsHtml}
        <button id="resetStatistics">Сбросить статистику</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        document.getElementById('refresh').addEventListener('click', function () {
            vscode.postMessage({ command: 'refresh' });
        });

        document.getElementById('createDocument').addEventListener('click', function () {
            vscode.postMessage({ command: 'createDocument' });
        });

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

        document.getElementById('resetStatistics').addEventListener('click', function () {
            vscode.postMessage({ command: 'resetStatistics' });
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
