// ===== 工具 =====
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const uuid = () => crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);

// ===== 全域狀態 =====
const State = {
  sessionId: uuid(),
  streaming: false,
  abortController: null,
};

// ===== 打字機（逐字顯示） =====
const Typewriter = {
  buffer: "",
  displayed: "",
  contentEl: null,
  timer: null,
  charsPerTick: 1,   // 每 tick 顯示幾個字
  tickMs: 22,        // tick 間隔（ms），越大越慢

  start(contentEl) {
    this.reset();
    this.contentEl = contentEl;
  },

  append(text) {
    this.buffer += text;
    if (!this.timer) this.run();
  },

  run() {
    this.timer = setInterval(() => {
      if (!this.contentEl) { this.stop(); return; }
      const remaining = this.buffer.length - this.displayed.length;
      if (remaining <= 0) {
        this.stop();
        return;
      }
      // 若後端一次給很多（緩衝堆積），加快吐字避免延遲感
      const step = remaining > 80 ? 3 : (remaining > 30 ? 2 : this.charsPerTick);
      this.displayed = this.buffer.slice(0, this.displayed.length + step);
      this.render();
    }, this.tickMs);
  },

  render() {
    if (!this.contentEl) return;
    this.contentEl.innerHTML = marked.parse(this.displayed) + '<span class="streaming-cursor"></span>';
    Msg.scroll();
  },

  // 立刻把剩下全部吐完（完成或中斷時用）
  flush() {
    if (this.contentEl) {
      this.displayed = this.buffer;
      this.contentEl.innerHTML = marked.parse(this.displayed);
    }
    this.stop();
  },

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  },

  reset() {
    this.stop();
    this.buffer = "";
    this.displayed = "";
    this.contentEl = null;
  },
};

