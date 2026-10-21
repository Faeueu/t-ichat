package webchat;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Serve os arquivos estaticos da interface (index.html, style.css, app.js) via HTTP comum,
 * usando apenas Streams (sem nenhum servidor HTTP embutido pronto). E' uma resposta simples:
 * sem cache, sem keep-alive, sem faixas de bytes (range) - o suficiente para a demonstracao.
 */
final class StaticFileServer {

    private static final String WEB_ROOT = "webchat/web";

    private StaticFileServer() {
    }

    static void serve(String path, OutputStream out) throws IOException {
        String relativePath = path.equals("/") ? "/index.html" : path;
        File file = new File(WEB_ROOT, relativePath);

        if (!file.exists() || file.isDirectory()) {
            byte[] body = "404 - arquivo nao encontrado".getBytes(StandardCharsets.UTF_8);
            writeResponse(out, "404 Not Found", "text/plain; charset=utf-8", body);
            return;
        }

        byte[] body = readAllBytes(file);
        writeResponse(out, "200 OK", contentTypeFor(relativePath), body);
    }

    private static byte[] readAllBytes(File file) throws IOException {
        try (FileInputStream fis = new FileInputStream(file)) {
            byte[] data = new byte[(int) file.length()];
            int offset = 0;
            int read;
            while (offset < data.length && (read = fis.read(data, offset, data.length - offset)) != -1) {
                offset += read;
            }
            return data;
        }
    }

    private static void writeResponse(OutputStream out, String status, String contentType, byte[] body) throws IOException {
        String headers = "HTTP/1.1 " + status + "\r\n"
                + "Content-Type: " + contentType + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Connection: close\r\n"
                + "\r\n";
        out.write(headers.getBytes(StandardCharsets.US_ASCII));
        out.write(body);
        out.flush();
    }

    private static String contentTypeFor(String path) {
        if (path.endsWith(".html")) return "text/html; charset=utf-8";
        if (path.endsWith(".css")) return "text/css; charset=utf-8";
        if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
        return "application/octet-stream";
    }
}
