#!/usr/bin/env python3
"""Build the static UBS dictionary site data from the ubs-open-license repo.

Reads the English dictionary JSON files (read-only) and writes a portable
static site data tree plus the search index. Standard library only.

    python3 build.py --repo ../ubs-open-license --out dist
"""

import argparse
import datetime
import json
import os
import re
import shutil
import sys
import unicodedata

SOURCES = {
    "h": {
        "label": "UBS Dictionary of Biblical Hebrew",
        "version": "v0.9.3",
        "entries": "dictionaries/hebrew/JSON/UBSHebrewDic-v0.9.3-en.JSON",
        "domains": "dictionaries/hebrew/JSON/UBSHebrewDicLexicalDomains-v0.9.3-en.JSON",
        "expect_entries": 7941,
        "expect_meanings": 16573,
        "expect_refs": 288093,
        "expect_domains": 419,
    },
    "g": {
        "label": "UBS Dictionary of the Greek New Testament",
        "version": "v1.1",
        "entries": "dictionaries/greek/JSON/UBSGreekNTDic-v1.1-en.JSON",
        "domains": "dictionaries/greek/JSON/UBSGreekNTDicLexicalDomains-v1.1-en.JSON",
        "expect_entries": 5507,
        "expect_meanings": 9178,
        "expect_refs": 130921,
        "expect_domains": 738,
    },
}

BOOKS = [
    ("GEN", "Genesis"), ("EXO", "Exodus"), ("LEV", "Leviticus"), ("NUM", "Numbers"),
    ("DEU", "Deuteronomy"), ("JOS", "Joshua"), ("JDG", "Judges"), ("RUT", "Ruth"),
    ("1SA", "1 Samuel"), ("2SA", "2 Samuel"), ("1KI", "1 Kings"), ("2KI", "2 Kings"),
    ("1CH", "1 Chronicles"), ("2CH", "2 Chronicles"), ("EZR", "Ezra"),
    ("NEH", "Nehemiah"), ("EST", "Esther"), ("JOB", "Job"), ("PSA", "Psalms"),
    ("PRO", "Proverbs"), ("ECC", "Ecclesiastes"), ("SNG", "Song of Songs"),
    ("ISA", "Isaiah"), ("JER", "Jeremiah"), ("LAM", "Lamentations"),
    ("EZK", "Ezekiel"), ("DAN", "Daniel"), ("HOS", "Hosea"), ("JOL", "Joel"),
    ("AMO", "Amos"), ("OBA", "Obadiah"), ("JON", "Jonah"), ("MIC", "Micah"),
    ("NAM", "Nahum"), ("HAB", "Habakkuk"), ("ZEP", "Zephaniah"),
    ("HAG", "Haggai"), ("ZEC", "Zechariah"), ("MAL", "Malachi"),
    ("MAT", "Matthew"), ("MRK", "Mark"), ("LUK", "Luke"), ("JHN", "John"),
    ("ACT", "Acts"), ("ROM", "Romans"), ("1CO", "1 Corinthians"),
    ("2CO", "2 Corinthians"), ("GAL", "Galatians"), ("EPH", "Ephesians"),
    ("PHP", "Philippians"), ("COL", "Colossians"), ("1TH", "1 Thessalonians"),
    ("2TH", "2 Thessalonians"), ("1TI", "1 Timothy"), ("2TI", "2 Timothy"),
    ("TIT", "Titus"), ("PHM", "Philemon"), ("HEB", "Hebrews"), ("JAS", "James"),
    ("1PE", "1 Peter"), ("2PE", "2 Peter"), ("1JN", "1 John"), ("2JN", "2 John"),
    ("3JN", "3 John"), ("JUD", "Jude"), ("REV", "Revelation"),
]

TOKEN = re.compile(r"\{([A-Z]):([^}]*)\}")
REF = re.compile(r"^(\d{14})")


def norm(text):
    """Search key: strip pointing/accents, lowercase Greek, drop punctuation."""
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) not in ("Mn", "Mc", "Me"))
    text = text.lower().replace("ς", "σ")
    return re.sub(r"[\u05be\u05f3\u05f4\u200e\u200f]", "", text).strip()


def plain(text):
    """Strip dictionary markup, keeping the readable label."""
    if not text:
        return ""

    def repl(match):
        kind, body = match.group(1), match.group(2)
        if kind == "L":
            return body.split("<", 1)[0]
        if kind in ("A", "D"):
            return body
        return ""

    return TOKEN.sub(repl, text)


