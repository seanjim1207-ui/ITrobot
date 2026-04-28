"""
自動為 docs/*.md 生成 keywords frontmatter。
用法：
    python gen_keywords.py             # 只補沒有 keywords 的檔案
    python gen_keywords.py --all       # 全部重新產生（覆蓋舊的）
    python gen_keywords.py --dry-run   # 只印出結果，不寫檔
"""
import os
import re
import sys
import json
import httpx
from pathlib import Path

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
DOCS_DIR = Path(__file__).parent / "docs"

PROMPT = """你是一個關鍵字產生助手。我會給你一份工作交接文件，請產出 6~10 個「使用者可能會用來提問」的中文關鍵字或口語短語。

要求：
1. 關鍵字要包含正式詞 + 口語詞（例如「印表機」也要列出「印不出來」「列印壞掉」）
2. 包含同義詞（例如「連線」「連接」「連網」）
3. 涵蓋這份文件主要解決的問題
4. 全部用繁體中文，禁用簡體
5. 輸出格式：用半形逗號分隔，不要加編號、不要加說明、不要換行
6. 只輸出關鍵字本身，不要任何前後綴

文件內容：
---
{content}
---

請直接輸出關鍵字列表（用 , 分隔）："""


def parse_frontmatter(raw: str):
    """回傳 (frontmatter_dict, content)"""
    m = re.match(r"^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$", raw)
    if not m:
        return {}, raw
    fm_text = m.group(1)
    body = m.group(2)
    fm = {}
    for line in fm_text.split("\n"):
        if ":" in line:
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip()
    return fm, body


def build_frontmatter(fm: dict) -> str:
    lines = ["---"]
    # 固定順序：title, keywords, 其他
    order = ["title", "keywords"]
    written = set()
    for k in order:
        if k in fm:
            lines.append(f"{k}: {fm[k]}")
            written.add(k)
    for k, v in fm.items():
        if k not in written:
            lines.append(f"{k}: {v}")
    lines.append("---")
    return "\n".join(lines) + "\n"


def call_ollama(content: str) -> str:
    """呼叫 Ollama 取得關鍵字"""
    prompt = PROMPT.format(content=content[:3000])  # 截斷避免過長
    res = httpx.post(
        f"{OLLAMA_URL}/api/generate",
        json={
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.3},
        },
        timeout=120.0,
    )
    res.raise_for_status()
    return res.json().get("response", "").strip()


def clean_keywords(raw: str) -> str:
    """整理 LLM 回傳的關鍵字字串"""
    # 拿掉換行、引號
    text = raw.replace("\n", " ").replace('"', "").replace("'", "").strip()
    # 把全形逗號 / 頓號統一成半形逗號
    text = text.replace("，", ",").replace("、", ",")
    # 拆開、去空白、去重
    parts = [p.strip() for p in text.split(",") if p.strip()]
    seen = set()
    result = []
    for p in parts:
        # 過濾太長 / 太短的
        if len(p) < 1 or len(p) > 20:
            continue
        if p in seen:
            continue
        seen.add(p)
        result.append(p)
    return ", ".join(result)


def process_file(md_path: Path, force: bool, dry_run: bool):
    raw = md_path.read_text(encoding="utf-8")
    fm, body = parse_frontmatter(raw)

    if "keywords" in fm and not force:
        print(f"⏭  {md_path.name}：已有 keywords，跳過（用 --all 強制覆蓋）")
        return

    if not body.strip():
        print(f"⚠  {md_path.name}：內容空白，跳過")
        return

    print(f"⏳ {md_path.name}：產生中...")
    try:
        raw_kw = call_ollama(body)
        keywords = clean_keywords(raw_kw)
    except Exception as e:
        print(f"❌ {md_path.name}：呼叫 Ollama 失敗 — {e}")
        return

    if not keywords:
        print(f"⚠  {md_path.name}：沒有抓到有效關鍵字")
        return

    fm["keywords"] = keywords
    new_content = build_frontmatter(fm) + body.lstrip("\n")

    if dry_run:
        print(f"✅ {md_path.name}：[DRY RUN] keywords = {keywords}")
    else:
        md_path.write_text(new_content, encoding="utf-8")
        print(f"✅ {md_path.name}：keywords = {keywords}")


def main():
    args = sys.argv[1:]
    force = "--all" in args
    dry_run = "--dry-run" in args

    if not DOCS_DIR.exists():
        print(f"找不到 docs 資料夾：{DOCS_DIR}")
        return

    md_files = sorted(DOCS_DIR.glob("*.md"))
    if not md_files:
        print("docs 裡沒有 md 檔")
        return

    print(f"📚 找到 {len(md_files)} 份文件，模型 = {OLLAMA_MODEL}")
    print(f"   模式：{'全部重產' if force else '只補缺少'}{'（DRY RUN，不寫檔）' if dry_run else ''}")
    print("-" * 50)

    for md in md_files:
        process_file(md, force, dry_run)

    print("-" * 50)
    print("完成")


if __name__ == "__main__":
    main()
