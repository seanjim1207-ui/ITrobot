"""
把 docs/*.md 中以 ### 為小節分隔的大檔，拆成「一節 = 一檔」的多個小檔。

每個新檔的 frontmatter：
- title    : 來自 ### 子標題
- keywords : 從「症狀」內容 + 子標題自動提取（之後可再跑 gen_keywords.py 加強）

用法：
    python split_docs.py                    # 拆所有 docs/*.md，輸出到 docs/_split/
    python split_docs.py example-deploy.md  # 只拆指定檔案
    python split_docs.py --dry-run          # 只預覽，不寫檔
    python split_docs.py --replace          # 拆完後刪除原檔（小心！）
"""
import re
import sys
from pathlib import Path

DOCS_DIR = Path(__file__).parent / "docs"
OUTPUT_DIR = DOCS_DIR / "_split"


def parse_frontmatter(raw: str):
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


def split_by_h3(body: str):
    """以 ### 切段；回傳 [(title, content), ...]"""
    pattern = re.compile(r"^###\s+(.+?)$", re.MULTILINE)
    matches = list(pattern.finditer(body))
    if not matches:
        return []

    sections = []
    for i, m in enumerate(matches):
        title = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        content = body[start:end].strip()
        # 去掉段尾常見的 --- 分隔線
        content = re.sub(r"\n*---+\s*$", "", content).strip()
        sections.append((title, content))
    return sections


def extract_symptom(content: str) -> str:
    """從內文抓 **症狀：** 後面的描述"""
    m = re.search(r"\*\*\s*症狀\s*[:：]\s*\*\*\s*([^\n]+)", content)
    if m:
        return m.group(1).strip()
    return ""


def extract_keywords(title: str, symptom: str, content: str) -> str:
    """智能組合 keywords：標題 + 症狀句 + 內文中括號標註的軟體/硬體名"""
    parts = set()

    # 1. 標題本身
    if title:
        parts.add(title)

    # 2. 症狀句的關鍵詞（簡單斷句）
    if symptom:
        parts.add(symptom)
        # 抽出可能是名詞短語的部分（2~6 個中文字）
        for chunk in re.findall(r"[一-鿿]{2,6}", symptom):
            if chunk not in {"同事", "員工", "為什麼", "如何", "怎麼", "處理", "解決"}:
                parts.add(chunk)

    # 3. 內文中的軟體名 / 路徑 / 英文工具名
    for tool in re.findall(r"[A-Za-z][A-Za-z0-9._-]{2,}", content):
        if len(tool) >= 3 and tool.lower() not in {"the", "and", "for"}:
            parts.add(tool)

    # 4. 內文中括號或引號內的詞
    for m in re.findall(r'["「『]([^"」』]{2,12})["」』]', content):
        parts.add(m.strip())

    # 整理：去空白、去重、按長度排序（短的優先）
    cleaned = sorted({p.strip() for p in parts if p.strip()}, key=lambda x: (len(x), x))
    return ", ".join(cleaned[:15])  # 最多 15 個


def build_frontmatter(title: str, keywords: str) -> str:
    return f"---\ntitle: {title}\nkeywords: {keywords}\n---\n\n"


def slugify(text: str) -> str:
    """把標題轉成檔名（保留中文，去除特殊字元）"""
    s = re.sub(r"[\\/:*?\"<>|]", "", text)  # 移除檔名禁用字元
    s = s.strip().replace(" ", "-")
    return s[:50] or "untitled"


def process_file(md_path: Path, dry_run: bool, replace: bool):
    raw = md_path.read_text(encoding="utf-8")
    fm, body = parse_frontmatter(raw)

    sections = split_by_h3(body)
    if not sections:
        print(f"⏭  {md_path.name}：沒有找到 ### 子標題，跳過")
        return

    out_dir = OUTPUT_DIR / md_path.stem
    if not dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n📄 {md_path.name}：找到 {len(sections)} 個小節")

    for i, (title, content) in enumerate(sections, 1):
        symptom = extract_symptom(content)
        keywords = extract_keywords(title, symptom, content)
        new_content = build_frontmatter(title, keywords) + content + "\n"

        out_name = f"{i:02d}-{slugify(title)}.md"
        out_path = out_dir / out_name

        if dry_run:
            print(f"  [DRY] {out_name}")
            print(f"        title:    {title}")
            print(f"        keywords: {keywords}")
        else:
            out_path.write_text(new_content, encoding="utf-8")
            print(f"  ✅ {out_name}")

    if replace and not dry_run:
        md_path.unlink()
        print(f"  🗑  已刪除原檔 {md_path.name}")


def main():
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    replace = "--replace" in args
    targets = [a for a in args if not a.startswith("--")]

    if not DOCS_DIR.exists():
        print(f"找不到 docs 資料夾：{DOCS_DIR}")
        return

    if targets:
        files = [DOCS_DIR / t for t in targets if (DOCS_DIR / t).exists()]
    else:
        files = sorted(DOCS_DIR.glob("*.md"))

    if not files:
        print("沒有找到要處理的 md 檔")
        return

    print(f"模式：{'DRY RUN（不寫檔）' if dry_run else '正式執行'}{'（會刪除原檔）' if replace else ''}")
    print(f"輸出位置：{OUTPUT_DIR}")
    print("=" * 60)

    for md in files:
        process_file(md, dry_run, replace)

    print("\n" + "=" * 60)
    print("完成！")
    print("\n下一步建議：")
    print("  1. 檢查 docs/_split/ 內容是否正確")
    print("  2. 滿意的話：把 _split/ 內檔案移到 docs/ 並刪除原檔")
    print("  3. 跑 python gen_keywords.py 強化 keywords（用 LLM 補同義詞）")
    print("  4. 重啟 server.py")


if __name__ == "__main__":
    main()
