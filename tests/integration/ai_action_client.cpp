// C++ 动作接口测试：调用已加载本地 GGUF 的 llama-server。
// 不引入第三方库，只用 Windows WinHTTP。
//
// 编译：
//   g++ -std=c++17 -O2 ai_action_client.cpp -lwinhttp -o ai_action_client.exe
// 运行（先启动 llama-server，见 README 或命令行）：
//   ai_action_client.exe

#include <windows.h>
#include <winhttp.h>
#include <iostream>
#include <string>

static std::wstring kHost = L"127.0.0.1";
static int kPort = 8081;
static std::wstring kPath = L"/v1/chat/completions";

std::string EscapeJson(const std::string& value) {
    std::string out;
    for (char c : value) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default: out += c; break;
        }
    }
    return out;
}

std::string BuildBody() {
    const std::string system =
        "你是角色动作规划器。只输出 JSON 数组，不要解释，不要 Markdown。\n"
        "每个元素只能有一个动作名和目标，不允许输出角度、权重、时长、力度、参数表。\n"
        "可用动作：\n"
        "{\"do\":\"greet\"}\n"
        "{\"do\":\"wave\",\"at\":\"camera\"}\n"
        "{\"do\":\"lookAt\",\"at\":\"camera\"}\n"
        "{\"do\":\"reach\",\"at\":\"camera\"}\n"
        "{\"do\":\"release\"}\n"
        "at 只能是 camera/front/up/down。不要输出推理过程，直接输出最终 JSON 数组。";
    const std::string user =
        "让角色向镜头打招呼，然后看向镜头。";
    return "{\"model\":\"local\",\"messages\":["
           "{\"role\":\"system\",\"content\":\"" + EscapeJson(system) + "\"},"
           "{\"role\":\"user\",\"content\":\"" + EscapeJson(user) + "\"}],"
           "\"temperature\":0.1,\"max_tokens\":1024,\"stream\":false}";
}

bool HttpPost(const std::string& body, std::string* response, std::string* error) {
    HINTERNET session = WinHttpOpen(L"aevum-action-test/1.0",
        WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_NO_PROXY_NAME,
        WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) {
        *error = "WinHttpOpen failed";
        return false;
    }
    WinHttpSetTimeouts(session, 5000, 5000, 120000, 120000);

    HINTERNET connect = WinHttpConnect(session, kHost.c_str(),
        static_cast<INTERNET_PORT>(kPort), 0);
    if (!connect) {
        *error = "WinHttpConnect failed";
        WinHttpCloseHandle(session);
        return false;
    }

    HINTERNET request = WinHttpOpenRequest(connect, L"POST", kPath.c_str(),
        nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, 0);
    if (!request) {
        *error = "WinHttpOpenRequest failed";
        WinHttpCloseHandle(connect);
        WinHttpCloseHandle(session);
        return false;
    }

    std::wstring headers = L"Content-Type: application/json\r\n";
    BOOL sent = WinHttpSendRequest(request, headers.c_str(),
        static_cast<DWORD>(headers.size()), (LPVOID)body.data(),
        static_cast<DWORD>(body.size()), static_cast<DWORD>(body.size()), 0);
    if (!sent) {
        *error = "WinHttpSendRequest failed: " + std::to_string(GetLastError());
        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connect);
        WinHttpCloseHandle(session);
        return false;
    }

    if (!WinHttpReceiveResponse(request, nullptr)) {
        *error = "WinHttpReceiveResponse failed: " + std::to_string(GetLastError());
        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connect);
        WinHttpCloseHandle(session);
        return false;
    }

    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    WinHttpQueryHeaders(request,
        WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX, &status, &statusSize,
        WINHTTP_NO_HEADER_INDEX);
    if (status != 200) {
        *error = "HTTP status " + std::to_string(status);
    }

    response->clear();
    DWORD available = 0;
    do {
        available = 0;
        if (!WinHttpQueryDataAvailable(request, &available)) break;
        if (available == 0) break;
        std::string chunk(available, '\0');
        DWORD read = 0;
        if (!WinHttpReadData(request, chunk.data(), available, &read)) break;
        chunk.resize(read);
        *response += chunk;
    } while (available > 0);

    WinHttpCloseHandle(request);
    WinHttpCloseHandle(connect);
    WinHttpCloseHandle(session);
    return status == 200;
}

// 从 OpenAI 兼容响应里取 choices[0].message.content，处理常见转义。
std::string ExtractContent(const std::string& json) {
    const std::string key = "\"content\":\"";
    size_t start = json.find(key);
    if (start == std::string::npos) return "";
    start += key.size();
    std::string out;
    for (size_t i = start; i < json.size(); ++i) {
        char c = json[i];
        if (c == '"') break;
        if (c == '\\' && i + 1 < json.size()) {
            char next = json[++i];
            switch (next) {
                case 'n': out += '\n'; break;
                case 'r': out += '\r'; break;
                case 't': out += '\t'; break;
                case '"': out += '"'; break;
                case '\\': out += '\\'; break;
                case 'u': {
                    if (i + 4 < json.size()) {
                        // 只保留 BMP 的 UTF-8 近似，够测试打印用。
                        unsigned code = std::stoul(json.substr(i + 1, 4), nullptr, 16);
                        if (code < 0x80) {
                            out += static_cast<char>(code);
                        } else if (code < 0x800) {
                            out += static_cast<char>(0xC0 | (code >> 6));
                            out += static_cast<char>(0x80 | (code & 0x3F));
                        } else {
                            out += static_cast<char>(0xE0 | (code >> 12));
                            out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
                            out += static_cast<char>(0x80 | (code & 0x3F));
                        }
                        i += 4;
                    }
                    break;
                }
                default: out += next; break;
            }
        } else {
            out += c;
        }
    }
    return out;
}

int main() {
    SetConsoleOutputCP(CP_UTF8);
    std::string body = BuildBody();
    std::string response;
    std::string error;
    if (!HttpPost(body, &response, &error)) {
        std::cerr << "请求失败: " << error << "\n";
        return 2;
    }

    std::string content = ExtractContent(response);
    if (content.empty()) {
        std::cerr << "没有取到 content，原始响应:\n" << response << "\n";
        return 1;
    }

    std::cout << "模型输出:\n" << content << "\n\n";
    if (content.find("\"do\"") == std::string::npos) {
        std::cerr << "输出里没有 do 动作字段\n";
        return 1;
    }
    const char* forbidden[] = {"\"palm\"", "\"thumb\"", "\"duration\"", "\"cycles\"",
                               "\"weight\"", "\"angle\"", "\"rotation\""};
    for (const char* key : forbidden) {
        if (content.find(key) != std::string::npos) {
            std::cerr << "输出包含禁止的参数: " << key << "\n";
            return 1;
        }
    }
    std::cout << "通过: 模型只返回了动作名，没有参数表\n";
    return 0;
}