def clean_ref(raw):
    match = REF.match(raw or "")
    if not match:
        return None
    ref = match.group(1)
    book, chapter, verse = int(ref[0:3]), int(ref[3:6]), int(ref[6:9])
    if not (1 <= book <= 66 and chapter > 0 and verse >= 0):
        return None
    return ref


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def build_entry(raw, corpus):
    meanings = []
    for base in raw.get("BaseForms") or []:
        pos = ", ".join(p for p in (base.get("PartsOfSpeech") or []) if p)
        for meaning in base.get("LEXMeanings") or []:
            sense = next(
                (s for s in meaning.get("LEXSenses") or [] if s.get("LanguageCode") == "en"),
                None,
            )
            if sense is None:
                continue
            refs = []
            seen = set()
            for item in meaning.get("LEXReferences") or []:
                ref = clean_ref(item)
                if ref and ref not in seen:
                    seen.add(ref)
                    refs.append(ref)
            domains = [
                [d.get("DomainCode") or "", d.get("Domain") or ""]
                for d in meaning.get("LEXDomains") or []
                if d.get("DomainCode")
            ]
            subdomains = [
                [d.get("DomainCode") or "", d.get("Domain") or ""]
                for d in meaning.get("LEXSubDomains") or []
                if d.get("DomainCode")
            ]
            meanings.append({
                "id": meaning.get("LEXID") or "",
                "pos": pos,
                "code": meaning.get("LEXEntryCode") or "",
                "domains": domains,
                "subdomains": subdomains,
                "synonyms": [x for x in meaning.get("LEXSynonyms") or [] if isinstance(x, str) and x],
                "antonyms": [x for x in meaning.get("LEXAntonyms") or [] if isinstance(x, str) and x],
                "glosses": [g for g in sense.get("Glosses") or [] if g],
                "def": sense.get("DefinitionShort") or "",
                "defLong": sense.get("DefinitionLong") or "",
                "comments": sense.get("Comments") or "",
                "refs": refs,
            })
    notes = []
    for note in raw.get("Notes") or []:
        if note.get("LanguageCode") not in ("en", ""):
            continue
        note_refs = []
        seen = set()
        for item in note.get("References") or []:
            ref = clean_ref(item)
            if ref and ref not in seen:
                seen.add(ref)
                note_refs.append(ref)
        notes.append({
            "caller": note.get("Caller") or 0,
            "content": note.get("Content") or "",
            "refs": note_refs,
        })
    lemma = raw.get("Lemma") or ""
    return {
        "id": raw["MainId"],
        "corpus": corpus,
        "lemma": lemma,
        "lemmaNorm": norm(lemma),
        "alphaPos": raw.get("AlphaPos") or "",
        "strong": [x for x in raw.get("StrongCodes") or [] if x],
        "alt": [x for x in raw.get("AlternateLemmas") or [] if x],
        "version": raw.get("Version") or "",
        "notes": notes,
        "meanings": meanings,
    }


def build_domains(raw_domains):
    domains = []
    for node in raw_domains:
        local = next(
            (l for l in node.get("SemanticDomainLocalizations") or [] if l.get("LanguageCode") == "en"),
            None,
        )
        if local is None:
            continue
        code = node.get("Code") or ""
        domains.append({
            "code": code,
            "level": node.get("Level") or 0,
            "label": local.get("Label") or "",
            "desc": local.get("Description") or "",
            "parent": code[:-3] if len(code) > 3 else None,
        })
    return domains


