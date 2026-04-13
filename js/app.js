// ===== 工具 =====
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const uuid = () => crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);

// ===== 全域狀態 =====
const State = {
  sessionId: uuid(),
  streaming: false,
};

// =========================================================
//  莫比烏斯帶 Möbius Strip — Canvas 3D + 單光點彗星
// =========================================================
const Mobius = {
  canvas: null,
  ctx: null,
  typingTimer: null,
  angle: 0,
  speed: 0.008,
  targetSpeed: 0.008,
  glowAlpha: 0.12,
  targetGlowAlpha: 0.12,
  // 單光點
  orbU: 0,
  orbSpeed: 0.013,
  orbSpeedMul: 1,
  targetOrbSpeedMul: 1,
  // 拖尾歷史（儲存最近 N 幀位置）
  trail: [],
  trailMax: 18,

  // 統一琥珀色
  colorForU(t) {
    return [198, 119, 71];
  },

  // 莫比烏斯帶參數方程
  pt(u, v, R, w) {
    const h = u / 2;
    return [
      (R + w * v * Math.cos(h)) * Math.cos(u),
      (R + w * v * Math.cos(h)) * Math.sin(u),
      w * v * Math.sin(h),
    ];
  },

  proj(x, y, z, cx, cy, rY, rX) {
    const c1 = Math.cos(rY), s1 = Math.sin(rY);
    const c2 = Math.cos(rX), s2 = Math.sin(rX);
    const x1 = x * c1 - z * s1;
    const z1 = x * s1 + z * c1;
    const y1 = y * c2 - z1 * s2;
    const z2 = y * s2 + z1 * c2;
    const d = 400, sc = d / (d + z2);
    return { x: cx + x1 * sc, y: cy + y1 * sc, z: z2, sc };
  },

  init() {
    this.canvas = $("#mobius-canvas");
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.animate();
  },

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
  },

  animate() {
    this.speed += (this.targetSpeed - this.speed) * 0.04;
    this.glowAlpha += (this.targetGlowAlpha - this.glowAlpha) * 0.04;
    this.orbSpeedMul += (this.targetOrbSpeedMul - this.orbSpeedMul) * 0.04;
    this.angle += this.speed;

    // 更新光點
    this.orbU += this.orbSpeed * this.orbSpeedMul;
    if (this.orbU > Math.PI * 2) this.orbU -= Math.PI * 2;

    this.draw();
    requestAnimationFrame(() => this.animate());
  },

  draw() {
    const ctx = this.ctx;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const size = Math.min(this.w, this.h);
    const R = size * 0.28;
    const W = size * 0.10;
    const rotY = this.angle;
    const rotX = 0.5;
    const steps = 72;
    const vSteps = 5;

    ctx.clearRect(0, 0, this.w, this.h);

    // 背景光暈
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.6);
    bg.addColorStop(0, `rgba(232, 115, 74, ${this.glowAlpha * 0.5})`);
    bg.addColorStop(0.5, `rgba(244, 149, 108, ${this.glowAlpha * 0.2})`);
    bg.addColorStop(1, "transparent");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.w, this.h);

    // ── 收集面片 ──
    const faces = [];
    for (let i = 0; i < steps; i++) {
      const u0 = (i / steps) * Math.PI * 2;
      const u1 = ((i + 1) / steps) * Math.PI * 2;
      const uMid = (u0 + u1) / 2;

      // 光點照亮範圍（帶拖尾）
      let orbGlow = 0;
      // 正向差（光點前方）
      let diff = uMid - this.orbU;
      if (diff < 0) diff += Math.PI * 2;
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < 0.35) orbGlow = Math.max(orbGlow, 1 - diff / 0.35);
      // 拖尾方向（光點後方，範圍更大但更暗）
      let diffBack = this.orbU - uMid;
      if (diffBack < 0) diffBack += Math.PI * 2;
      if (diffBack > Math.PI) diffBack = Math.PI * 2 - diffBack;
      if (diffBack < 0.8) orbGlow = Math.max(orbGlow, (1 - diffBack / 0.8) * 0.45);

      // 橘色漸層 — 沿 u 變化
      const baseColor = this.colorForU(uMid / (Math.PI * 2));

      for (let j = 0; j < vSteps; j++) {
        const v0 = -1 + (j / vSteps) * 2;
        const v1 = -1 + ((j + 1) / vSteps) * 2;

        const p00 = this.pt(u0, v0, R, W);
        const p10 = this.pt(u1, v0, R, W);
        const p11 = this.pt(u1, v1, R, W);
        const p01 = this.pt(u0, v1, R, W);

        const s00 = this.proj(...p00, cx, cy, rotY, rotX);
        const s10 = this.proj(...p10, cx, cy, rotY, rotX);
        const s11 = this.proj(...p11, cx, cy, rotY, rotX);
        const s01 = this.proj(...p01, cx, cy, rotY, rotX);

        const avgZ = (s00.z + s10.z + s11.z + s01.z) / 4;

        // 法線光照
        const ax = p10[0]-p00[0], ay = p10[1]-p00[1], az = p10[2]-p00[2];
        const bx = p01[0]-p00[0], by = p01[1]-p00[1], bz = p01[2]-p00[2];
        const nx = ay*bz - az*by, ny = az*bx - ax*bz, nz = ax*by - ay*bx;
        const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
        const light = nx/nl*0.3 + ny/nl*-0.4 + nz/nl*0.85;
        const brightness = Math.max(0.18, Math.min(1, 0.45 + light * 0.55));

        faces.push({ pts: [s00, s10, s11, s01], z: avgZ, brightness, orbGlow, vIdx: j, vSteps, baseColor });
      }
    }

    faces.sort((a, b) => b.z - a.z);

    // ── 繪製面片 ──
    for (const f of faces) {
      const { pts, brightness, orbGlow, vIdx, vSteps: vs, baseColor } = f;

      const edgeFade = 1 - Math.abs(vIdx - (vs - 1) / 2) / ((vs - 1) / 2) * 0.3;
      const br = brightness * edgeFade;

      let [r, g, b] = baseColor;
      r = r * (0.5 + br * 0.5);
      g = g * (0.45 + br * 0.55);
      b = b * (0.38 + br * 0.62);
      let a = 0.45 + br * 0.45;

      // 光點照亮：往白色偏移
      if (orbGlow > 0) {
        const og = orbGlow * orbGlow;
        r = r + (255 - r) * og * 0.8;
        g = g + (240 - g) * og * 0.8;
        b = b + (220 - b) * og * 0.6;
        a = Math.min(1, a + og * 0.45);
      }

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.lineTo(pts[2].x, pts[2].y);
      ctx.lineTo(pts[3].x, pts[3].y);
      ctx.closePath();

      ctx.fillStyle = `rgba(${r|0}, ${g|0}, ${b|0}, ${a.toFixed(3)})`;
      ctx.fill();

      ctx.strokeStyle = `rgba(230, 190, 150, ${(0.05 + br * 0.12).toFixed(3)})`;
      ctx.lineWidth = 0.3;
      ctx.stroke();
    }

    // ── 光點 ──
    const orbPt = this.pt(this.orbU, 0, R, W);
    const orbS = this.proj(...orbPt, cx, cy, rotY, rotX);
    this.trail.push({ x: orbS.x, y: orbS.y, sc: orbS.sc });
    if (this.trail.length > this.trailMax) this.trail.shift();

    // 拖尾：漸層線條（連續路徑而非散點）
    if (this.trail.length > 2) {
      for (let i = 1; i < this.trail.length; i++) {
        const prev = this.trail[i - 1];
        const cur = this.trail[i];
        const progress = i / this.trail.length;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(cur.x, cur.y);
        ctx.strokeStyle = `rgba(255, 225, 190, ${(progress * 0.5).toFixed(3)})`;
        ctx.lineWidth = progress * 3.5;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }

    // 脈動係數
    const pulse = 0.85 + 0.15 * Math.sin(this.angle * 8);
    const orbR = (3.5 + 3 * orbS.sc) * pulse;

    // 第一層：大範圍柔光（氛圍）
    const glowR1 = orbR * 10;
    const ga = ctx.createRadialGradient(orbS.x, orbS.y, 0, orbS.x, orbS.y, glowR1);
    ga.addColorStop(0, `rgba(255, 200, 150, ${(0.18 * pulse).toFixed(3)})`);
    ga.addColorStop(0.3, "rgba(232, 115, 74, 0.05)");
    ga.addColorStop(1, "rgba(232, 115, 74, 0)");
    ctx.fillStyle = ga;
    ctx.fillRect(orbS.x - glowR1, orbS.y - glowR1, glowR1 * 2, glowR1 * 2);

    // 第二層：中光暈
    const glowR2 = orbR * 4.5;
    const gb = ctx.createRadialGradient(orbS.x, orbS.y, 0, orbS.x, orbS.y, glowR2);
    gb.addColorStop(0, "rgba(255, 240, 220, 0.55)");
    gb.addColorStop(0.35, "rgba(255, 180, 120, 0.18)");
    gb.addColorStop(1, "rgba(232, 115, 74, 0)");
    ctx.fillStyle = gb;
    ctx.beginPath();
    ctx.arc(orbS.x, orbS.y, glowR2, 0, Math.PI * 2);
    ctx.fill();

    // 第三層：核心亮點
    const gc = ctx.createRadialGradient(orbS.x, orbS.y, 0, orbS.x, orbS.y, orbR);
    gc.addColorStop(0, "rgba(255, 255, 255, 1)");
    gc.addColorStop(0.2, "rgba(255, 250, 240, 0.95)");
    gc.addColorStop(0.5, "rgba(255, 220, 180, 0.6)");
    gc.addColorStop(1, "rgba(255, 180, 120, 0)");
    ctx.beginPath();
    ctx.arc(orbS.x, orbS.y, orbR, 0, Math.PI * 2);
    ctx.fillStyle = gc;
    ctx.fill();

    // 第四層：十字光芒（lens flare）
    ctx.save();
    ctx.globalAlpha = 0.25 * pulse;
    ctx.strokeStyle = "rgba(255, 245, 230, 0.7)";
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    const flareLen = orbR * 5;
    ctx.beginPath();
    ctx.moveTo(orbS.x - flareLen, orbS.y);
    ctx.lineTo(orbS.x + flareLen, orbS.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(orbS.x, orbS.y - flareLen);
    ctx.lineTo(orbS.x, orbS.y + flareLen);
    ctx.stroke();
    ctx.restore();
  },

  // === 狀態控制 ===
  onTyping() {
    clearTimeout(this.typingTimer);
    this.targetSpeed = 0.03;
    this.targetGlowAlpha = 0.22;
    this.targetOrbSpeedMul = 2.5;
    this.typingTimer = setTimeout(() => {
      if (!State.streaming) this.toIdle();
    }, 1500);
  },

  toAnswer() {
    clearTimeout(this.typingTimer);
    this.targetSpeed = 0.055;
    this.targetGlowAlpha = 0.38;
    this.targetOrbSpeedMul = 4;
  },

  onStreamDone() {
    this.toIdle();
  },

  toIdle() {
    clearTimeout(this.typingTimer);
    this.targetSpeed = 0.008;
    this.targetGlowAlpha = 0.12;
    this.targetOrbSpeedMul = 1;
  },
};

