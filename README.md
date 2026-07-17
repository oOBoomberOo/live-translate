# Live Translate Chrome Extension

Live-translate websites as you scroll. Replaces visible DOM text in place and overlays translated text on text found inside images via OCR.

## Features

- **Scroll-triggered translation** — translates content as it enters the viewport
- **In-place DOM replacement** — preserves layout while swapping text
- **Image OCR** — Google Cloud Vision
- **Translation** — Google Cloud Translation
- **SPA support** — MutationObserver picks up dynamically added content
- **Shadow DOM** — walks into shadow roots
- **Per-tab toggle** — enable/disable from the popup

## Setup

### 1. Install dependencies

```bash
npm install
node scripts/generate-icons.mjs
```

### 2. Build

```bash
npm run build
```

For development with hot reload:

```bash
npm run dev
```

### 3. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist` folder

## Configuration

Click the extension icon to toggle translation and pick source/target languages. Open **Settings** for:

| Setting | Description |
|---------|-------------|
| Google API key | One key for Cloud Translation and Cloud Vision |
| Image translation | Enable/disable OCR on images |
| Site blocklist | Domains where translation is disabled |

See [How to get an API key](#how-to-get-an-api-key) below if you do not have a key yet.

## How to get an API key

This extension needs a **Google API key** — a password-like string that lets the extension call Google’s translation and image-reading services. You do not need to be a developer. Follow the steps below carefully.

### Before you start

- You need a normal Google account (Gmail is fine).
- Google’s translation and image services are **paid** after a free monthly allowance. You must add a payment method (credit/debit card) before the key will work. Google usually shows free credits for new accounts; light personal use often stays within the free tier, but you should still set a budget alert (step 7) so you are not surprised by a bill.

### Step-by-step

1. **Open Google Cloud**  
   In your browser, go to [https://console.cloud.google.com/](https://console.cloud.google.com/) and sign in with your Google account.

2. **Create a project**  
   A “project” is just a folder Google uses to group settings.  
   - At the top of the page, open the project picker (it may say **Select a project**).  
   - Click **New Project**.  
   - Give it any name you like (for example, `Live Translate`).  
   - Click **Create**, then make sure that project is selected in the picker.

3. **Turn on billing for the project**  
   Google requires a billing account even if you stay within free usage.  
   - Open the menu (☰) → **Billing**.  
   - Link a billing account, or create one and add a payment method when asked.  
   - Confirm the billing account is linked to the project you just created.

4. **Enable Cloud Translation API**  
   This is the service that translates webpage text.  
   - Go to [https://console.cloud.google.com/apis/library/translate.googleapis.com](https://console.cloud.google.com/apis/library/translate.googleapis.com)  
   - Confirm your project is selected at the top.  
   - Click **Enable**.

5. **Enable Cloud Vision API**  
   This is the service that reads text inside images.  
   - Go to [https://console.cloud.google.com/apis/library/vision.googleapis.com](https://console.cloud.google.com/apis/library/vision.googleapis.com)  
   - Confirm your project is selected at the top.  
   - Click **Enable**.

6. **Create an API key**  
   - Go to [https://console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)  
   - Click **+ Create credentials** → **API key**.  
   - Google will show a long string starting with something like `AIza...`. That is your key.  
   - Click **Copy**, then **Close**.

7. **(Recommended) Limit spending**  
   So a runaway bill is unlikely:  
   - Open the menu (☰) → **Billing** → **Budgets & alerts**.  
   - Create a budget (for example, a few dollars per month) and turn on email alerts.

8. **(Recommended) Restrict the key**  
   On the Credentials page, click your new API key to edit it:  
   - Under **API restrictions**, choose **Restrict key**.  
   - Allow only **Cloud Translation API** and **Cloud Vision API**.  
   - Save.  
   This stops the key from being used for other Google services if it leaks.

9. **Paste the key into the extension**  
   - In Chrome, click the Live Translate extension icon → **Settings**.  
   - Paste the key into the **API Key** field.  
   - Click **Save Settings**.

You only need **one** key. The same key is used for both translation and image OCR.

### If something goes wrong

| Problem | What to try |
|---------|-------------|
| “API not enabled” or permission errors | Repeat steps 4 and 5, and confirm the correct project is selected. |
| Billing / payment errors | Finish step 3; new keys often fail until billing is linked. |
| Translation works but images do not | Confirm Cloud Vision API is enabled (step 5) and that **Image translation** is turned on in Settings. |
| You lost the key | Create a new API key in Credentials (step 6) and update Settings; you can delete the old key afterward. |

Treat the API key like a password. Do not share it publicly or commit it to GitHub.

## Usage

1. Navigate to any webpage
2. Click the extension icon and enable the toggle
3. The page reloads and begins translating as you scroll
4. Toggle off to restore original text

## Testing

```bash
# Automated fixture e2e (mock translate + mock OCR, no API key)
npm run test:e2e

# Visual QA on live sites (requires Google API key)
# Copy .env.example to .env and set GOOGLE_API_KEY=
npm run test:visual
```

## Project structure

```
src/
├── background/     Service worker, translation & OCR managers
├── content/        Content scripts (scroll observer, text/image handling)
├── popup/          Extension popup UI
├── options/        Settings page
└── shared/         Types, messages, settings helpers
```

## Development

```bash
npm run dev    # Watch mode — reload extension after changes
npm run build  # Production build to dist/
```

## License

MIT
