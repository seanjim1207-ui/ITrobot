import os
import re
import json
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import httpx

# ===== 簡轉繁（強制保證輸出繁體中文，台灣用語） =====
try:
    from opencc import OpenCC
    _cc = OpenCC("s2twp")  # 簡體 → 繁體台灣（含詞彙轉換：服务器→伺服器、软件→軟體）

    def to_traditional(text: str) -> str:
        if not text:
            return text
        return _cc.convert(text)
except ImportError:
    print("⚠ 未安裝 opencc-python-reimplemented，無法自動簡轉繁。請執行：pip install opencc-python-reimplemented")

    def to_traditional(text: str) -> str:
        return text

app = FastAPI()

# ===== 設定 =====
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
DOCS_DIR = Path(__file__).parent / "docs"


# ===== 知識庫（結構化儲存） =====
KB_DOCS: list[dict] = []  # [{filename, title, content}]


def load_knowledge_base():
    """掃描 docs/*.md，解析 frontmatter，存成結構化清單"""
    global KB_DOCS
    KB_DOCS = []
    if not DOCS_DIR.exists():
        return

    for md_file in sorted(DOCS_DIR.glob("*.md")):
        raw = md_file.read_text(encoding="utf-8")
        title = md_file.stem
        content = raw
        keywords = ""

        fm_match = re.match(r"^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$", raw)
        if fm_match:
            fm_text = fm_match.group(1)
            content = fm_match.group(2)
            title_match = re.search(r"title:\s*(.+)", fm_text)
            if title_match:
                title = title_match.group(1).strip()
            kw_match = re.search(r"keywords:\s*(.+)", fm_text)
            if kw_match:
                keywords = kw_match.group(1).strip()

        KB_DOCS.append({
            "filename": md_file.name,
            "title": title,
            "keywords": keywords,
            "content": content.strip(),
        })


load_knowledge_base()


# ===== 簡易檢索（中英文 bigram 評分） =====
def tokenize(text: str) -> list[str]:
    """中文用 bigram、英文/數字用單字"""
    text = text.lower()
    tokens = re.findall(r"[a-z0-9]{2,}", text)
    chinese_chunks = re.findall(r"[\u4e00-\u9fff]+", text)
    for chunk in chinese_chunks:
        if len(chunk) == 1:
            tokens.append(chunk)
        for i in range(len(chunk) - 1):
            tokens.append(chunk[i:i + 2])
    return tokens


def retrieve_relevant_docs(query: str, k: int = 3, min_score: int = 2) -> tuple[list[dict], int]:
    """挑出最相關的 k 份文件，回傳 (docs, top_score)。沒命中時 docs 為空。"""
    if not KB_DOCS:
        return [], 0

    q_tokens = tokenize(query)
    if not q_tokens:
        return [], 0

    scored = []
    for doc in KB_DOCS:
        title_lower = doc["title"].lower()
        keywords_lower = doc.get("keywords", "").lower()
        content_lower = doc["content"].lower()
        score = 0
        seen = set()
        for tok in q_tokens:
            if tok in seen:
                continue
            seen.add(tok)
            if tok in keywords_lower:
                score += 5   # keywords 命中：作者親手宣告的同義詞
            if tok in title_lower:
                score += 3   # 標題命中
            score += content_lower.count(tok)  # 內文命中：每出現一次 +1
        scored.append((score, doc))

    scored.sort(key=lambda x: x[0], reverse=True)
    top_score = scored[0][0] if scored else 0
    top = [doc for s, doc in scored if s >= min_score][:k]
    return top, top_score