// 相容舊名稱
const Ouroboros = Mobius;
const Video = Mobius;

// =========================================================
//  打字互動效果
// =========================================================
const Particles = {
  container: $("#particles"),
  colors: ["#e8734a", "#f4956c", "#ffd4b0", "#ffffff", "#ffb88c"],

  spawn(x) {
    const count = 2 + Math.floor(Math.random() * 3); // 2~4 顆
    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      el.className = "particle";
      el.style.left = (x + (Math.random() - 0.5) * 24) + "px";
      el.style.bottom = "0";
      const c = this.colors[Math.floor(Math.random() * this.colors.length)];
      el.style.background = c;
      el.style.color = c;
      const size = 2 + Math.random() * 2.5;
      el.style.width = size + "px";
      el.style.height = size + "px";
      el.style.animationDuration = (0.8 + Math.random() * 0.5) + "s";
      this.container.appendChild(el);
      setTimeout(() => el.remove(), 1400);
    }
  },
};

const InputFX = {
  box: $("#input-box"),
  glowTimer: null,

  bounce() {
    this.box.classList.add("bounce");
    setTimeout(() => this.box.classList.remove("bounce"), 100);
  },

  glow(on) {
    if (on) {
      this.box.classList.add("glow");
      clearTimeout(this.glowTimer);
      this.glowTimer = setTimeout(() => this.box.classList.remove("glow"), 800);
    } else {
      this.box.classList.remove("glow");
    }
  },

  onKey(e) {
    if (e.key === "Enter" || e.key === "Shift") return;
    this.bounce();
    this.glow(true);
    const rect = this.box.getBoundingClientRect();
    Particles.spawn(Math.random() * rect.width);
    Ouroboros.onTyping();
  },
};

