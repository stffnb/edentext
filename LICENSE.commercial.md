# Commercial License

EdenText is **dual-licensed**.

## 1. Open-source license (default)

By default, this software is licensed under the **GNU Affero General Public License
v3.0 (AGPL-3.0-only)** — see [`LICENSE`](./LICENSE). You may use, modify, and
distribute it for free under those terms.

The AGPL is a strong copyleft license. Among other things, it requires that **if
you run a modified version and make it available to users over a network, you must
make the complete corresponding source code of your version available to those
users.** It also requires that derivative works you distribute be licensed under
the AGPL as well.

## 2. When you may want a commercial license

The AGPL may be incompatible with your needs if you want to:

- embed this editor in a **proprietary / closed-source** product or service,
- distribute a modified version **without** releasing your source code,
- offer it as part of a **hosted/SaaS** product without the AGPL's network-source
  obligations, or
- obtain a warranty, indemnification, or commercial support, or
- run the editor in its **embed mode** without the EdenText logo and the “Powered by
  EdenText” notice that the additional term in [`NOTICE.md`](./NOTICE.md) requires under
  the AGPL.

For these cases, a **separate commercial license** is available that removes the
copyleft obligations of the AGPL and the attribution requirement, under negotiated
terms.

## 3. What a commercial license does not cover

A commercial license covers the copyright holder's own work. It cannot change the
terms of third-party components, which keep their own licenses either way —
[`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) lists them all. Three points
matter for a proprietary distribution:

- The **fonts** (SIL Open Font License 1.1, and a Bitstream Vera-licensed subset)
  may be bundled in proprietary software, provided their license files travel
  with them.
- The **shape preset table** (`src/lib/utils/shapePresets.json`, derived from
  LibreOffice) is under the **MPL-2.0** and compiled into the app. Its copyleft
  covers that file alone: its notice has to stay and its own source, with any
  change to it, has to remain available; the rest of the product is unaffected.
- The bundled **language data** is not the copyright holder's to relicense. These
  sets are available only under copyleft terms:
  - the German dictionary (igerman98): GPL-2.0 or GPL-3.0;
  - the Italian dictionary and thesaurus: GPL-3.0;
  - the Ukrainian dictionary: GPL-3.0;
  - the Portuguese thesaurus: CC-BY-3.0 and GPL-2.0-or-later data.

  The other sets are permissive or offer LGPL or MPL terms; the table in
  [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) lists each one. All of them
  are separate data files that the app loads at runtime, not part of its code, so a
  proprietary distribution may keep them under their own terms or omit the folder
  (`public/dictionaries/<code>`, `public/thesaurus/<code>`). The app then offers no
  spell check or synonyms for that language.

## 4. How to obtain a commercial license

Commercial licenses (including subscription terms for organisations) are granted
by the copyright holder on request.

**Contact:** Steffen Becker — stffn.becker@gmail.com

> _This document describes the availability of a commercial license; it is not
> itself the commercial license contract. The actual terms, pricing, and
> subscription conditions are set out in a separate agreement._
