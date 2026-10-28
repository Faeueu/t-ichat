// Estado local desta aba do navegador.
let socket = null;
let myUsername = null;
let myRole = null; // 'TI' ou 'COLABORADOR', confirmado pelo servidor no WELCOME
let privateTarget = null; // nome do usuario selecionado para mensagem privada, ou null
let onlineUsers = []; // ultima lista recebida do servidor (mensagem USERS): [{name, role}]
let rooms = []; // lista fixa de salas recebida do servidor (mensagem ROOMS)
let announcementsRoom = null; // canal em que so' a T.I escreve (mensagem ANNOUNCEMENTS)
let currentRoom = null; // sala que esta sendo exibida agora nesta aba
const pendingByRoom = {}; // sala -> mensagens aguardando resposta da T.I (so' a T.I recebe)

// Historico privado mantido em memoria RAM e persistido no LocalStorage
const privateHistories = {}; // outroUsuario -> [ { type, from, to, role, timestamp, text, filename, dataUrl, isPrivate: true } ]
const unreadPrivate = {}; // outroUsuario -> quantidade de mensagens nao lidas

// Visualizacao ativa: { type: 'room', id: 'Geral' } ou { type: 'private', id: 'Carlos' }
let activeView = { type: 'room', id: null };

// Arquivo temporariamente anexado para envio no chat privado
let stagedFile = null; // { name, size, type, dataUrl }

const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const chatMainEl = document.getElementById('chat-main');
const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
const roleRadios = document.querySelectorAll('input[name="role"]');
const loginButton = document.getElementById('login-button');
const loginError = document.getElementById('login-error');

const meEl = document.getElementById('me');
const roomListEl = document.getElementById('room-list');
const roomTitleEl = document.getElementById('room-title');
const tiListEl = document.getElementById('ti-list');
const userListEl = document.getElementById('user-list');
const messageLogEl = document.getElementById('message-log');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const privateIndicator = document.getElementById('private-indicator');
const privateTargetName = document.getElementById('private-target-name');
const cancelPrivateButton = document.getElementById('cancel-private');

// Elementos de anexo de arquivos (exclusivos para chat privado)
const attachButton = document.getElementById('attach-button');
const fileInput = document.getElementById('file-input');
const fileStaging = document.getElementById('file-staging');
const fileStagingName = document.getElementById('file-staging-name');
const fileStagingSize = document.getElementById('file-staging-size');
const fileStagingIcon = document.getElementById('file-staging-icon');
const fileStagingRemove = document.getElementById('file-staging-remove');

const ERROR_TEXTS = {
    nome_em_uso: 'Esse nome ja esta em uso, escolha outro.',
    nome_invalido: 'O nome nao pode conter "," ou ":".',
    senha_invalida: 'Senha da equipe de T.I incorreta.',
    papel_invalido: 'Selecione Colaborador ou Equipe de T.I.',
    somente_ti: 'Somente a equipe de T.I pode publicar neste canal.',
    sala_invalida: 'Canal inexistente.',
    usuario_offline: 'Esse usuario nao esta mais online.',
};

loginButton.addEventListener('click', connect);
usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connect();
});
passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connect();
});
roleRadios.forEach((radio) => radio.addEventListener('change', () => {
    passwordInput.classList.toggle('hidden', selectedRole() !== 'TI');
}));

function selectedRole() {
    return document.querySelector('input[name="role"]:checked').value;
}

function roleLabel(role) {
    return role === 'TI' ? 'T.I' : 'Colaborador';
}

function connect() {
    const username = usernameInput.value.trim();
    if (!username) return;
    const role = selectedRole();
    const password = role === 'TI' ? passwordInput.value : '';

    loginError.textContent = '';
    socket = new WebSocket('ws://' + location.host + '/ws');

    socket.addEventListener('open', () => {
        // Primeira mensagem do protocolo: registra nome e papel no servidor.
        socket.send('HELLO|' + username + '|' + role + '|' + password);
    });

    socket.addEventListener('message', (event) => handleServerMessage(event.data));

    socket.addEventListener('close', () => {
        if (myUsername !== null) addSystemMessage('Conexao com o servidor encerrada.');
    });

    socket.addEventListener('error', () => {
        loginError.textContent = 'Nao foi possivel conectar ao servidor.';
    });
}

