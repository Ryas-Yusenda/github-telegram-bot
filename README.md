# GitHub → Telegram Bot (Cloudflare Worker)

This Cloudflare Worker listens for GitHub Webhook events and sends notifications to Telegram.
Features:

- ✅ Multi-owner support (personal account + organizations)
- ✅ Filter by specific repositories
- ✅ Filter by public/private repository
- ✅ HMAC signature verification for security
- ✅ Supports events: push, pull_request, issue_comment, workflow_run (only on failure)

---

## 🚀 Deploy to Cloudflare

1. **Clone the Project**

   ```bash
   git clone https://github.com/Ryas-Yusenda/github-telegram-bot.git
   cd github-telegram-bot
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Edit `wrangler.toml`**
   - Add your `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
   - Set `GITHUB_WEBHOOK_SECRET` (any random string)
   - Set `TELEGRAM_THREAD_ID` (optional: topic/thread ID in Telegram group)
   - (Optional) Configure owner/repo filters

4. **Deploy**

   ```bash
   npx wrangler deploy
   ```

   Wrangler will give you a public URL, for example:

   ```
   https://github-telegram-bot.your-subdomain.workers.dev
   ```

---

## ⚙️ Setup on GitHub

1. Go to **Repo** (or **Organization**) → **Settings** → **Webhooks** → **Add webhook**
2. Fill:
   - **Payload URL:** Your Cloudflare Worker URL
   - **Content type:** `application/json`
   - **Secret:** Use the same `GITHUB_WEBHOOK_SECRET` from `wrangler.toml`
   - **Which events:** Choose `Let me select individual events`
     - Select: `Push`, `Pull request`, `Issue comment`, `Workflow run`
3. Save.

---

## 🧪 Testing

- **Test Webhook from GitHub**
  - On the webhook page, click `Redeliver` or `Ping`
  - Check logs in Cloudflare Dashboard → Workers → Logs

- **Manual Test**
  ```bash
  curl -X POST https://YOUR_WORKER_URL -H "Content-Type: application/json" -d '{"zen":"Hello"}'
  ```

---

## 🛠️ Configuration Filters

### 1. Multi-Owner

If you are invited to multiple repos from different accounts/orgs, list them all:

```toml
ALLOWED_OWNERS = "your-username,company-x,sideproject-y"
```

### 2. Repository Filter

Notify only for specific repositories:

```toml
ALLOWED_REPOS = "api-service,internal-tool"
```

### 3. Public/Private Filter

Only notify for private repositories:

```toml
VISIBILITY_FILTER = "private"
```

---

## 🔒 Security

- Uses `x-hub-signature-256` HMAC from GitHub to verify payload integrity.
- No data is stored in the Worker; everything is directly forwarded to Telegram.
