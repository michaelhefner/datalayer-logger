# DataLayer Logger

An Electron desktop browser that automatically captures and saves every Google `dataLayer.push()` event as JSON.

## What it does

- Provides a built-in web browser you can navigate like a normal browser
- Intercepts `window.dataLayer.push()` calls on every page **before** any page scripts run, so no events are missed
- Displays captured events in real time in a sidebar with syntax-highlighted JSON
- Auto-saves every event to a timestamped JSON file in the `datalayer-events/` folder
- Works with Google Tag Manager, GA4, and any other tool that uses the `dataLayer` API
- Scans any page for clickable elements and lists them with their tag, label, href, and CSS selector

## Getting started

```bash
npm install
npm start
```

## Usage

| Action | How |
|---|---|
| Navigate | Type a URL or search term in the address bar and press **Enter** or click **Go** |
| Back / Forward | Arrow buttons in the toolbar, or **Alt+Left** / **Alt+Right** |
| Reload | Reload button or **F5** |
| Focus address bar | **Ctrl+L** |
| Expand an event | Click any event row in the sidebar to see the full JSON payload |
| Filter events | Type an event name in the filter box at the top of the sidebar |
| Export all events | Click **Export** to save a JSON file to a location of your choice |
| Clear & reset | Click **Clear** to discard the current session and start a new one |

### Clickable Elements tab

The **Clickable** tab in the sidebar lets you inspect every interactive element on the current page.

| Control | Behaviour |
|---|---|
| **Scan Page** | Finds all clickable elements on the page (links, buttons, inputs, custom click handlers) |
| **Visible only** | Filters results to elements that are actually visible on screen |
| **Auto-scan** | Automatically re-scans after every navigation |
| Filter input | Search across tag name, text label, href, or CSS selector |
| **Copy** (per row) | Copies that element's CSS selector to the clipboard |
| **Copy JSON** | Copies the full results array as JSON to the clipboard |

The scanner looks for semantic elements (`<a>`, `<button>`, `<input>`, `<select>`, ARIA roles), `[onclick]` attributes, `[tabindex]` elements, and anything with a `cursor: pointer` computed style.

## Output format

Each captured event is saved with metadata:

```json
{
  "id": 1,
  "timestamp": "2026-04-18T10:30:00.000Z",
  "url": "https://example.com/shop",
  "event": {
    "event": "purchase",
    "ecommerce": { ... }
  }
}
```

Session files are written to `datalayer-events/session-<timestamp>.json` and updated after every push.
