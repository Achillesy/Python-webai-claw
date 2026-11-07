# Store submission checklist — 1.2.6 update (Chrome + Edge)

This is an UPDATE submission: both stores already list 1.1.8
(Chrome `lfdedknlfjieigbinhilhhkcedadifdl`,
Edge `aammomamjknhhblplamnipopncbfoeoh`). No new extension ID is
assigned; the store IDs are already in `EXTENSION_IDS` in
`native-host/install.py`. Keep the dev ID
`feifgnelfehkjlimiolepkmffgbjcong` for local development.

## Ready in the repository

- [x] Extension package: run `bash store/build.sh`; the version comes from
      `extension/manifest.json` (currently 1.2.6). The build strips the dev
      `key` and validates the manifest references.
- [x] Icons 16/48/128 under `extension/icons/`, referenced by the manifest.
- [x] Store descriptions: `store/listing-en.txt` and
      `store/listing-zh.txt`.
- [x] Privacy policy: `PRIVACY.md`.
- [x] Noncommercial license: `LICENSE`.
- [x] Supported sites are limited to DeepSeek and Muse.
- [x] Changelog: `docs/CHANGELOG.md` has the `[1.2.6]` entry.
- [x] Chinese README: `README_zh.md` (install one-liners use the Gitee
      mirror `gitee.com/achillesy/Python-webai-claw`).

## Developer dashboard steps — Chrome Web Store

1. **Package**
   - Run `bash store/build.sh` (produces
     `store/webai-claw-store-1.2.6.zip`).
   - In the [developer dashboard](https://chrome.google.com/webstore/devconsole),
     open the existing webai-claw item and upload the zip as a new version.
   - Category: **Productivity**.
   - Listing languages: **English (US)** (paste from `listing-en.txt`)
     and **Chinese** (paste from `listing-zh.txt`).
   - Short description: `Run local commands and upload files from DeepSeek or Muse chats through a user-installed native host.`

2. **Screenshots** (unchanged for this release, by decision 2026-11-07)
   - The 11-02 screenshots (`shot-01`–`shot-04`, Blender result) are
     reused: the muse.ai session link shown in them was deleted and the
     host reinstalled, so no live session or host ID remains in the
     images.
   - Small promo tile (440x280): the seal version
     `webai-claw-promo-tile-440x280-seal-ccw30-cloud-topleft.png`.
   - Retake screenshots before the NEXT submission if the popup or
     onboarding UI changes again.

3. **Privacy and permissions** (unchanged from 1.1.8)
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

5. Submit for review.

## Developer dashboard steps — Edge Add-ons

1. Upload the SAME zip (`store/webai-claw-store-1.2.6.zip`) as a new
   version of the existing Edge item (Product ID
   `d85fe101-6ff4-474a-adad-6bb4b9a454dd`).
2. Reuse the Chrome listing text (English + Chinese) and the same
   screenshots and promo tile.
3. Submit for review. Edge review is separate from Chrome; the two
   stores go live independently.

## After going live

Tell users to re-run the host installer after installing the store build:
the new installer creates the `.venv` and the host reports build 4, so
the popup stops warning about an outdated host. The host itself needs
no store review for future host-only fixes — those ship through the
installer and the build stamp.