// Separa "a|b|resto-com-possiveis-|" em N partes, sem cortar o texto livre do final.
function splitParts(text, count) {
    const parts = [];
    let rest = text;
    for (let i = 0; i < count - 1; i++) {
        const bar = rest.indexOf('|');
        if (bar === -1) break;
        parts.push(rest.substring(0, bar));
        rest = rest.substring(bar + 1);
    }
    parts.push(rest);
    return parts;
}

// ---------- Persistência Local (Memória RAM + LocalStorage) ----------

function getStorageKey(targetUser) {
    return 'tichat_priv_' + myUsername + '_' + targetUser;
}

function loadPrivateHistory(targetUser) {
    if (privateHistories[targetUser]) {
        return privateHistories[targetUser];
    }
    try {
        const stored = localStorage.getItem(getStorageKey(targetUser));
        if (stored) {
            privateHistories[targetUser] = JSON.parse(stored);
            return privateHistories[targetUser];
        }
    } catch (e) {
        console.warn('Erro ao carregar do LocalStorage:', e);
    }
    privateHistories[targetUser] = [];
    return privateHistories[targetUser];
}

function savePrivateHistory(targetUser) {
    const list = privateHistories[targetUser] || [];
    try {
        localStorage.setItem(getStorageKey(targetUser), JSON.stringify(list));
    } catch (e) {
        // Se a quota do LocalStorage estourar por causa de imagens grandes,
        // mantemos o histórico preservado na memória RAM durante toda a sessão.
        console.warn('Quota do LocalStorage excedida. Historico mantido na sessao:', e);
    }
}

// ---------- Roteamento de Mensagens do Servidor ----------

function handleServerMessage(raw) {
    if (raw.startsWith('WELCOME|')) {
        [myUsername, myRole] = splitParts(raw.substring('WELCOME|'.length), 2);
        meEl.textContent = 'Voce: ' + myUsername + ' (' + roleLabel(myRole) + ')';
        showChatScreen();
        return;
    }

    if (raw.startsWith('ERROR|')) {
        const reason = raw.substring('ERROR|'.length);
        const text = ERROR_TEXTS[reason] || 'Erro: ' + reason;
        if (myUsername === null) {
            loginError.textContent = text;
            socket.close();
        } else {
            addSystemMessage(text);
        }
        return;
    }

    if (raw.startsWith('ROOMS|')) {
        rooms = raw.substring('ROOMS|'.length).split(',');
        renderRoomList();
        return;
    }

    if (raw.startsWith('ANNOUNCEMENTS|')) {
        announcementsRoom = raw.substring('ANNOUNCEMENTS|'.length);
        updateComposer();
        return;
    }

    if (raw.startsWith('PENDING|')) {
        const [room, count] = splitParts(raw.substring('PENDING|'.length), 2);
        pendingByRoom[room] = Number(count);
        renderRoomList();
        return;
    }

    if (raw.startsWith('USERS|')) {
        const list = raw.substring('USERS|'.length);
        const users = list ? list.split(',').map((entry) => {
            const [name, role] = entry.split(':');
            return { name, role };
        }) : [];
        renderUserList(users);
        return;
    }

    if (raw.startsWith('JOIN|')) {
        const [name, role] = splitParts(raw.substring('JOIN|'.length), 2);
        addSystemMessage(name + ' (' + roleLabel(role) + ') entrou no chat.');
        return;
    }

    if (raw.startsWith('LEAVE|')) {
        const [name, role] = splitParts(raw.substring('LEAVE|'.length), 2);
        addSystemMessage(name + ' (' + roleLabel(role) + ') saiu do chat.');
        return;
    }

    if (raw.startsWith('HISTORY_BEGIN|')) {
        currentRoom = raw.substring('HISTORY_BEGIN|'.length);
        // Atualiza a tela da sala apenas se o usuario estiver atualmente vendo a sala (nao em privado)
        if (activeView.type === 'room') {
            roomTitleEl.textContent = '# ' + currentRoom;
            messageLogEl.innerHTML = '';
            renderRoomList();
            updateComposer();
        }
        return;
    }

    if (raw.startsWith('HISTORY_END|')) {
        if (activeView.type === 'room') {
            scrollToBottom();
        }
        return;
    }

    if (raw.startsWith('MSG|')) {
        const [room, from, role, timestamp, text] = splitParts(raw.substring('MSG|'.length), 5);
        if (activeView.type === 'room' && room === currentRoom) {
            addChatMessage(from, role, Number(timestamp), text, false);
        }
        return;
    }

    if (raw.startsWith('PRIVATE|')) {
        // PRIVATE|<from>|<to>|<role>|<timestamp>|<text>
        const [from, to, role, timestamp, text] = splitParts(raw.substring('PRIVATE|'.length), 5);
        const otherUser = (from === myUsername) ? to : from;

        const item = {
            type: 'text',
            from,
            to,
            role,
            timestamp: Number(timestamp),
            text,
            isPrivate: true,
        };
        const history = loadPrivateHistory(otherUser);
        history.push(item);
        savePrivateHistory(otherUser);

        if (activeView.type === 'private' && privateTarget === otherUser) {
            addChatMessage(from, role, Number(timestamp), text, true);
        } else {
            unreadPrivate[otherUser] = (unreadPrivate[otherUser] || 0) + 1;
            renderUserList(onlineUsers);
            addSystemMessage('📩 Nova mensagem privada de ' + from + '. Clique no nome dele(a) na barra lateral para ver.');
        }
        return;
    }

    if (raw.startsWith('PRIVATE_FILE|')) {
        // PRIVATE_FILE|<from>|<to>|<role>|<timestamp>|<filename>|<dataUrl>|<text>
        const [from, to, role, timestamp, filename, dataUrl, text] = splitParts(raw.substring('PRIVATE_FILE|'.length), 7);
        const otherUser = (from === myUsername) ? to : from;

        const item = {
            type: 'file',
            from,
            to,
            role,
            timestamp: Number(timestamp),
            filename,
            dataUrl,
            text,
            isPrivate: true,
        };
        const history = loadPrivateHistory(otherUser);
        history.push(item);
        savePrivateHistory(otherUser);

        if (activeView.type === 'private' && privateTarget === otherUser) {
            addChatFile(from, role, Number(timestamp), filename, dataUrl, text, true);
        } else {
            unreadPrivate[otherUser] = (unreadPrivate[otherUser] || 0) + 1;
            renderUserList(onlineUsers);
            addSystemMessage('📎 Novo anexo recebido de ' + from + ' (' + filename + '). Clique no nome dele(a) para abrir a conversa.');
        }
        return;
    }
}

