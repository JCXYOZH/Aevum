// Aevum AI 动作桥：模型文本 -> 33 维动作标签向量。
//
// 只使用 Windows 自带 WinHTTP，不引入第三方库。模型由本机已有的
// llama-server 加载，程序不下载模型、不编译别人的源码。
//
// 编译：
//   g++ -std=c++17 -O2 ai_action_bridge.cpp -lwinhttp -o ai_action_bridge.exe
//
// 用法：
//   ai_action_bridge.exe --text "右手向镜头挥一下"
//   ai_action_bridge.exe
//   ai_action_bridge.exe --append D:\Aevum\var\logs\ai-labels.jsonl

#include <windows.h>
#include <winhttp.h>

#include <cstdio>
#include <fstream>
#include <iostream>
#include <string>

#include "label_vector.hpp"

static const wchar_t* kHost = L"127.0.0.1";
static const int kPort = 8081;
static const wchar_t* kPath = L"/v1/chat/completions";

std::string ToUtf8(const std::wstring& text) {
    if (text.empty()) return "";
    int length = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string out(length > 0 ? length - 1 : 0, '\0');
    if (length > 1) {
        WideCharToMultiByte(CP_UTF8, 0, text.c_str(), -1, out.data(), length, nullptr, nullptr);
    }
    return out;
}

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

std::string TimestampWithOffset() {
    SYSTEMTIME st;
    GetLocalTime(&st);
    TIME_ZONE_INFORMATION tz;
    DWORD zone = GetTimeZoneInformation(&tz);
    LONG bias = tz.Bias;
    if (zone == TIME_ZONE_ID_DAYLIGHT) bias += tz.DaylightBias;
    int offsetMinutes = static_cast<int>(-bias);
    int offsetHours = offsetMinutes / 60;
    int offsetRemainder = std::abs(offsetMinutes % 60);
    char buffer[48];
    std::snprintf(buffer, sizeof(buffer),
                  "%04d-%02d-%02dT%02d:%02d:%02d.%03d%c%02d:%02d",
                  st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond,
                  st.wMilliseconds, offsetMinutes >= 0 ? '+' : '-',
                  std::abs(offsetHours), offsetRemainder);
    return buffer;
}

std::string BuildBody(const std::string& thought) {
    const std::string system =
        "你是一个有身体的动作驱动引擎。只输出一句很短的中文动作想法，"
        "不要解释，不要 JSON，不要角度、时长、权重或参数。"
        "可以说身体部位、动作和目标，例如：右手向镜头挥一下。";
    return "{\"model\":\"local\",\"messages\":["
           "{\"role\":\"system\",\"content\":\"" + EscapeJson(system) + "\"},"
           "{\"role\":\"user\",\"content\":\"" + EscapeJson(thought) + "\"}],"
           "\"temperature\":0.1,\"max_tokens\":1024,\"stream\":false}";
}

bool HttpPost(const std::string& body, std::string* response, std::string* error) {
    HINTERNET session = WinHttpOpen(L"aevum-ai-bridge/1.0",
        WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_NO_PROXY_NAME,
        WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) {
        *error = "WinHttpOpen failed";
        return false;
    }
    WinHttpSetTimeouts(session, 5000, 5000, 120000, 120000);

    HINTERNET connect = WinHttpConnect(session, kHost, static_cast<INTERNET_PORT>(kPort), 0);
    if (!connect) {
        *error = "WinHttpConnect failed";
        WinHttpCloseHandle(session);
        return false;
    }

    HINTERNET request = WinHttpOpenRequest(connect, L"POST", kPath,
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

std::string ExtractJsonString(const std::string& json, const std::string& key) {
    const std::string needle = "\"" + key + "\":\"";
    size_t start = json.find(needle);
    if (start == std::string::npos) return "";
    start += needle.size();
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

std::string Trim(const std::string& text) {
    size_t begin = text.find_first_not_of(" \t\r\n");
    if (begin == std::string::npos) return "";
    size_t end = text.find_last_not_of(" \t\r\n");
    return text.substr(begin, end - begin + 1);
}

int main(int argc, char** argv) {
    SetConsoleOutputCP(CP_UTF8);

    std::string thought;
    std::string appendPath;
    bool fromModel = true;

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--text" && i + 1 < argc) {
            thought = argv[++i];
            fromModel = false;
        } else if (arg == "--text-file" && i + 1 < argc) {
            std::ifstream in(argv[++i], std::ios::binary);
            if (!in) {
                std::cerr << "无法读取文本文件\n";
                return 4;
            }
            std::string content((std::istreambuf_iterator<char>(in)),
                                std::istreambuf_iterator<char>());
            thought = Trim(content);
            fromModel = false;
        } else if (arg == "--append" && i + 1 < argc) {
            appendPath = argv[++i];
        }
    }

    if (fromModel) {
        const std::string prompt = thought.empty()
            ? "向镜头挥右手打招呼，然后看向镜头。"
            : thought;
        std::string response;
        std::string error;
        if (!HttpPost(BuildBody(prompt), &response, &error)) {
            std::cerr << "模型请求失败: " << error << "\n";
            return 2;
        }
        thought = ExtractJsonString(response, "content");
        if (thought.empty()) {
            // 推理模型可能把内容放在 reasoning_content；没有最终文本时退回它，保证桥还能输出。
            thought = ExtractJsonString(response, "reasoning_content");
        }
        thought = Trim(thought);
    }

    if (thought.empty()) {
        std::cerr << "没有拿到模型文本\n";
        return 1;
    }

    aevum::LabelVector labels;
    labels.EncodeText(thought);

    std::string line =
        "{\"timestamp\":\"" + TimestampWithOffset() + "\","
        "\"thought\":\"" + EscapeJson(thought) + "\","
        "\"label_vector\":" + labels.ToJsonArray() + ","
        "\"labels\":" + labels.ActiveLabelsJson() + ","
        "\"label_key\":\"" + EscapeJson(labels.CanonicalKey()) + "\"}";

    std::cout << line << "\n";

    if (!appendPath.empty()) {
        std::ofstream out(appendPath, std::ios::app | std::ios::binary);
        if (!out) {
            std::cerr << "无法写入记录文件: " << appendPath << "\n";
            return 3;
        }
        out << line << "\n";
    }
    return 0;
}
