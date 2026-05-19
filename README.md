# WholesomeShield

WholesomeShield is a Devvit moderation app for family-friendly Reddit communities. It removes high-confidence NSFW, adult promotional, spam, unsafe, or suspicious content without using karma limits or account-age limits.

## App Slug

The Reddit developer app slug is:

```text
wholesome-shield
```

You can still use **WholesomeShield** as the public display name in descriptions, docs, and moderator-facing text.

## Behavior

- First violation: remove content, leave a warning comment, send a private warning, save one violation.
- Second violation: remove content, leave a final warning, send a final private warning, ban the user from that subreddit.
- Automatic scans are scheduled for each subreddit when the app is installed or upgraded.
- The manual **Shield Check** mod action remains available as a backup.
- Clean users are not removed for weak signals like a suspicious username alone.
- Duplicate triggers for the same content do not count as multiple violations.

## Moderator Settings

Each subreddit installation has settings on the Reddit developer app page. Moderators can configure:

- automatic moderation on or off
- whether unsafe content is removed
- whether WholesomeShield leaves a public warning comment
- whether WholesomeShield sends a private warning message
- whether repeat violators are banned
- whether moderators receive a modmail notification
- the automatic scan limit, capped at 100 items per scan

## Detection

The app detects:

- NSFW/adult keywords
- OnlyFans/Fansly and adult domains
- Telegram promotion spam
- spammy promotional phrasing
- unsafe comments
- suspicious usernames as a weak signal
- unsafe post flair/tag text
- Reddit NSFW flag
- suspicious media hosts

True AI image/video scanning is intentionally isolated in `src/server/media.ts`. Add an AI provider there before claiming AI media scanning in the public app description, then add its domain to `devvit.json` under `permissions.http.domains`.

## Commands

```bash
npm install
npm test
npm run build
npm run dev
```

Use `npm run dev` to start a Devvit playtest in a subreddit you moderate.

## Public Release

Run the full local checks:

```bash
npm run type-check
npm run lint
npm run test
npm run build
```

Upload a release candidate:

```bash
npm run deploy
```

Publish the app when the Reddit developer listing is ready:

```bash
npx devvit publish --public
```

After publishing, moderators can install WholesomeShield through Reddit. Devvit hosts the app and scheduler 24/7; Railway hosting is not needed for this Devvit version.

## Legal Links

- [Terms and Conditions](TERMS.md)
- [Privacy Policy](PRIVACY.md)
