# Browser Extension

The Chrome extension is the lowest-friction path for one-off links while someone works in HubSpot, Google Ads, LinkedIn, Meta, Reddit, CM360, or another browser-based platform. The web app remains the best surface for large batches, administration, investigation, and exports.

## User workflow

1. Open the landing page and click the extension, or right-click a link and choose **Create governed UTM**.
2. The extension captures the URL and opens a side panel without navigating away from the platform.
3. Connect with Runpod SSO once per browser session.
4. Select an existing initiative/campaign or explicitly create one, choose a platform preset, and fill only the fields that vary.
5. **Preview** to normalize the destination, validate taxonomy, and check exact/near duplicates.
6. **Issue & copy** to commit the record, mint the `rpl_` ID, and copy the final URL.
7. Use **Open registry** to investigate the recorded result.

The extension never assembles UTMs or mints IDs. It calls `/api/v1/links/preview` and `/api/v1/links`; the registry remains authoritative.

The extension reads server-returned capabilities after sign-in. Investigators receive a read-only token and see preview controls only; issue and campaign/initiative creation controls are hidden or disabled.

## When to use which entry point

| Need | Best entry point |
|---|---|
| Current page or one link inside a web platform | Browser extension |
| Several links with small variations | Web bulk grid or spreadsheet paste |
| Up to 200 rows from a media plan | Web CSV/bulk flow or `/api/v1/batches` |
| Repeatable system workflow | `/api/v1` |
| Conversational/agent-assisted workflow | MCP, with confirmation before writes |

## Local installation

1. Start the registry at `http://localhost:3000`.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the repository's `extension/` directory.
4. Pin **Runpod UTM Builder**, open a normal HTTP(S) page, click it, and connect.

Local development permits any valid Chrome extension ID. Production does not.

## Production rollout

1. Publish the unchanged package through a Runpod-approved private Chrome Web Store listing or managed enterprise policy.
2. Record the assigned 32-character extension ID.
3. Set `EXTENSION_IDS=<id>` in Vercel (comma-separated during a controlled key/ID transition).
4. Redeploy and verify the SSO/PKCE flow from the managed extension.
5. Pilot with campaign managers, then deploy through browser management.

For enterprise deployment, set the managed extension policy `apiBase` to the production HTTPS registry origin. The side panel uses that value automatically and locks the field, removing first-run setup for users.

Chrome references: [managed-storage manifest and policy schema](https://developer.chrome.com/docs/extensions/reference/manifest/storage) and [storage API behavior](https://developer.chrome.com/docs/extensions/reference/api/storage).

The ID allowlist controls both the PKCE redirect and cross-origin API access. Do not ship production with `EXTENSION_IDS` empty, and do not distribute unpacked builds.

## Security model

- Manifest V3 service worker and side panel; no remotely hosted code.
- `activeTab` reads a URL only after an explicit toolbar/context-menu action.
- Registry host access is optional and requested for the configured origin.
- PKCE S256 binds the one-time authorization code to the extension session.
- Eight-hour bearer tokens are stored in `chrome.storage.session`, not synced or persisted across browser restart.
- Production accepts only allowlisted extension IDs.
- Issuance uses a unique idempotency key so a retry cannot accidentally create another record.
- Existing links remain direct, self-describing URLs; the extension is never in the click path.

## Deliberate V1 boundaries

The extension does not inject controls into third-party pages, scrape form fields, or auto-submit platform campaigns. DOM automation is brittle and would require broad host permissions. A later adapter may add platform-specific autofill only after usage data identifies a high-value workflow and the platform UI/API contract is supportable.