function showChatScreen() {
    loginScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
}

// ---------- Navegação entre Salas (Canais) e Conversas Privadas ----------

function renderRoomList() {
    roomListEl.innerHTML = '';
    rooms.forEach((room) => {
        const li = document.createElement('li');
        li.textContent = room;
        const pending = pendingByRoom[room] || 0;
        if (pending > 0) {
            const notif = document.createElement('span');
            notif.className = 'notif';
            notif.textContent = pending > 99 ? '99+' : pending;
            notif.title = pending + ' mensagem(ns) aguardando resposta da T.I';
            li.appendChild(notif);
        }
        if (activeView.type === 'room' && room === currentRoom) {
            li.classList.add('active');
        }
        li.addEventListener('click', () => switchToRoom(room));
        roomListEl.appendChild(li);
    });
}

function switchToRoom(room) {
    if (!socket) return;
    privateTarget = null;
    activeView = { type: 'room', id: room };
    clearStagedFile();
    updatePrivateIndicator();
    renderUserList(onlineUsers);
    renderRoomList();
    socket.send('JOIN_ROOM|' + room);
}

function renderUserList(users) {
    onlineUsers = users;
    tiListEl.innerHTML = '';
    userListEl.innerHTML = '';

    users
        .filter((user) => user.name !== myUsername)
        .forEach((user) => {
            const li = document.createElement('li');
            li.textContent = user.name;
            if (activeView.type === 'private' && user.name === privateTarget) {
                li.classList.add('selected');
            }
            const unread = unreadPrivate[user.name] || 0;
            if (unread > 0) {
                const notif = document.createElement('span');
                notif.className = 'notif';
                notif.textContent = unread > 99 ? '99+' : unread;
                notif.title = unread + ' mensagem(ns) privada(s) nao lida(s)';
                li.appendChild(notif);
            }
            li.addEventListener('click', () => togglePrivateTarget(user.name));
            (user.role === 'TI' ? tiListEl : userListEl).appendChild(li);
        });

    addEmptyNotice(tiListEl, 'Nenhum tecnico online');
    addEmptyNotice(userListEl, 'Ninguem online');
}

