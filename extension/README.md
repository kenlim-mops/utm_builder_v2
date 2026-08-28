# Runpod UTM Browser Extension

Manifest V3 side-panel client for the shared UTM Registry API. It contains no generation, taxonomy, identifier, validation, or duplicate logic.

## Local install

1. Run the web app at `http://localhost:3000`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select this `extension/` directory.
4. Pin the extension and click it on any HTTP(S) page.
5. Confirm the Registry URL and choose **Connect with SSO**. Local development uses the seeded dev identity; production uses the configured SSO provider.

## Production packaging

Set `EXTENSION_IDS` on the web application to the comma-separated approved Chrome extension IDs. Publish through the Runpod-approved private Chrome Web Store or managed enterprise channel. Do not distribute unpacked production builds.

The extension requests host access only for the configured registry origin. It uses `activeTab` after an explicit click and stores the eight-hour access token in `chrome.storage.session`, which clears on browser restart.

For managed deployment, set the extension policy value `apiBase` to the production HTTPS registry origin. This locks the connection field so users do not need to configure it and cannot point the managed extension at another host.