// =========================================================
//  訊息渲染
// =========================================================
const Msg = {
  container: $("#messages"),

  escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  },

  addUser(text) {
    const el = document.createElement("div");
    el.className = "message user-msg";
    el.innerHTML = `
      <div class="msg-avatar user">你</div>
      <div class="msg-body">
        <div class="msg-name">你</div>
        <div class="msg-content">${this.escapeHtml(text)}</div>
      </div>`;
    this.container.appendChild(el);
    this.scroll();
  },

  addThinking() {
    const el = document.createElement("div");
    el.className = "message bot-msg";
    el.id = "thinking";
    el.innerHTML = `
      <div class="msg-avatar bot"><svg viewBox="0 0 32 32" width="20" height="20"><defs><linearGradient id="wave-g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#ffd4b0"/></linearGradient></defs><path d="M4 18 C7 12, 10 12, 13 16 S19 22, 22 16 S25 10, 28 14" fill="none" stroke="url(#wave-g)" stroke-width="2.8" stroke-linecap="round"/><circle cx="28" cy="14" r="1.8" fill="#fff" opacity="0.9"/></svg></div>
      <div class="msg-body">
        <div class="msg-name">波</div>
        <div class="msg-content">
          <div class="thinking-dots"><span></span><span></span><span></span></div>
        </div>
      </div>`;
    this.container.appendChild(el);
    this.scroll();
  },

  removeThinking() {
    const el = $("#thinking");
    if (el) el.remove();
  },

  addBotStream() {
    const el = document.createElement("div");
    el.className = "message bot-msg";
    el.id = "stream-msg";
    el.innerHTML = `
      <div class="msg-avatar bot"><svg viewBox="0 0 32 32" width="20" height="20"><defs><linearGradient id="wave-g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#ffd4b0"/></linearGradient></defs><path d="M4 18 C7 12, 10 12, 13 16 S19 22, 22 16 S25 10, 28 14" fill="none" stroke="url(#wave-g)" stroke-width="2.8" stroke-linecap="round"/><circle cx="28" cy="14" r="1.8" fill="#fff" opacity="0.9"/></svg></div>
      <div class="msg-body">
        <div class="msg-name">波</div>
        <div class="msg-content"><span class="streaming-cursor"></span></div>
      </div>`;
    this.container.appendChild(el);
    this.scroll();
    return el.querySelector(".msg-content");
  },

  scroll() {
    const c = $("#chat-scroll");
    c.scrollTop = c.scrollHeight;
  },
};