function addEmptyNotice(listEl, text) {
    if (listEl.children.length > 0) return;
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = text;
    listEl.appendChild(li);
}

function togglePrivateTarget(name) {
    if (activeView.type === 'private' && privateTarget === name) {
        // Se já está na conversa com o usuário, voltar para a sala atual
        switchToRoom(currentRoom || rooms[0] || 'Avisos da T.I');
    } else {
        switchToPrivate(name);
    }
}

function switchToPrivate(targetUser) {
    privateTarget = targetUser;
    activeView = { type: 'private', id: targetUser };
    unreadPrivate[targetUser] = 0; // Marca como lidas
    clearStagedFile();

    renderRoomList(); // Desmarca sala ativa
    renderUserList(onlineUsers); // Marca usuario selecionado
    updatePrivateIndicator();
    renderPrivateChat(targetUser);
}

cancelPrivateButton.addEventListener('click', () => {
    switchToRoom(currentRoom || rooms[0] || 'Avisos da T.I');
});

function renderPrivateChat(targetUser) {
    roomTitleEl.textContent = '🔒 Conversa privada com ' + targetUser;
    messageLogEl.innerHTML = '';

    const history = loadPrivateHistory(targetUser);
    if (history.length === 0) {
        addSystemMessage('Início do histórico com ' + targetUser + '. Mensagens e arquivos enviados aqui são privados entre vocês dois.');
    } else {
        history.forEach((item) => {
            if (item.type === 'file') {
                addChatFile(item.from, item.role, item.timestamp, item.filename, item.dataUrl, item.text, true);
            } else {
                addChatMessage(item.from, item.role, item.timestamp, item.text, true);
            }
        });
    }
    scrollToBottom();
}

function updatePrivateIndicator() {
    if (activeView.type === 'private' && privateTarget) {
        privateTargetName.textContent = privateTarget;
        privateIndicator.classList.remove('hidden');
        attachButton.classList.remove('hidden'); // Exibe anexo apenas no privado
    } else {
        privateIndicator.classList.add('hidden');
        attachButton.classList.add('hidden'); // Oculta anexo fora do privado
        clearStagedFile();
    }
    updateComposer();
}

// Colaboradores so' leem o canal de avisos; mensagem privada continua liberada em qualquer canal.
function updateComposer() {
    const isAnnouncements = currentRoom === announcementsRoom;
    const isPrivate = activeView.type === 'private';
    const readOnly = isAnnouncements && myRole !== 'TI' && !isPrivate;

    messageInput.disabled = readOnly;
    messageForm.querySelector('button[type="submit"]').disabled = readOnly;

    if (isPrivate) {
        messageInput.placeholder = 'Mensagem privada para ' + privateTarget + ' (imagens, planilhas e arquivos permitidos)...';
    } else if (readOnly) {
        messageInput.placeholder = 'Somente a equipe de T.I publica neste canal.';
    } else if (myRole === 'TI') {
        messageInput.placeholder = 'Responda ou publique um aviso...';
    } else {
        messageInput.placeholder = 'Descreva o problema...';
    }
}

// ---------- Gestão de Anexos (Arquivos, Imagens e Planilhas no Privado) ----------

attachButton.addEventListener('click', () => {
    if (activeView.type !== 'private' || !privateTarget) {
        alert('O envio de arquivos é permitido exclusivamente em conversas privadas.');
        return;
    }
    fileInput.click();
});

fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
        handleSelectedFile(fileInput.files[0]);
    }
});

fileStagingRemove.addEventListener('click', clearStagedFile);

// Drag & drop suportado no chat principal
chatMainEl.addEventListener('dragover', (e) => {
    e.preventDefault();
});

chatMainEl.addEventListener('drop', (e) => {
    e.preventDefault();
    if (activeView.type !== 'private' || !privateTarget) {
        alert('O envio de arquivos, imagens e planilhas é permitido apenas em conversas privadas.\nClique em um contato na barra lateral primeiro.');
        return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleSelectedFile(e.dataTransfer.files[0]);
    }
});