# ===== 動態組裝 system prompt（只塞相關文件） =====
SYSTEM_PROMPT_TEMPLATE = """你是一個工作交接問答機器人。**唯一可以使用的資訊來源就是下方提供的知識庫**。除此之外的任何知識（你訓練時學到的、外面網路上的、其他公司的範例、通用常識）都禁止出現在回答中。

【最高優先規則 — 違反等於失敗】
1. **單一資料來源**：只能引用下方知識庫的內容。訓練資料、外部知識、常識性建議都禁止寫進答案
2. **絕對禁止編造**知識庫沒寫的任何資訊（步驟、路徑、指令、人名、英文術語、軟體名稱、版本號、網址、設定值都不可以）
3. 若知識庫沒有相關內容，必須直接、完整回覆下面這句話然後停止：
   「目前知識庫沒有這方面的資訊，建議聯繫相關同事。」
   不要再多寫一個字，不要解釋、不要給通用建議、不要反問

【語言鐵則】
4. 全程使用 **繁體中文（台灣用語）**。**嚴禁使用簡體字**。範例對照：
   - ✅ 正確：設定、檔案、程式、伺服器、軟體、資料夾、視窗、登入、儲存、執行、按鈕、介面、網路、滑鼠、螢幕、印表機、預設、應用程式
   - ❌ 錯誤：设置、文件、程序、服务器、软件、文件夹、窗口、登录、保存、运行、按钮、界面、网络、鼠标、屏幕、打印机、默认、应用程序
5. 除非知識庫原文有英文，否則禁止自行加入英文單字（不可冒出 deploy、server、API、Step、admin、user 之類）

【其他規則】
6. 只回答使用者「當前」這一輪的問題，不要主動延伸、不要把無關文件混進答案
7. 過往對話歷史僅供語境參考，不要被牽回舊話題
8. 語氣友善專業，像一位熱心同事在做交接

【格式要求 — 每次都必須嚴格遵守】
- 回答開頭用 ### 標題 點出主題，標題後面必須空一行
- 問題描述用「**症狀：**」開頭，獨立一段，前後各空一行
- 解決步驟用「**解決方法：**」開頭，後面空一行，再接 1. 2. 3. 編號列表，每步驟獨立一行
- 每步驟只寫一件事
- 路徑、指令、帳號用 `行內程式碼` 包起來
- 較長指令用 ``` 程式碼區塊
- 關鍵字用 **粗體**
- 注意事項用 > 引用區塊，前後各空一行
- 段落、標題、列表、引用之間都必須用空行分隔
- 多個問題用 --- 分隔，前後各空一行

===== 知識庫內容（已挑選與當前問題最相關的部分） =====

{knowledge}

===== 知識庫結束 ====="""


def build_system_prompt(selected_docs: list[dict]) -> str:
    if not selected_docs:
        knowledge = "（知識庫為空）"
    else:
        knowledge = "\n\n---\n\n".join(
            f"=== 文件：{d['title']} ===\n\n{d['content']}" for d in selected_docs
        )
    return SYSTEM_PROMPT_TEMPLATE.format(knowledge=knowledge)


# ===== 對話歷史 =====
conversations: dict[str, list] = {}


def get_messages(session_id: str, user_msg: str) -> list:
    if session_id not in conversations:
        conversations[session_id] = []

    history = conversations[session_id]
    history.append({"role": "user", "content": user_msg})

    # 限制歷史長度
    if len(history) > 20:
        history = history[-20:]
        conversations[session_id] = history

    return history


# ===== API 路由 =====
@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    user_msg = body.get("message", "").strip()
    session_id = body.get("session_id", "default")

    if not user_msg:
        return JSONResponse({"error": "訊息不能為空"}, status_code=400)

    messages = get_messages(session_id, user_msg)

    # 簡易檢索：挑出最相關的文件
    selected_docs, top_score = retrieve_relevant_docs(user_msg, k=3, min_score=2)
    sources_payload = json.dumps([
        {"filename": d["filename"], "title": d["title"]} for d in selected_docs
    ], ensure_ascii=False)

    REJECT_REPLY = "目前知識庫沒有這方面的資訊，建議聯繫相關同事。"

    async def generate():
        # 先把來源推給前端
        yield f"data: [SOURCES] {sources_payload}\n\n"

        # 沒命中任何文件：直接回拒答，不交給 LLM 自由發揮
        if not selected_docs:
            for ch in REJECT_REPLY:
                yield f"data: {json.dumps(ch, ensure_ascii=False)}\n\n"
            conversations.setdefault(session_id, []).append(
                {"role": "assistant", "content": REJECT_REPLY}
            )
            yield "data: [DONE]\n\n"
            return

        system_prompt = build_system_prompt(selected_docs)

        full_response = ""
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_URL}/api/chat",
                    json={
                        "model": OLLAMA_MODEL,
                        "messages": [
                            {"role": "system", "content": system_prompt}
                        ] + messages,
                        "stream": True,
                        "options": {
                            "temperature": 0.1,    # 極低，幾乎只照知識庫照本宣科
                            "top_p": 0.8,
                            "repeat_penalty": 1.1,
                        },
                    },
                ) as response:
                    if response.status_code != 200:
                        body = await response.aread()
                        error_msg = body.decode("utf-8", errors="replace")
                        yield f"data: [ERROR] Ollama 回傳錯誤 ({response.status_code})：{error_msg}\n\n"
                        yield "data: [DONE]\n\n"
                        return
                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            data = json.loads(line)
                            token = data.get("message", {}).get("content", "")
                            if token:
                                token = to_traditional(token)  # 強制簡轉繁
                                full_response += token
                                yield f"data: {json.dumps(token, ensure_ascii=False)}\n\n"
                            if data.get("done", False):
                                break
                        except json.JSONDecodeError:
                            continue

            # 儲存回應到歷史
            conversations.setdefault(session_id, []).append(
                {"role": "assistant", "content": full_response}
            )
            yield "data: [DONE]\n\n"

        except httpx.ConnectError:
            yield "data: [ERROR] 無法連線到 Ollama。請確認 Ollama 已啟動（執行 `ollama serve`）。\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/api/health")
