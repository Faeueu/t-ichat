package webchat;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/**
 * Implementacao minima do lado-servidor do protocolo WebSocket (RFC 6455), feita a mao
 * com Streams puros, para nao depender de nenhuma biblioteca externa (Spring/Netty/Tomcat).
 * Metodos sem estado (todos static) - cada ClientHandler chama estes metodos passando
 * o InputStream/OutputStream da sua propria conexao.
 */
final class WebSocketCodec {

    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    private WebSocketCodec() {
    }

    // --- Fase HTTP (handshake) -------------------------------------------------------

    static String[] readRequestLine(InputStream in) throws IOException {
        String line = readLine(in);
        if (line == null || line.isEmpty()) {
            return null;
        }
        return line.split(" ");
    }

    static Map<String, String> readHeaders(InputStream in) throws IOException {
        Map<String, String> headers = new HashMap<>();
        String line;
        while ((line = readLine(in)) != null && !line.isEmpty()) {
            int colon = line.indexOf(':');
            if (colon > 0) {
                String name = line.substring(0, colon).trim().toLowerCase();
                String value = line.substring(colon + 1).trim();
                headers.put(name, value);
            }
        }
        return headers;
    }

    // Le byte a byte ate achar "\r\n". Usar um InputStream cru (sem buffer) aqui e'
    // proposital: depois do handshake o MESMO stream passa a ser lido em modo binario
    // pelos frames do WebSocket, e um BufferedReader poderia ter "roubado" bytes do
    // frame binario para dentro do seu buffer interno sem devolve-los.
    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        int b;
        boolean sawAnyByte = false;
        while ((b = in.read()) != -1) {
            sawAnyByte = true;
            if (b == '\r') {
                int next = in.read();
                if (next == '\n') {
                    return buffer.toString(StandardCharsets.US_ASCII.name());
                }
                buffer.write(b);
                if (next != -1) {
                    buffer.write(next);
                }
                continue;
            }
            buffer.write(b);
        }
        return sawAnyByte ? buffer.toString(StandardCharsets.US_ASCII.name()) : null;
    }

    static String computeAcceptKey(String secWebSocketKey) throws NoSuchAlgorithmException {
        String concatenated = secWebSocketKey + WS_GUID;
        MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
        byte[] hash = sha1.digest(concatenated.getBytes(StandardCharsets.UTF_8));
        return Base64.getEncoder().encodeToString(hash);
    }

    static void sendHandshakeResponse(OutputStream out, String acceptKey) throws IOException {
        String response = "HTTP/1.1 101 Switching Protocols\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + acceptKey + "\r\n"
                + "\r\n";
        out.write(response.getBytes(StandardCharsets.US_ASCII));
        out.flush();
    }

    // --- Fase WebSocket (frames) -------------------------------------------------------

    // Frames do servidor para o cliente NAO usam mascara (so cliente->servidor mascara,
    // conforme RFC 6455). FIN=1 e opcode=0x1 (texto) fixos, pois so enviamos mensagens
    // completas de uma vez.
    static void sendTextFrame(OutputStream out, String payload) throws IOException {
        byte[] data = payload.getBytes(StandardCharsets.UTF_8);
        ByteArrayOutputStream frame = new ByteArrayOutputStream();

        frame.write(0x81); // FIN=1 (10000000) + opcode=0001 (texto) => 0x81

        int length = data.length;
        if (length <= 125) {
            frame.write(length);
        } else if (length <= 65535) {
            frame.write(126);
            frame.write((length >>> 8) & 0xFF);
            frame.write(length & 0xFF);
        } else {
            frame.write(127);
            for (int shift = 56; shift >= 0; shift -= 8) {
                frame.write((int) ((length >>> shift) & 0xFF));
            }
        }

        frame.write(data);
        out.write(frame.toByteArray());
        out.flush();
    }

    // Le um frame vindo do navegador. Frames do cliente SEMPRE vem mascarados (bit de
    // mascara = 1); por isso precisamos ler a chave de mascara de 4 bytes e desfazer o
    // XOR byte a byte para recuperar o payload original.
    static String readTextFrame(InputStream in) throws IOException {
        int firstByte = in.read();
        if (firstByte == -1) {
            return null; // conexao fechada sem frame de close explicito
        }
        int opcode = firstByte & 0x0F;

        int secondByte = readStrict(in);
        boolean masked = (secondByte & 0x80) != 0;
        long length = secondByte & 0x7F;

        if (length == 126) {
            length = (readStrict(in) << 8) | readStrict(in);
        } else if (length == 127) {
            length = 0;
            for (int i = 0; i < 8; i++) {
                length = (length << 8) | readStrict(in);
            }
        }

        byte[] mask = new byte[4];
        if (masked) {
            for (int i = 0; i < 4; i++) {
                mask[i] = (byte) readStrict(in);
            }
        }

        byte[] payload = new byte[(int) length];
        int offset = 0;
        while (offset < payload.length) {
            int read = in.read(payload, offset, payload.length - offset);
            if (read == -1) {
                throw new IOException("conexao encerrada no meio de um frame");
            }
            offset += read;
        }
        if (masked) {
            for (int i = 0; i < payload.length; i++) {
                payload[i] = (byte) (payload[i] ^ mask[i % 4]);
            }
        }

        if (opcode == 0x8) {
            return null; // frame de close
        }
        if (opcode == 0x9 || opcode == 0xA) {
            return readTextFrame(in); // ping/pong: ignora e le o proximo frame real
        }
        if (opcode != 0x1) {
            throw new IOException("opcode nao suportado: " + opcode);
        }
        return new String(payload, StandardCharsets.UTF_8);
    }

    private static int readStrict(InputStream in) throws IOException {
        int b = in.read();
        if (b == -1) {
            throw new IOException("fim de stream inesperado ao ler frame");
        }
        return b;
    }
}