function handleSelectedFile(file) {
    const MAX_SIZE = 8 * 1024 * 1024; // 8 MB
    if (file.size > MAX_SIZE) {
        alert('Arquivo muito grande! O limite máximo para envio é de 8 MB.');
        fileInput.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        stagedFile = {
            name: file.name,
            size: file.size,
            type: file.type,
            dataUrl: e.target.result,
        };
        renderStagedFile();
    };
    reader.onerror = () => {
        alert('Erro ao processar o arquivo selecionado.');
        fileInput.value = '';
    };
    reader.readAsDataURL(file);
}

function renderStagedFile() {
    if (!stagedFile) return;
    const classification = classifyFile(stagedFile.name, stagedFile.dataUrl);
    fileStagingIcon.textContent = classification.icon;
    fileStagingName.textContent = stagedFile.name;
    fileStagingSize.textContent = formatBytes(stagedFile.size);
    fileStaging.classList.remove('hidden');
    messageInput.focus();
}

function clearStagedFile() {
    stagedFile = null;
    fileInput.value = '';
    fileStaging.classList.add('hidden');
}

function classifyFile(filename, dataUrl) {
    const lowerName = filename.toLowerCase();
    const isImage = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(lowerName) || (dataUrl && dataUrl.startsWith('data:image/'));
    const isSpreadsheet = /\.(xlsx|xls|csv|ods|tsv)$/i.test(lowerName) || (dataUrl && (dataUrl.includes('spreadsheet') || dataUrl.includes('excel') || dataUrl.includes('csv')));

    if (isImage) {
        return {
            isImage: true,
            isSpreadsheet: false,
            icon: '🖼️',
            badgeText: 'IMAGEM',
            badgeClass: 'file-badge',
        };
    }
    if (isSpreadsheet) {
        return {
            isImage: false,
            isSpreadsheet: true,
            icon: '📊',
            badgeText: 'PLANILHA',
            badgeClass: 'spreadsheet-badge',
        };
    }
    return {
        isImage: false,
        isSpreadsheet: false,
        icon: '📄',
        badgeText: 'ARQUIVO',
        badgeClass: 'file-badge',
    };
}

function formatBytes(bytes) {
    if (!bytes || isNaN(bytes)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function estimateSizeFromDataUrl(dataUrl) {
    if (!dataUrl) return 0;
    const comma = dataUrl.indexOf(',');
    if (comma === -1) return 0;
    const base64Len = dataUrl.length - (comma + 1);
    return Math.round((base64Len * 3) / 4);
}

// ---------- Envio de Mensagens e Anexos ----------

messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text && !stagedFile) return;
    if (!socket) return;

    if (activeView.type === 'private' && privateTarget) {
        if (stagedFile) {
            const safeName = stagedFile.name.replace(/\|/g, '_');
            socket.send('PRIVATE_FILE|' + privateTarget + '|' + safeName + '|' + stagedFile.dataUrl + '|' + text);
            clearStagedFile();
        } else {
            socket.send('PRIVATE|' + privateTarget + '|' + text);
        }
    } else {
        socket.send('MSG|' + text);
    }
    messageInput.value = '';
});

function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'message system';
    div.textContent = text;
    messageLogEl.appendChild(div);
    scrollToBottom();
}

function addChatMessage(from, role, timestampMs, text, isPrivate) {
    const div = document.createElement('div');
    const isOwn = from === myUsername;
    div.className = 'message' + (isOwn ? ' own' : '') + (isPrivate ? ' private' : '') + (role === 'TI' ? ' ti' : '');

    const meta = document.createElement('div');
    meta.className = 'meta';
    const time = new Date(timestampMs);
    const hh = String(time.getHours()).padStart(2, '0');
    const mm = String(time.getMinutes()).padStart(2, '0');
    if (role === 'TI') {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'T.I';
        meta.appendChild(badge);
    }
    meta.appendChild(document.createTextNode(
        (isOwn ? 'Voce' : from) + (isPrivate ? ' (privado)' : '') + ' - ' + hh + ':' + mm));

    const body = document.createElement('div');
    body.className = 'message-text';
    body.textContent = text;

    div.appendChild(meta);
    div.appendChild(body);
    messageLogEl.appendChild(div);
    scrollToBottom();
}

