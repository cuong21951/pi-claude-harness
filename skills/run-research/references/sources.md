# Source Setup Reference

Quick setup guide for each data source used by run-research.

---

## Reddit — `reddit-cli`

Requires a free Reddit API app (script type, read-only).

1. Create app: https://www.reddit.com/prefs/apps → "create another app" → select "script"
2. Add credentials to `~/.secrets`:
   ```bash
   export REDDIT_CLIENT_ID="your_client_id"
   export REDDIT_CLIENT_SECRET="your_client_secret"
   ```
3. Verify: `reddit-cli auth`

Install: `curl -fsSL https://raw.githubusercontent.com/gupsammy/reddit-cli/main/install.sh | bash`

---

## X / Twitter — `bird`

Uses your existing browser session — no API key needed.

1. Install: `brew install bird` or follow https://github.com/steipete/bird
2. Be logged into x.com in Safari or Chrome
3. Verify: `bird --whoami`

If cookie auth fails, set manually:
```bash
export AUTH_TOKEN=your_auth_token   # from browser dev tools → Application → Cookies → x.com
export CT0=your_ct0_token
```

---

## YouTube — `yt-dlp` + `yt_research.py`

1. Install yt-dlp: `brew install yt-dlp` or `pip install yt-dlp`
2. The `yt_research.py` script is bundled with the claudest `search-youtube` plugin:
   `~/.claude/plugins/cache/claudest/claude-utilities/0.1.4/skills/search-youtube/scripts/yt_research.py`
3. Verify: `yt-dlp --version`

---

## Web Search — `brave-cli`

Requires a `BRAVE_API_KEY` from https://api.search.brave.com (free tier available).

1. Install: `curl -fsSL https://raw.githubusercontent.com/gupsammy/brave-cli/main/install.sh | sh`
2. Add API key to `~/.secrets`:
   ```bash
   export BRAVE_API_KEY="your_key"
   ```
3. Verify: `brave-cli search "test" -n 1 --output json`

**Fallback**: Claude's native `WebSearch` tool is always available when `brave-cli` is not installed or `BRAVE_API_KEY` is not set.