async def health():
    """檢查 Ollama 狀態"""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            res = await client.get(f"{OLLAMA_URL}/api/tags")
            if res.status_code == 200:
                models = [m.get("name", "") for m in res.json().get("models", [])]
                model_ready = any(OLLAMA_MODEL in m for m in models)
                return JSONResponse({
                    "ollama": "online",
                    "model": OLLAMA_MODEL,
                    "model_ready": model_ready,
                })
            return JSONResponse({"ollama": "error", "status_code": res.status_code})
    except Exception as e:
        return JSONResponse({"ollama": "offline", "error": str(e)})


@app.post("/api/clear")
async def clear_history(request: Request):
    body = await request.json()
    session_id = body.get("session_id", "default")
    conversations.pop(session_id, None)
    return JSONResponse({"status": "ok"})


@app.get("/api/knowledge/reload")
async def reload_knowledge():
    load_knowledge_base()
    return JSONResponse({"status": "ok", "doc_count": len(KB_DOCS)})


@app.get("/api/docs")
async def list_docs():
    return JSONResponse([
        {"filename": d["filename"], "title": d["title"]} for d in KB_DOCS
    ])


@app.get("/api/search")
async def search_docs(q: str = ""):
    q = q.strip().lower()
    if not q:
        return JSONResponse({"results": []})

    results = []
    for d in KB_DOCS:
        title_lower = d["title"].lower()
        content_lower = d["content"].lower()
        title_hit = q in title_lower
        content_hit = q in content_lower
        if not (title_hit or content_hit):
            continue

        snippet = ""
        if content_hit:
            idx = content_lower.find(q)
            start = max(0, idx - 30)
            end = min(len(d["content"]), idx + len(q) + 30)
            snippet = d["content"][start:end].replace("\n", " ").strip()
            if start > 0:
                snippet = "…" + snippet
            if end < len(d["content"]):
                snippet = snippet + "…"

        results.append({
            "filename": d["filename"],
            "title": d["title"],
            "title_hit": title_hit,
            "snippet": snippet,
        })

    return JSONResponse({"results": results})


@app.get("/api/docs/{filename}")
async def get_doc(filename: str):
    for d in KB_DOCS:
        if d["filename"] == filename:
            return JSONResponse({"title": d["title"], "content": d["content"]})
    return JSONResponse({"error": "找不到文件"}, status_code=404)


# ===== 靜態檔案 & 首頁 =====
app.mount("/css", StaticFiles(directory="css"), name="css")
app.mount("/js", StaticFiles(directory="js"), name="js")
app.mount("/videos", StaticFiles(directory="videos"), name="videos")


@app.get("/", response_class=HTMLResponse)
async def index():
    return Path("index.html").read_text(encoding="utf-8")


if __name__ == "__main__":
    import uvicorn

    print(f"知識庫已載入 {len(KB_DOCS)} 份文件")
    print(f"使用模型：{OLLAMA_MODEL}")
    print(f"Ollama 位址：{OLLAMA_URL}")
    print(f"啟動於 http://localhost:8080")
    uvicorn.run(app, host="0.0.0.0", port=8080)
