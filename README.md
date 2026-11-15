<div align="center">

# 🧩 Claude Code Mods by Krish

**Small mods that make the Claude Code terminal nicer to live in.**<br>
มอดเล็ก ๆ ที่ทำให้ Claude Code ในเทอร์มินัลใช้สบายขึ้น

![Claude Code](https://img.shields.io/badge/Claude_Code-2.1.325+-d97757?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-4c9a6a?style=flat-square)
![Mods](https://img.shields.io/badge/mods-3-6c7bd8?style=flat-square)
![ภาษาไทย](https://img.shields.io/badge/ภาษาไทย-supported-e0a43a?style=flat-square)

[**thai-backspace**](#-thai-backspace) · [**usage-corner**](#-usage-corner) · [**image-preview**](#-image-preview) · [Install](#-install) · [Development](#-development)

</div>

---

## ⚡ Install

At the prompt of a Claude Code terminal session (answer `y` to add the marketplace, then pick a scope):

```text
/plugin install usage-corner --marketplace Kritsanai-Krish/claude-code-mods
/plugin install thai-backspace --marketplace Kritsanai-Krish/claude-code-mods
/plugin install image-preview --marketplace Kritsanai-Krish/claude-code-mods
```

From a shell instead:

```bash
claude plugin install usage-corner --marketplace Kritsanai-Krish/claude-code-mods
claude plugin install thai-backspace --marketplace Kritsanai-Krish/claude-code-mods
claude plugin install image-preview --marketplace Kritsanai-Krish/claude-code-mods
```

In the desktop app (where `/plugin` does not run): click **+** next to the prompt box → **Plugins** → **Add marketplace** with `Kritsanai-Krish/claude-code-mods` → **Add plugin**.

Each mod is independent: install any of them.

---

## ⌫ thai-backspace

> **Backspace deletes one Thai mark at a time.** · ลบสระ/วรรณยุกต์ทีละตัว ไม่ลบทั้งพยางค์

Claude Code's prompt box treats a Thai consonant and the marks stacked on it as one character, so a single Backspace wipes the whole cluster. You meant to fix a tone mark and lost the consonant too.

With this mod, Backspace peels marks off one by one:

| You type | Backspace ① | Backspace ② | Backspace ③ |
| :---: | :---: | :---: | :---: |
| `กี่` | `กี` | `ก` | *(empty)* |
| `น้ำ` | `น้` | `น` | *(empty)* |
| `ก่อน` *(caret after ่)* | `กอน` | — | — |

- Works anywhere in the draft, not only at the end.
- Only plain Backspace changes. Delete, Ctrl+Backspace, other scripts and emoji behave exactly as before.
- Marks handled: ั ำ ิ ี ึ ื ุ ู ฺ ็ ่ ้ ๊ ๋ ์ ํ ๎ (U+0E31, U+0E33–0E3A, U+0E47–0E4E).

---

## 📊 usage-corner

> **Model, context, plan limits and cost at the bottom right, one click from the details.**<br>
> โมเดล · context · limit · ค่าใช้จ่าย ที่มุมขวาล่าง กดดูรายละเอียดได้

```text
󰚩 Opus 5.5  │  󰧑 ▰▱▱▱▱ 16% 158k/1M  │  󰔟 5h ▰▱▱▱▱ 7% ↻3h58m  │  󰨳 wk ▰▰▰▱▱ 50% ↻2d3h  │  󰇁5.54
```

### What the corner shows

| Part | Meaning |
| --- | --- |
| 󰚩 **Model** | The model in use, colored by family: Opus orange, Sonnet blue, Haiku green, Fable purple |
| 󰧑 **Context** | How full the context window is, with tokens used / window size |
| 󰔟 **5h** | Your 5-hour plan limit and the time until it resets |
| 󰨳 **wk** | Your weekly plan limit (all models) |
| 󰫢 **Fable** | Fable's own weekly limit, shown only while you are on Fable |
| 󰇁 **Cost** | What this session has cost, in USD |

Meters turn **green → yellow → red** at 50% and 80%. On a narrow terminal the corner sheds detail step by step (token counts, then reset times, then meters, then the model version) so the percentages always fit.

### Click for details

Every part of the corner is a button. Clicking one opens a panel docked beside the chat. It never covers your work, and **Esc**, **✕** or a second click closes it.

| Tab | Key | What you get |
| --- | :---: | --- |
| 󰚩 **Model** | `m` | Opus / Sonnet / Haiku / Fable with the current one marked. Press `1`–`4` or click to switch |
| 󰧑 **Context** | `c` | The colored grid and per-category token table, as `/context` shows it, plus the auto-compact point. `r` re-counts |
| 󰇞 **Usage** | `u` | Big meters for every plan limit (Fable's included) with reset times, this session's cost and duration, and *what used your limits* in the last 24 h. `r` refreshes |

### Heads-up alerts

A toast appears when any limit first reaches **80%**, and again at **95%**:

```text
⚠ 5-hour limit at 82% · resets in 1h20m
```

Each level warns once per reset period, even across new sessions.

### Requirements

- **A Nerd Font** in your terminal for the icons (for example *JetBrainsMono Nerd Font*). Without one the icons show as boxes; everything else works.
- **Fullscreen layout** for mouse clicks: set `"tui": "fullscreen"` in `~/.claude/settings.json`.
- **A Claude subscription** for the 5h / weekly / Fable limits. With an API key the corner shows model, context and cost only.

### How it gets the Fable limit

Per-model weekly windows are not in the data Claude Code hands to mods. They come from the claude.ai usage endpoint, which `claude -p /usage` prints. The mod runs that in the background, at most once a minute, with `--no-session-persistence --setting-sources ""`. It calls no model, uses no tokens, saves no session and loads none of your plugins, so it never re-runs itself. If a future Claude Code changes the wording of `/usage`, the Fable meter disappears and the rest keeps working.

---

## 🖼 image-preview

> **See the picture, not just `[Image #1]`.** · ดูรูปในแชทได้เลย ทั้งรูปที่เราแนบและรูปที่ Claude เปิดอ่าน

Claude Code sends images to the model but shows you only a placeholder. This mod draws them in the transcript:

| What | Where it appears |
| --- | --- |
| An image you paste, drag in, or drop as a file path | Under your message |
| An image Claude opens with **Read** | Under the `Read(...)` row, or under the folded `Read 2 files` line |

- You see the same picture Claude sees (Claude Code's own resized copy).
- Previews keep their shape and fit the window: at most 72 columns × 20 rows, and small icons stay small.
- Other surfaces (desktop app, VS Code) are left alone; they have their own previews.

### Requirements

- **A terminal with the kitty graphics protocol**: Ghostty, kitty, or iTerm2 3.5+. Elsewhere you get a dim `[image 640x480]` line instead.
- **ImageMagick** (`magick`) for JPEG, GIF and WebP, and for pasted images. Small PNGs from Read need nothing. Fedora: `sudo dnf install ImageMagick` · Debian/Ubuntu: `sudo apt install imagemagick` · macOS: `brew install imagemagick`.

### Where previews are kept

Converted PNGs go to `~/.cache/claude-image-preview/` (folder mode 700) and are deleted after 7 days. Clearing the folder is always safe.

---

## 🛠 Development

```bash
git clone https://github.com/Kritsanai-Krish/claude-code-mods
cd claude-code-mods

claude plugin validate .                # manifests + hooks modules
claude plugin test ./usage-corner       # 16 tests
claude plugin test ./thai-backspace     # 5 tests
claude plugin test ./image-preview      # 10 tests

claude --plugin-dir ./usage-corner      # run a session with your working copy
```

```text
claude-code-mods/
├── .claude-plugin/marketplace.json
├── thai-backspace/
│   └── hooks/            register.ts · thai-marks.ts (+ tests)
├── image-preview/
│   ├── hooks/            register.tsx · convert.ts · image-size.ts · state.ts (+ tests)
│   └── types/index.d.ts  state contract
└── usage-corner/
    ├── hooks/            register.tsx · format.ts · panel.tsx · panel-format.ts
    │                     state.ts · plan-usage.ts · alerts.ts (+ tests)
    └── types/index.d.ts  state contract
```

Mods use the Claude Code function-hooks API (early access), which may change between releases. Built and tested on Claude Code 2.1.325.

---

<div align="center">

MIT © [Krish](https://github.com/Kritsanai-Krish)

</div>