function addChatFile(from, role, timestampMs, filename, dataUrl, text, isPrivate) {
    const div = document.createElement('div');
    const isOwn = from === myUsername;
    div.className = 'message' + (isOwn ? ' own' : '') + (isPrivate ? ' private' : '') + (role === 'TI' ? ' ti' : '');

    const meta = document.createElement('div');
    meta.className = 'meta';
    const time = new Date(timestampMs);
    const hh = String(time.getHours()).padStart(2, '0');
    const mm = String(time.getMinutes()).padStart(2, '0');
    if (role === 'TI') {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'T.I';
        meta.appendChild(badge);
    }
    meta.appendChild(document.createTextNode(
        (isOwn ? 'Voce' : from) + (isPrivate ? ' (privado)' : '') + ' - ' + hh + ':' + mm));
    div.appendChild(meta);

    // Texto opcional que acompanha o anexo
    if (text && text.trim()) {
        const body = document.createElement('div');
        body.className = 'message-text';
        body.textContent = text;
        div.appendChild(body);
    }

    const classification = classifyFile(filename, dataUrl);
    const estimatedSize = formatBytes(estimateSizeFromDataUrl(dataUrl));

    const attachmentEl = document.createElement('div');
    attachmentEl.className = 'file-attachment';

    if (classification.isImage) {
        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'attachment-image-wrapper';

        const img = document.createElement('img');
        img.className = 'chat-image-preview';
        img.src = dataUrl;
        img.alt = filename;
        img.title = 'Clique para abrir a imagem em tamanho real';
        img.addEventListener('click', () => {
            const win = window.open('');
            if (win) {
                win.document.write('<!DOCTYPE html><html><head><title>' + filename + '</title><style>body{margin:0;background:#111;display:flex;align-items:center;justify-content:center;height:100vh;}img{max-width:100%;max-height:100vh;object-fit:contain;}</style></head><body><img src="' + dataUrl + '"></body></html>');
            }
        });

        const footer = document.createElement('div');
        footer.className = 'attachment-image-footer';
        footer.innerHTML = '<span>' + filename + ' (' + estimatedSize + ')</span>';

        const dlBtn = document.createElement('a');
        dlBtn.className = 'attachment-download-btn';
        dlBtn.href = dataUrl;
        dlBtn.download = filename;
        dlBtn.textContent = '⬇ Baixar';
        footer.appendChild(dlBtn);

        imgWrapper.appendChild(img);
        imgWrapper.appendChild(footer);
        attachmentEl.appendChild(imgWrapper);
    } else {
        const card = document.createElement('div');
        card.className = 'attachment-file-card ' + (classification.isSpreadsheet ? 'spreadsheet' : 'generic-file');

        const iconEl = document.createElement('div');
        iconEl.className = 'attachment-icon';
        iconEl.textContent = classification.icon;

        const infoEl = document.createElement('div');
        infoEl.className = 'attachment-info';

        const badgeEl = document.createElement('div');
        badgeEl.className = 'attachment-badge ' + classification.badgeClass;
        badgeEl.textContent = classification.badgeText;

        const nameEl = document.createElement('div');
        nameEl.className = 'attachment-name';
        nameEl.textContent = filename;
        nameEl.title = filename;

        const sizeEl = document.createElement('div');
        sizeEl.className = 'attachment-size';
        sizeEl.textContent = estimatedSize;

        infoEl.appendChild(badgeEl);
        infoEl.appendChild(nameEl);
        infoEl.appendChild(sizeEl);

        const dlBtn = document.createElement('a');
        dlBtn.className = 'attachment-download-btn';
        dlBtn.href = dataUrl;
        dlBtn.download = filename;
        dlBtn.textContent = '⬇ Baixar';

        card.appendChild(iconEl);
        card.appendChild(infoEl);
        card.appendChild(dlBtn);
        attachmentEl.appendChild(card);
    }

    div.appendChild(attachmentEl);
    messageLogEl.appendChild(div);
    scrollToBottom();
}

function scrollToBottom() {
    messageLogEl.scrollTop = messageLogEl.scrollHeight;
}
