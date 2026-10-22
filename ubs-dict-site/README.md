# UBS Biblical Dictionary — static site

A static, read-only browser for the UBS Dictionary of Biblical Hebrew and
UBS Dictionary of the Greek New Testament, built from the
[ubs-open-license](https://github.com/ubsicap/ubs-open-license) data repo.
No framework, no build tooling, no server-side runtime.

## Build

Requires Python 3.9+ (standard library only) and a local checkout of the data repo.

```sh
python3 build.py --repo ../ubs-open-license --out dist
```

The build validates entry, meaning, reference, and domain counts and fails loudly
if the source files change shape. It takes about a minute and writes ~64 MB of
JSON (13,448 entry files, one 4 MB search index, domain trees).

Layout: `src/` holds the site shell (`index.html`, `app.js`, `style.css`, `favicon.svg`); the build copies it into `dist/` next to the generated `data/` tree.

## Run locally

```sh
python3 -m http.server -d dist 8000
# open http://localhost:8000/
```

`file://` will not work because the app fetches JSON.

## Deploy

The output in `dist/` is plain static files, so anything that serves a directory works.

Docker / nginx:

```sh
python3 build.py --repo ../ubs-open-license --out dist
docker build -t ubs-dict .
docker run --rm -p 8080:80 ubs-dict
```

GitHub Actions: `.github/workflows/build.yml` checks out the upstream data repo,
builds `dist/`, and uploads it as a downloadable archive named `ubs-dict-site`
on every push to `main` (and via manual dispatch). Download it from the workflow
run's Artifacts section, unzip it, and serve the contents from any static host.
Because the workflow clones the data repo fresh, a build fails loudly if upstream
changes the files or counts the pipeline validates. The app uses hash routing, so
no rewrite rules or 404 fallback are needed.

Wasmer and any static host work the same way.

## What the site does

- Search by pointed Hebrew or accented Greek lemma, alternate lemma, English
  gloss or definition, or Strong's number (`H1119`, `A0004`, `G0101`).
  Search is diacritic-insensitive: `אב` finds `אֵב`, `αγαπη` finds `ἀγάπη`.
- Entry pages show glosses, definitions, semantic domains, synonyms/antonyms,
  notes, and occurrences grouped by book.
- Semantic domain trees for both corpora with per-domain entry counts.
- Light and dark themes with a creamy pastel palette. The header toggle stores
  the choice in `localStorage`; the first visit follows the OS preference.
- Occurrence links open BibleGateway; no Bible text is bundled.

Routing: `#/search?q=…&c=h|g|all`, `#/h/<MainId>`, `#/g/<MainId>`,
`#/domains/h/<code>`, `#/about`.

## Source files used

| Corpus | Dictionary | Domains |
| --- | --- | --- |
| Hebrew | `UBSHebrewDic-v0.9.3-en.JSON` | `UBSHebrewDicLexicalDomains-v0.9.3-en.JSON` |
| Greek | `UBSGreekNTDic-v1.1-en.JSON` | `UBSGreekNTDicLexicalDomains-v1.1-en.JSON` |

Only the English localizations are included. Dictionary entry markup
(`{L:…}`, `{S:…}`, `{N:…}`, `{A:…}`, `{D:…}`) is rendered in the browser.

## Licence

Dictionary content © United Bible Societies, licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
The generated data files are derivative works and carry the same licence.
The site code can be licensed separately.