// ===== 建議問題：從知識庫標題衍生 =====
const FollowupEngine = {
  recentlyUsed: [],  // 避免短時間重複

  // 把標題包裝成自然問句
  phraseAsQuestion(title) {
    const templates = [
      (t) => `${t} 怎麼處理？`,
      (t) => `想了解 ${t} 的流程`,
      (t) => `${t} 有什麼要注意的？`,
      (t) => `${t} 該怎麼做？`,
      (t) => `能說明一下 ${t} 嗎？`,
    ];
    const tpl = templates[Math.floor(Math.random() * templates.length)];
    return tpl(title);
  },

  pick(currentQuestion = "") {
    const docs = (Docs.allDocs || []).filter((d) => d && d.title);
    if (docs.length === 0) {
      // 知識庫還沒載入：用 fallback
      return "能再講得更詳細一點嗎？";
    }

    // 過濾掉：近期用過的、跟目前提問標題一樣的
    const cq = currentQuestion.toLowerCase();
    let pool = docs.filter((d) => {
      const t = d.title;
      if (this.recentlyUsed.includes(t)) return false;
      if (cq && cq.includes(t.toLowerCase())) return false;
      return true;
    });

    if (pool.length === 0) {
      this.recentlyUsed = [];
      pool = docs;
    }

    const pick = pool[Math.floor(Math.random() * pool.length)];
    this.recentlyUsed.push(pick.title);
    if (this.recentlyUsed.length > 5) this.recentlyUsed.shift();

    return this.phraseAsQuestion(pick.title);
  },
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

  // 高級漸層色帶 — 平滑多色帶漸變
  colorForU(t) {
    // t: 0~1 沿莫比烏斯帶一圈
    // 琥珀 → 珊瑚 → 玫瑰金 → 深銅 → 琥珀（循環）
    const stops = [
      { at: 0.00, c: [198, 130, 80]  },  // 暖琥珀
      { at: 0.25, c: [220, 110, 65]  },  // 珊瑚
      { at: 0.45, c: [195, 105, 95]  },  // 玫瑰金
      { at: 0.65, c: [170, 95, 75]   },  // 深銅
      { at: 0.85, c: [210, 125, 70]  },  // 暖橘
      { at: 1.00, c: [198, 130, 80]  },  // 回到琥珀
    ];

    // 環形處理：確保 t 永遠落在 [0, 1) 內，首尾無縫
    t = ((t % 1) + 1) % 1;

    // 找到 t 所在的區段並插值
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i].at && t <= stops[i + 1].at) {
        const span = stops[i + 1].at - stops[i].at;
        const p = span > 0 ? (t - stops[i].at) / span : 0;
        const smooth = p * p * (3 - 2 * p); // smoothstep
        const c0 = stops[i].c, c1 = stops[i + 1].c;
        return [
          c0[0] + (c1[0] - c0[0]) * smooth,
          c0[1] + (c1[1] - c0[1]) * smooth,
          c0[2] + (c1[2] - c0[2]) * smooth,
        ];
      }
    }
    return stops[0].c;
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
        const light = Math.abs(nx/nl*0.3 + ny/nl*-0.4 + nz/nl*0.85);
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
      <div class="msg-avatar bot"><svg viewBox="0 0 32 32" width="20" height="20"><defs><linearGradient id="av-wg" x1="0" y1="16" x2="32" y2="16" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fff"/><stop offset="50%" stop-color="#ffd4b0"/><stop offset="100%" stop-color="#fff"/></linearGradient></defs><path d="M4 16C8 8,12 8,16 16S24 24,28 16" fill="none" stroke="url(#av-wg)" stroke-width="2.8" stroke-linecap="round"/><circle cx="28" cy="16" r="2" fill="#fff" opacity="0.95"/><circle cx="28" cy="16" r="3.5" fill="none" stroke="#fff" opacity="0.3" stroke-width="0.8"/></svg></div>
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
      <div class="msg-avatar bot"><svg viewBox="0 0 32 32" width="20" height="20"><defs><linearGradient id="av-wg" x1="0" y1="16" x2="32" y2="16" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fff"/><stop offset="50%" stop-color="#ffd4b0"/><stop offset="100%" stop-color="#fff"/></linearGradient></defs><path d="M4 16C8 8,12 8,16 16S24 24,28 16" fill="none" stroke="url(#av-wg)" stroke-width="2.8" stroke-linecap="round"/><circle cx="28" cy="16" r="2" fill="#fff" opacity="0.95"/><circle cx="28" cy="16" r="3.5" fill="none" stroke="#fff" opacity="0.3" stroke-width="0.8"/></svg></div>
      <div class="msg-body">
        <div class="msg-name">波</div>
        <div class="msg-content"><span class="streaming-cursor"></span></div>
      </div>`;
    this.container.appendChild(el);
    this.scroll();
    return el.querySelector(".msg-content");
  },

  addSources(contentEl, sources) {
    const msgBody = contentEl.closest(".msg-body");
    if (!msgBody || !sources || sources.length === 0) return;
    if (msgBody.querySelector(".msg-sources")) return;
    const wrap = document.createElement("div");
    wrap.className = "msg-sources";
    const label = document.createElement("span");
    label.className = "msg-sources-label";
    label.textContent = "📄 取自：";
    wrap.appendChild(label);
    sources.forEach((src) => {
      const chip = document.createElement("button");
      chip.className = "source-chip";
      chip.textContent = src.title;
      chip.title = `開啟「${src.title}」`;
      chip.addEventListener("click", () => {
        const item = document.querySelector(`.doc-item[data-filename="${src.filename}"]`);
        Docs.open(src.filename, src.title, item);
        Mode.set("docs");
      });
      wrap.appendChild(chip);
    });
    msgBody.appendChild(wrap);
    this.scroll();
  },

  addFollowup(contentEl, question) {
    const msgBody = contentEl.closest(".msg-body");
    if (!msgBody) return;
    // 避免重複加
    if (msgBody.querySelector(".followup-suggest")) return;
    const btn = document.createElement("button");
    btn.className = "followup-suggest";
    btn.textContent = question;
    btn.addEventListener("click", () => {
      if (!State.streaming) sendMessage(question);
    });
    msgBody.appendChild(btn);
    this.scroll();
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

  allDocs: [],
  searchTimer: null,

  renderList(items) {
    this.list.innerHTML = "";
    if (items.length === 0) {
      this.list.innerHTML = `<div style="padding:12px;color:var(--text-dim);font-size:12.5px;">沒有符合的文件</div>`;
      return;
    }
    items.forEach((doc) => {
      const el = document.createElement("div");
      el.className = "doc-item";
      el.dataset.filename = doc.filename;
      const snippetHtml = doc.snippet
        ? `<div class="doc-snippet">${this.escapeHtml(doc.snippet)}</div>`
        : "";
      el.innerHTML = `
        <div class="doc-row">
          <span class="doc-dot"></span>
          <span class="doc-title">${this.escapeHtml(doc.title)}</span>
        </div>
        ${snippetHtml}`;
      el.addEventListener("click", () => { this.open(doc.filename, doc.title, el); Mode.set("docs"); });
      this.list.appendChild(el);
    });
  },

  escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  },

  async loadList() {
    try {
      const res = await fetch("/api/docs");
      this.allDocs = await res.json();
      this.renderList(this.allDocs);
    } catch (e) {
      this.list.innerHTML = `<div style="padding:12px;color:var(--text-dim);font-size:13px;">無法載入文件列表</div>`;
    }
  },

  filter(keyword) {
    const kw = keyword.trim();
    clearTimeout(this.searchTimer);

    // 沒輸入：顯示全部
    if (!kw) {
      this.renderList(this.allDocs);
      return;
    }

    // debounce 呼叫後端搜尋
    this.searchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(kw)}`);
        const data = await res.json();
        this.renderList(data.results || []);
      } catch {
        this.list.innerHTML = `<div style="padding:12px;color:#f87171;font-size:13px;">搜尋失敗</div>`;
      }
    }, 200);
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
      const rendered = marked.parse(data.content);
      this.viewerBody.innerHTML = `<article class="doc-paper">${rendered}</article>`;
      this.decorateCallouts();
    } catch (e) {
      this.viewerBody.innerHTML = `<p style="color:#f87171;">載入失敗：${e.message}</p>`;
    }
  },

  // 把 **症狀:** / **解決方法:** / **常見問題:** 開頭的段落變成 callout box
  decorateCallouts() {
    const paragraphs = this.viewerBody.querySelectorAll(".doc-paper p");
    paragraphs.forEach((p) => {
      const strong = p.querySelector("strong:first-child");
      if (!strong) return;
      const label = strong.textContent.trim().replace(/[:：\s]+$/, "");
      if (label === "症狀") p.classList.add("callout-symptom");
      else if (label === "解決方法") p.classList.add("callout-solution");
      else if (label === "常見問題") p.classList.add("callout-faq");
    });
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
//  Ollama 連線狀態
// =========================================================
const Health = {
  badge: null,
  label: null,
  timer: null,

  init() {
    this.badge = $("#ollama-status");
    this.label = $("#model-name");
    this.check();
    this.timer = setInterval(() => this.check(), 15000);
  },

  async check() {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) {
        this.set("offline", "請重啟 server");
        return;
      }
      const data = await res.json();
      if (data.ollama === "online") {
        if (data.model_ready) {
          this.set("online", `Ollama · ${data.model || ""}`);
        } else {
          this.set("loading", `需下載 ${data.model || "模型"}`);
        }
      } else if (data.ollama === "offline") {
        this.set("offline", "Ollama 未啟動");
      } else {
        this.set("offline", `Ollama ${data.status_code || "錯誤"}`);
      }
    } catch {
      this.set("offline", "伺服器離線");
    }
  },

  set(status, text) {
    if (!this.badge) return;
    this.badge.dataset.status = status;
    if (this.label) this.label.textContent = text;
    this.badge.title = {
      online: "Ollama 正常運行",
      loading: "模型尚未下載，請執行 ollama pull",
      offline: "Ollama 未啟動，請執行 ollama serve",
      checking: "檢查中…",
    }[status] || "";
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
  State.abortController = new AbortController();

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

  let contentEl = null;
  let fullText = "";
  let aborted = false;
  let sources = [];

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, session_id: State.sessionId }),
      signal: State.abortController.signal,
    });

    Msg.removeThinking();
    contentEl = Msg.addBotStream();
    Typewriter.start(contentEl);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let done_received = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);

        if (data === "[DONE]") {
          done_received = true;
          break;
        }

        if (data.startsWith("[SOURCES] ")) {
          try { sources = JSON.parse(data.slice(10)); } catch { sources = []; }
          continue;
        }

        if (data.startsWith("[ERROR]")) {
          fullText += data.slice(8);
          Typewriter.stop();
          contentEl.innerHTML = `<p style="color:#f87171;">${Msg.escapeHtml(fullText)}</p>`;
          Video.onStreamDone();
          break;
        }

        let token = "";
        try { token = JSON.parse(data); } catch { token = data; }
        fullText += token;
        Typewriter.append(token);
      }
      if (done_received) break;
    }

    // 等打字機把 buffer 跑完（最多等 2 秒，避免卡住）
    await new Promise((resolve) => {
      const startTime = Date.now();
      const wait = setInterval(() => {
        if (Typewriter.displayed.length >= Typewriter.buffer.length || Date.now() - startTime > 2000) {
          clearInterval(wait);
          Typewriter.flush();
          Video.onStreamDone();
          resolve();
        }
      }, 50);
    });
  } catch (err) {
    if (err.name === "AbortError") {
      aborted = true;
      Typewriter.stop();
      if (!contentEl) {
        Msg.removeThinking();
        contentEl = Msg.addBotStream();
      }
      contentEl.innerHTML = marked.parse(fullText || "") +
        '<p style="color:var(--text-dim); font-size:12px; margin-top:6px;">⏸ 已停止生成</p>';
      Video.onStreamDone();
    } else {
      Typewriter.stop();
      Msg.removeThinking();
      if (!contentEl) contentEl = Msg.addBotStream();
      contentEl.innerHTML = `<p style="color:#f87171;">連線錯誤：${Msg.escapeHtml(err.message)}。請確認伺服器與 Ollama 已啟動。</p>`;
      Video.onStreamDone();
    }
  }

  // 顯示來源（先放，followup 在它後面）
  if (!aborted && contentEl && fullText.trim() && sources && sources.length) {
    Msg.addSources(contentEl, sources);
  }

  // 接上 followup 建議（非 abort 且有內容才加）
  if (!aborted && contentEl && fullText.trim()) {
    Msg.addFollowup(contentEl, FollowupEngine.pick(text));
  }

  State.streaming = false;
  State.abortController = null;
  updateSendBtn();
  $("#user-input").focus();
}

function stopGenerating() {
  if (State.abortController) {
    State.abortController.abort();
  }
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
  const iconSend = btn.querySelector(".icon-send");
  const iconStop = btn.querySelector(".icon-stop");

  if (State.streaming) {
    btn.disabled = false;
    btn.classList.add("stopping");
    btn.title = "停止生成";
    if (iconSend) iconSend.style.display = "none";
    if (iconStop) iconStop.style.display = "";
  } else {
    btn.disabled = input.value.trim().length === 0;
    btn.classList.remove("stopping");
    btn.title = "送出";
    if (iconSend) iconSend.style.display = "";
    if (iconStop) iconStop.style.display = "none";
  }
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

  // 送出 / 停止按鈕
  $("#send-btn").addEventListener("click", () => {
    if (State.streaming) {
      stopGenerating();
      return;
    }
    const text = input.value.trim();
    if (text) {
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

  // 知識庫搜尋
  const searchInput = $("#docs-search");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => Docs.filter(e.target.value));
  }

  // Ollama 狀態檢查
  Health.init();
});