def dump(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default="../ubs-open-license", help="path to the data repo")
    parser.add_argument("--out", default="dist", help="output directory")
    args = parser.parse_args()

    repo = os.path.abspath(args.repo)
    out = os.path.abspath(args.out)
    data_dir = os.path.join(out, "data")
    if os.path.isdir(data_dir):
        shutil.rmtree(data_dir)

    src_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "src")
    os.makedirs(out, exist_ok=True)
    for name in ("index.html", "app.js", "style.css", "favicon.svg"):
        shutil.copyfile(os.path.join(src_dir, name), os.path.join(out, name))

    index = []
    meta = {}
    total_refs = 0

    for corpus, cfg in SOURCES.items():
        entry_path = os.path.join(repo, cfg["entries"])
        domain_path = os.path.join(repo, cfg["domains"])
        for path in (entry_path, domain_path):
            if not os.path.isfile(path):
                sys.exit("missing source file: %s" % path)

        raw_entries = load(entry_path)
        if len(raw_entries) != cfg["expect_entries"]:
            sys.exit("%s: expected %d entries, found %d"
                     % (corpus, cfg["expect_entries"], len(raw_entries)))

        entries = []
        meanings_count = 0
        refs_count = 0
        for raw in raw_entries:
            entry = build_entry(raw, corpus)
            entries.append(entry)
            meanings_count += len(entry["meanings"])
            refs_count += sum(len(m["refs"]) for m in entry["meanings"])
            index.append([
                entry["id"],
                corpus,
                entry["lemma"],
                entry["lemmaNorm"],
                " ".join(entry["alt"]),
                " ".join(entry["strong"]),
                " \u00b7 ".join(g for m in entry["meanings"] for g in m["glosses"]),
                " ".join(plain(m["def"]) for m in entry["meanings"] if m["def"]),
            ])

        if meanings_count != cfg["expect_meanings"]:
            sys.exit("%s: expected %d meanings, found %d"
                     % (corpus, cfg["expect_meanings"], meanings_count))
        if refs_count != cfg["expect_refs"]:
            sys.exit("%s: expected %d refs, found %d"
                     % (corpus, cfg["expect_refs"], refs_count))
        total_refs += refs_count

        entry_dir = os.path.join(data_dir, corpus, "entries")
        os.makedirs(entry_dir, exist_ok=True)
        for entry in entries:
            dump(os.path.join(entry_dir, entry["id"] + ".json"), entry)

        domains = build_domains(load(domain_path))
        if len(domains) != cfg["expect_domains"]:
            sys.exit("%s: expected %d domains, found %d"
                     % (corpus, cfg["expect_domains"], len(domains)))
        codes = {d["code"] for d in domains}
        for node in domains:
            if node["parent"] and node["parent"] not in codes:
                node["parent"] = None

        domain_entries = {}
        skipped = {}
        for entry in entries:
            for meaning in entry["meanings"]:
                for code, _label in meaning["domains"] + meaning["subdomains"]:
                    if code in codes:
                        domain_entries.setdefault(code, set()).add(entry["id"])
                    else:
                        skipped[code or "(empty)"] = skipped.get(code or "(empty)", 0) + 1
        if skipped:
            print("warning: %s: skipped unknown domain codes %s"
                  % (corpus, ", ".join("%s x%d" % item for item in sorted(skipped.items()))),
                  file=sys.stderr)
        domain_entries = {
            code: sorted(ids) for code, ids in sorted(domain_entries.items())
        }

        dump(os.path.join(data_dir, corpus, "domains.json"), domains)
        dump(os.path.join(data_dir, corpus, "domain-entries.json"), domain_entries)

        meta[corpus] = {
            "label": cfg["label"],
            "version": cfg["version"],
            "source": cfg["entries"],
            "entries": len(entries),
            "meanings": meanings_count,
            "refs": refs_count,
            "domains": len(domains),
        }
        print("%s: %d entries, %d meanings, %d refs, %d domains"
              % (corpus, len(entries), meanings_count, refs_count, len(domains)))

    dump(os.path.join(data_dir, "search.json"), index)
    dump(os.path.join(data_dir, "books.json"), [[u, n] for u, n in BOOKS])
    dump(os.path.join(data_dir, "meta.json"), {
        "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"),
        "license": "CC BY-SA 4.0",
        "attribution": (
            "Dictionary content \u00a9 United Bible Societies, licensed under "
            "CC BY-SA 4.0. UBS Dictionary of Biblical Hebrew is adapted from the "
            "Semantic Dictionary of Biblical Hebrew; UBS Dictionary of the Greek "
            "New Testament is adapted from the Semantic Dictionary of Biblical Greek."
        ),
        "corpora": meta,
    })

    search_size = os.path.getsize(os.path.join(data_dir, "search.json"))
    print("wrote %s: %d search rows, index %.1f MB, %d refs total"
          % (out, len(index), search_size / 1e6, total_refs))
    print("run: python3 -m http.server -d %s 8000" % args.out)


if __name__ == "__main__":
    main()
