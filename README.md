# yt-backup — built app

This repository holds **only the compiled output** of a personal project.
The source lives in a private repository.

It is public for one reason: GitHub Pages does not serve private
repositories on the free plan. Nothing here is secret. A deployed
single-page app hands its whole bundle to anyone who opens it, on any
host, so this exposes exactly what visiting the site would anyway.

The Google OAuth **client ID** in the bundle is public by design — that is
how every browser-based OAuth client works. There is no client secret, no
refresh token, and no server. Authorising the app only ever grants access
to *your own* channel, and the consent screen is restricted to its own
test users, so opening this page does nothing for anyone else.
