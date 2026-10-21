# pocketOS (landing page, branch `main`)

pocketOS is Arpan's own OS of small apps that stay in your pocket and make life easy. This branch is only the **landing page**: who Arpan is and the apps he has built.

## Branches — three separate projects in one repo
| Branch | What | Vercel project | Live |
|---|---|---|---|
| `main` | this landing page (static HTML) | `arpan-pocketos` | https://arpan-pocketos.vercel.app |
| `echopdo` | eChopdo, the family app (React + Supabase + Android) | `echopdo` | https://echopdo.vercel.app |
| `grandxgamer` | the GRANDXGAMER gaming café app | its own | https://grandxgamer.vercel.app |

- **App branches never merge into each other or into `main`.** Work on an app happens only on its own branch, and each has its own CLAUDE.md.
- `main` was eChopdo until Oct 2026; that history is still on `main` and continues on `echopdo`.

## The page
- Plain static files, no build step: `index.html`, `styles.css`, `apps.js`, `favicon.svg`, `og.png` (1200×630 share image), `icons/`.
- **Adding an app = one line in `apps.js`** (`name`, `url`, `status`: live / private / building / idea, `about`; optional `icon`, `problem`, `features`, `platforms`, `stack`), plus its icon in `icons/`.
- Light and dark follow the system (`prefers-color-scheme`, tokens on `:root`). Check at 384 px wide (no sideways scroll) and at laptop width.
- Meta tags (title, description, Open Graph, Twitter card, canonical) use absolute `https://arpan-pocketos.vercel.app/` URLs — update them if the domain changes.

## Rules
- Describe apps in general terms only. **Never put family or customer names, phone numbers, addresses, keys or passwords on the page or in the repo.**
- Personal facts about Arpan come only from him — don't invent them.