// =========================================================
//  知識庫文件瀏覽
// =========================================================
const Docs = {
  list: $("#docs-list"),
  viewer: $("#doc-viewer"),
  viewerTitle: $("#doc-viewer-title"),
  viewerBody: $("#doc-viewer-body"),
  chatScroll: $("#chat-scroll"),
  inputArea: null,
  currentFile: null,

  async loadList() {
    try {
      const res = await fetch("/api/docs");
      const docs = await res.json();
      this.list.innerHTML = "";
      docs.forEach((doc) => {
        const el = document.createElement("div");
        el.className = "doc-item";
        el.innerHTML = `<span class="doc-dot"></span><span>${doc.title}</span>`;
        el.addEventListener("click", () => { this.open(doc.filename, doc.title, el); Mode.set("docs"); });
        this.list.appendChild(el);
      });
    } catch (e) {
      this.list.innerHTML = `<div style="padding:12px;color:var(--text-dim);font-size:13px;">無法載入文件列表</div>`;
    }
  },

  // 開啟指定文件
  async open(filename, title, itemEl) {
    this.currentFile = filename;
    $$(".doc-item").forEach((el) => el.classList.remove("active"));
    if (itemEl) itemEl.classList.add("active");

    this.viewerTitle.textContent = title;
    this.viewerBody.innerHTML = `<div class="thinking-dots" style="padding:20px 0;"><span></span><span></span><span></span></div>`;

    this.viewer.classList.remove("hidden");
    this.chatScroll.style.display = "none";
    if (!this.inputArea) this.inputArea = document.querySelector(".input-area");
    this.inputArea.style.display = "none";

    try {
      const res = await fetch(`/api/docs/${encodeURIComponent(filename)}`);
      const data = await res.json();
      this.viewerBody.innerHTML = marked.parse(data.content);
    } catch (e) {
      this.viewerBody.innerHTML = `<p style="color:#f87171;">載入失敗：${e.message}</p>`;
    }
  },

  // 切回聊天模式
  toChat() {
    this.currentFile = null;
    this.viewer.classList.add("hidden");
    this.chatScroll.style.display = "";
    if (!this.inputArea) this.inputArea = document.querySelector(".input-area");
    this.inputArea.style.display = "";
    $$(".doc-item").forEach((el) => el.classList.remove("active"));
    Mode.set("chat");
  },
};

