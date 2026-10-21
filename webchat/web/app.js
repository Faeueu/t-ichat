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

const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
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
        parts.push(rest.substring(0, bar));
        rest = rest.substring(bar + 1);
    }
    parts.push(rest);
    return parts;
}

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
        roomTitleEl.textContent = '# ' + currentRoom;
        messageLogEl.innerHTML = ''; // limpa a tela para mostrar o historico da sala
        renderRoomList();
        updateComposer();
        return;
    }

    if (raw.startsWith('HISTORY_END|')) {
        scrollToBottom();
        return;
    }

    if (raw.startsWith('MSG|')) {
        const [room, from, role, timestamp, text] = splitParts(raw.substring('MSG|'.length), 5);
        addChatMessage(from, role, Number(timestamp), text, false);
        return;
    }

    if (raw.startsWith('PRIVATE|')) {
        const [from, role, timestamp, text] = splitParts(raw.substring('PRIVATE|'.length), 4);
        addChatMessage(from, role, Number(timestamp), text, true);
        return;
    }
}

function showChatScreen() {
    loginScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
}

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
        if (room === currentRoom) li.classList.add('active');
        li.addEventListener('click', () => switchRoom(room));
        roomListEl.appendChild(li);
    });
}

function switchRoom(room) {
    if (room === currentRoom || !socket) return;
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
            if (user.name === privateTarget) li.classList.add('selected');
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
    privateTarget = privateTarget === name ? null : name;
    updatePrivateIndicator();
    renderUserList(onlineUsers);
}

cancelPrivateButton.addEventListener('click', () => {
    privateTarget = null;
    updatePrivateIndicator();
    renderUserList(onlineUsers);
});

function updatePrivateIndicator() {
    if (privateTarget) {
        privateTargetName.textContent = privateTarget;
        privateIndicator.classList.remove('hidden');
    } else {
        privateIndicator.classList.add('hidden');
    }
    updateComposer();
}

// Colaboradores so' leem o canal de avisos; mensagem privada continua liberada em qualquer canal.
function updateComposer() {
    const readOnly = currentRoom === announcementsRoom && myRole !== 'TI' && !privateTarget;
    messageInput.disabled = readOnly;
    messageForm.querySelector('button').disabled = readOnly;
    if (readOnly) {
        messageInput.placeholder = 'Somente a equipe de T.I publica neste canal.';
    } else if (myRole === 'TI') {
        messageInput.placeholder = 'Responda ou publique um aviso...';
    } else {
        messageInput.placeholder = 'Descreva o problema...';
    }
}

messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !socket) return;

    if (privateTarget) {
        socket.send('PRIVATE|' + privateTarget + '|' + text);
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
    body.textContent = text;

    div.appendChild(meta);
    div.appendChild(body);
    messageLogEl.appendChild(div);
    scrollToBottom();
}

function scrollToBottom() {
    messageLogEl.scrollTop = messageLogEl.scrollHeight;
}
