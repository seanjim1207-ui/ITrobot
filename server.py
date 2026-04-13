import os
import re
import json
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import httpx

app = FastAPI()

# ===== 設定 =====
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3")
DOCS_DIR = Path(__file__).parent / "docs"


# ===== 知識庫載入 =====
def load_knowledge_base() -> str:
    """掃描 docs/*.md，解析 frontmatter，組合成 system prompt"""
    if not DOCS_DIR.exists():
        return ""

    sections = []
    for md_file in sorted(DOCS_DIR.glob("*.md")):
        raw = md_file.read_text(encoding="utf-8")
        title = md_file.stem
        content = raw

        # 解析 YAML frontmatter
        fm_match = re.match(r"^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$", raw)
        if fm_match:
            fm_text = fm_match.group(1)
            content = fm_match.group(2)
            title_match = re.search(r"title:\s*(.+)", fm_text)
            if title_match:
                title = title_match.group(1).strip()

        sections.append(f"=== 文件：{title} ===\n\n{content.strip()}")

    return "\n\n---\n\n".join(sections)


KNOWLEDGE = load_knowledge_base()

SYSTEM_PROMPT = f"""你是一個工作交接問答機器人。你的任務是根據以下知識庫內容，回答使用者的問題。

規則：
1. 只根據知識庫中的資訊回答，不要編造不存在的內容
2. 如果知識庫中沒有相關資訊，請誠實告知並建議使用者聯繫相關同事
3. 語氣友善專業，像一位熱心的同事在做交接
4. 如果問題涉及多個主題，整合相關資訊一起回答
5. 使用繁體中文回答

格式要求（極度重要，每次回答都必須嚴格遵守，違反格式等於回答錯誤）：
- 回答開頭用 ### 標題 點出主題，標題後面必須空一行
- 問題描述用「**症狀：**」開頭，獨立一段，前後必須各空一行
- 解決步驟用「**解決方法：**」開頭，後面必須空一行，接著用數字編號列表（1. 2. 3.），每個步驟獨立一行
- 每個步驟只寫一件事，不要把多個動作塞在同一步
- 重要的路徑、指令、帳號必須用 `行內程式碼` 包起來
- 較長的指令單獨用程式碼區塊（```）包裹
- 關鍵字用 **粗體** 強調
- 注意事項或提醒用 > 引用區塊，前後必須各空一行
- ★ 最重要：每個段落、標題、列表、引用之間必須用空行（兩個換行符）分隔。絕對不能連續輸出不同段落而中間沒有空行
- 禁止把所有內容寫成一大段文字，必須分段、分點
- 如果涉及多個問題，每個問題用 --- 分隔，--- 前後必須各空一行

範例格式：
### C槽空間不足

**症狀：** 同事反映C槽滿了，不知道該刪什麼

**解決方法：**
1. 開啟路徑 `S:\檢測軟體\硬碟空間\SpaceSniffer`
2. 滑鼠右鍵「**以系統管理員身分執行**」
3. 開啟資料夾找到佔用空間的位置，手動刪除

> 注意：通常 `.cache` 命名的資料夾可以安全刪除

===== 知識庫內容 =====

{KNOWLEDGE}

===== 知識庫結束 ====="""


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

    async def generate():
        full_response = ""
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_URL}/api/chat",
                    json={
                        "model": OLLAMA_MODEL,
                        "messages": [
                            {"role": "system", "content": SYSTEM_PROMPT}
                        ] + messages,
                        "stream": True,
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
                                full_response += token
                                yield f"data: {json.dumps(token)}\n\n"
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


@app.post("/api/clear")
async def clear_history(request: Request):
    body = await request.json()
    session_id = body.get("session_id", "default")
    conversations.pop(session_id, None)
    return JSONResponse({"status": "ok"})


@app.get("/api/knowledge/reload")
async def reload_knowledge():
    global KNOWLEDGE, SYSTEM_PROMPT
    KNOWLEDGE = load_knowledge_base()
    # 重建 system prompt
    SYSTEM_PROMPT_TPL = """你是一個工作交接問答機器人。你的任務是根據以下知識庫內容，回答使用者的問題。

規則：
1. 只根據知識庫中的資訊回答，不要編造不存在的內容
2. 如果知識庫中沒有相關資訊，請誠實告知並建議使用者聯繫相關同事
3. 語氣友善專業，像一位熱心的同事在做交接
4. 如果問題涉及多個主題，整合相關資訊一起回答
5. 使用繁體中文回答

格式要求（極度重要，每次回答都必須嚴格遵守，違反格式等於回答錯誤）：
- 回答開頭用 ### 標題 點出主題，標題後面必須空一行
- 問題描述用「**症狀：**」開頭，獨立一段，前後必須各空一行
- 解決步驟用「**解決方法：**」開頭，後面必須空一行，接著用數字編號列表（1. 2. 3.），每個步驟獨立一行
- 每個步驟只寫一件事，不要把多個動作塞在同一步
- 重要的路徑、指令、帳號必須用 `行內程式碼` 包起來
- 較長的指令單獨用程式碼區塊（```）包裹
- 關鍵字用 **粗體** 強調
- 注意事項或提醒用 > 引用區塊，前後必須各空一行
- ★ 最重要：每個段落、標題、列表、引用之間必須用空行（兩個換行符）分隔。絕對不能連續輸出不同段落而中間沒有空行
- 禁止把所有內容寫成一大段文字，必須分段、分點
- 如果涉及多個問題，每個問題用 --- 分隔，--- 前後必須各空一行

範例格式：
### C槽空間不足

**症狀：** 同事反映C槽滿了，不知道該刪什麼

**解決方法：**
1. 開啟路徑 `S:\檢測軟體\硬碟空間\SpaceSniffer`
2. 滑鼠右鍵「**以系統管理員身分執行**」
3. 開啟資料夾找到佔用空間的位置，手動刪除

> 注意：通常 `.cache` 命名的資料夾可以安全刪除

===== 知識庫內容 =====

{knowledge}

===== 知識庫結束 ====="""
    SYSTEM_PROMPT = SYSTEM_PROMPT_TPL.format(knowledge=KNOWLEDGE)
    doc_count = len(list(DOCS_DIR.glob("*.md")))
    return JSONResponse({"status": "ok", "doc_count": doc_count})


# ===== 靜態檔案 & 首頁 =====
app.mount("/css", StaticFiles(directory="css"), name="css")
app.mount("/js", StaticFiles(directory="js"), name="js")
app.mount("/videos", StaticFiles(directory="videos"), name="videos")


@app.get("/", response_class=HTMLResponse)
async def index():
    return Path("index.html").read_text(encoding="utf-8")


if __name__ == "__main__":
    import uvicorn

    print(f"知識庫已載入 {len(list(DOCS_DIR.glob('*.md')))} 份文件")
    print(f"使用模型：{OLLAMA_MODEL}")
    print(f"Ollama 位址：{OLLAMA_URL}")
    print(f"啟動於 http://localhost:8080")
    uvicorn.run(app, host="0.0.0.0", port=8080)