// =========================================================
//  模式切換（對話 / 文件）
// =========================================================
const Mode = {
  btn: null,
  current: "chat", // "chat" or "docs"

  init() {
    this.btn = $("#mode-btn");
    this.btn.addEventListener("click", () => this.toggle());
  },

  toggle() {
    if (this.current === "chat") {
      this.set("docs");
      // 顯示文件模式：如果側邊欄有文件，自動開第一份
      const firstDoc = document.querySelector(".doc-item");
      if (firstDoc && !Docs.currentFile) firstDoc.click();
    } else {
      Docs.toChat();
    }
  },

  set(mode) {
    this.current = mode;
    this.btn.dataset.mode = mode;
    const label = this.btn.querySelector(".mode-label");
    const iconDocs = this.btn.querySelector(".icon-docs");
    const iconChat = this.btn.querySelector(".icon-chat");
    if (mode === "docs") {
      label.textContent = "對話";
      iconDocs.style.display = "none";
      iconChat.style.display = "";
    } else {
      label.textContent = "文件";
      iconDocs.style.display = "";
      iconChat.style.display = "none";
    }
  },
};

// =========================================================
//  核心：送出訊息 + 串流接收
// =========================================================
async function sendMessage(text) {
  if (State.streaming || !text.trim()) return;
  State.streaming = true;

  // 隱藏歡迎畫面
  const welcome = $("#welcome");
  if (welcome) welcome.classList.add("hidden");

  // 使用者訊息
  Msg.addUser(text);

  // 如果正在看文件，自動關閉回到聊天
  if (Docs.currentFile) Docs.toChat();

  // 思考中 + 切換影片
  Msg.addThinking();
  Video.toAnswer();
  updateSendBtn();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, session_id: State.sessionId }),
    });

    Msg.removeThinking();
    const contentEl = Msg.addBotStream();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);

        if (data === "[DONE]") {
          // 完成：渲染最終 markdown，移除游標
          contentEl.innerHTML = marked.parse(fullText);
          Video.onStreamDone();
          break;
        }

        if (data.startsWith("[ERROR]")) {
          fullText += data.slice(8);
          contentEl.innerHTML = `<p style="color:#f87171;">${Msg.escapeHtml(fullText)}</p>`;
          Video.onStreamDone();
          break;
        }

        try { fullText += JSON.parse(data); } catch { fullText += data; }
        contentEl.innerHTML = marked.parse(fullText) + '<span class="streaming-cursor"></span>';
        Msg.scroll();
      }
    }
  } catch (err) {
    Msg.removeThinking();
    const contentEl = Msg.addBotStream();
    contentEl.innerHTML = `<p style="color:#f87171;">連線錯誤：${Msg.escapeHtml(err.message)}。請確認伺服器與 Ollama 已啟動。</p>`;
    Video.onStreamDone();
  }

  State.streaming = false;
  updateSendBtn();
  $("#user-input").focus();
}

// =========================================================
//  新對話
// =========================================================
function newChat() {
  // 清後端歷史
  fetch("/api/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: State.sessionId }),
  }).catch(() => {});

  State.sessionId = uuid();
  $("#messages").innerHTML = "";
  const welcome = $("#welcome");
  if (welcome) welcome.classList.remove("hidden");
  if (Docs.currentFile) Docs.toChat();
}

// =========================================================
//  輸入控制
// =========================================================
function updateSendBtn() {
  const btn = $("#send-btn");
  const input = $("#user-input");
  btn.disabled = input.value.trim().length === 0 || State.streaming;
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 140) + "px";
}

// =========================================================
//  初始化
// =========================================================
document.addEventListener("DOMContentLoaded", () => {
  // marked 設定：單一換行也產生 <br>，讓 LLM 回覆可讀
  marked.setOptions({ breaks: true, gfm: true });

  Video.init();

  const input = $("#user-input");

  // 輸入
  input.addEventListener("input", () => {
    autoResize(input);
    updateSendBtn();
  });

  // 打字效果
  input.addEventListener("keydown", (e) => {
    InputFX.onKey(e);

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = input.value.trim();
      if (text && !State.streaming) {
        input.value = "";
        input.style.height = "auto";
        InputFX.glow(false);
        updateSendBtn();
        sendMessage(text);
      }
    }
  });

  // 送出按鈕
  $("#send-btn").addEventListener("click", () => {
    const text = input.value.trim();
    if (text && !State.streaming) {
      input.value = "";
      input.style.height = "auto";
      InputFX.glow(false);
      updateSendBtn();
      sendMessage(text);
    }
  });

  // 建議按鈕
  $$(".suggest-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!State.streaming) sendMessage(btn.dataset.q);
    });
  });

  // 側邊欄開合
  $("#toggle-sidebar").addEventListener("click", () => {
    $("#sidebar").classList.toggle("collapsed");
  });

  // 模式切換
  Mode.init();

  // 載入知識庫文件列表
  Docs.loadList();
});
