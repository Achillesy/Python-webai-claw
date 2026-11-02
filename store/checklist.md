# Chrome Web Store submission checklist

## Ready in the repository

- [x] Extension package: run `bash store/build.sh`; the version comes from
      `extension/manifest.json` (currently 1.2.0). The build strips the dev
      `key`; the first store upload assigns the store extension ID.
- [x] Icons 16/48/128 under `extension/icons/`, referenced by the manifest.
- [x] English store description: `store/listing-en.txt`.
- [x] Privacy policy: `PRIVACY.md`.
- [x] Noncommercial license: `LICENSE`.
- [x] Supported sites are limited to DeepSeek and Muse.

## Developer dashboard steps

1. **Package**
   - Run `bash store/build.sh`.
   - Upload the generated zip as a new item.
   - Use **Productivity** as the category.
   - Set the listing language to **English (US)** only for this release.
   - Short description: `Run local commands and upload files from DeepSeek or Muse chats through a user-installed native host.`

2. **Screenshots**
   - Required: at least one 1280x800 or 640x400 image.
   - Recommended: three to five images showing the popup, a DeepSeek result
     fill-back, attachment upload, and the Blender bridge.
   - The repository currently keeps one Blender result image. Capture fresh
     extension and DeepSeek screenshots before submitting; do not use the old
     screenshots from previous releases.
   - Optional small promo tile: 440x280.

3. **Privacy and permissions**
   - Privacy policy URL:
     `https://github.com/Achillesy/Python-webai-claw/blob/master/PRIVACY.md`
   - Single purpose: connect a supported web AI chat to a user-installed local
     host so the AI's command blocks can run on the user's own machine.
   - `nativeMessaging`: communicate with the local host the user installed.
   - `storage`: remember the machine binding and popup preferences.
   - `notifications`: show disconnect and waiting-for-user status.
   - Host permissions: `https://chat.deepseek.com/*` and
     `https://muse.ai/*` only.
   - Remote code: no. All extension code is packaged. The local host is an
     open-source program the user installs separately.
   - Data disclosure: the extension does not send data to the developer and
     has no analytics or ads. It processes chat page content to detect command
     blocks; commands, results, and user-requested attachments are sent to the
     selected AI site. Local logs are metadata-only. See `PRIVACY.md`.

4. **Reviewer notes**
   - The extension is the browser half of a local Native Messaging host.
   - Without the host, the popup and onboarding still load; commands require
     the host and a Connect.
   - The host installer is at
     `https://github.com/Achillesy/Python-webai-claw`.
   - There is no account or test credential.

5. **Before submitting**, note the extension ID assigned by the store and add
   it to `EXTENSION_IDS` in `native-host/install.py`. Rebuild/push the
   installer so a reviewer who installs the host can connect. Keep the dev ID
   `feifgnelfehkjlimiolepkmffgbjcong` for local development.

6. Submit for review.

## After going live

Tell users to re-run the host installer after installing the store build so the
host allowlist contains the store extension ID.
