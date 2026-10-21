// Estado local desta aba do navegador.
let socket = null;
let myUsername = null;
let privateTarget = null; // nome do usuario selecionado para mensagem privada, ou null
let onlineUsers = []; // ultima lista de usuarios recebida do servidor (mensagem USERS)
let rooms = []; // lista fixa de salas recebida do servidor (mensagem ROOMS)
let currentRoom = null; // sala que esta sendo exibida agora nesta aba

const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const usernameInput = document.getElementById('username-input');
const loginButton = document.getElementById('login-button');
const loginError = document.getElementById('login-error');

const roomListEl = document.getElementById('room-list');
const roomTitleEl = document.getElementById('room-title');
const userListEl = document.getElementById('user-list');
const messageLogEl = document.getElementById('message-log');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const privateIndicator = document.getElementById('private-indicator');
const privateTargetName = document.getElementById('private-target-name');
const cancelPrivateButton = document.getElementById('cancel-private');

loginButton.addEventListener('click', connect);
usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connect();
});

function connect() {
    const username = usernameInput.value.trim();
    if (!username) return;

    loginError.textContent = '';
    socket = new WebSocket('ws://' + location.host + '/ws');

    socket.addEventListener('open', () => {
        // Primeira mensagem do protocolo: registra o nome de usuario no servidor.
        socket.send('HELLO|' + username);
    });

    socket.addEventListener('message', (event) => handleServerMessage(event.data));

    socket.addEventListener('close', () => {
        addSystemMessage('Conexao com o servidor encerrada.');
    });

    socket.addEventListener('error', () => {
        loginError.textContent = 'Nao foi possivel conectar ao servidor.';
    });
}

// Separa "a|b|resto-com-possiveis-|" em 3 partes, sem cortar o texto livre do final.
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
        myUsername = raw.substring('WELCOME|'.length);
        showChatScreen();
        return;
    }

    if (raw.startsWith('ERROR|')) {
        const reason = raw.substring('ERROR|'.length);
        if (myUsername === null) {
            loginError.textContent = reason === 'nome_em_uso'
                ? 'Esse nome ja esta em uso, escolha outro.'
                : 'Erro: ' + reason;
            socket.close();
        } else {
            addSystemMessage('Erro: ' + reason);
        }
        return;
    }

    if (raw.startsWith('ROOMS|')) {
        rooms = raw.substring('ROOMS|'.length).split(',');
        renderRoomList();
        return;
    }

    if (raw.startsWith('USERS|')) {
        const list = raw.substring('USERS|'.length);
        renderUserList(list ? list.split(',') : []);
        return;
    }

    if (raw.startsWith('JOIN|')) {
        addSystemMessage(raw.substring('JOIN|'.length) + ' entrou no chat.');
        return;
    }

    if (raw.startsWith('LEAVE|')) {
        addSystemMessage(raw.substring('LEAVE|'.length) + ' saiu do chat.');
        return;
    }

    if (raw.startsWith('HISTORY_BEGIN|')) {
        currentRoom = raw.substring('HISTORY_BEGIN|'.length);
        roomTitleEl.textContent = '# ' + currentRoom;
        messageLogEl.innerHTML = ''; // limpa a tela para mostrar o historico da sala
        renderRoomList();
        return;
    }

    if (raw.startsWith('HISTORY_END|')) {
        scrollToBottom();
        return;
    }

    if (raw.startsWith('MSG|')) {
        const [room, from, timestamp, text] = splitParts(raw.substring('MSG|'.length), 4);
        addChatMessage(from, Number(timestamp), text, false);
        return;
    }

    if (raw.startsWith('PRIVATE|')) {
        const [from, timestamp, text] = splitParts(raw.substring('PRIVATE|'.length), 3);
        addChatMessage(from, Number(timestamp), text, true);
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
        if (room === currentRoom) li.classList.add('active');
        li.addEventListener('click', () => switchRoom(room));
        roomListEl.appendChild(li);
    });
}

function switchRoom(room) {
    if (room === currentRoom || !socket) return;
    socket.send('JOIN_ROOM|' + room);
}

function renderUserList(usernames) {
    onlineUsers = usernames;
    userListEl.innerHTML = '';
    usernames
        .filter((name) => name !== myUsername)
        .forEach((name) => {
            const li = document.createElement('li');
            li.textContent = name;
            if (name === privateTarget) li.classList.add('selected');
            li.addEventListener('click', () => togglePrivateTarget(name));
            userListEl.appendChild(li);
        });
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

function addChatMessage(from, timestampMs, text, isPrivate) {
    const div = document.createElement('div');
    const isOwn = from === myUsername;
    div.className = 'message' + (isOwn ? ' own' : '') + (isPrivate ? ' private' : '');

    const meta = document.createElement('div');
    meta.className = 'meta';
    const time = new Date(timestampMs);
    const hh = String(time.getHours()).padStart(2, '0');
    const mm = String(time.getMinutes()).padStart(2, '0');
    meta.textContent = (isOwn ? 'Voce' : from) + (isPrivate ? ' (privado)' : '') + ' - ' + hh + ':' + mm;

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
