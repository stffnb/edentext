# Additional terms

EdenText is licensed under the GNU Affero General Public License, version 3 only
(AGPL-3.0-only), see [`LICENSE`](./LICENSE). Under section 7(b) of that license, the
additional term below applies to every version of EdenText released after 0.13.0. It
covers all material in this repository whose copyright Steffen Becker holds or which he
may license under the contributor license agreement ([`CLA.md`](./CLA.md)), except the
files named under [Embed helper and npm tooling](#embed-helper-and-npm-tooling). It is
part of the license of that material and applies to every copy and every modified version
of it.

## Author attribution in embed mode

When the material runs in embed mode, it displays these author attributions:

1. the text **“Powered by EdenText”**, linked to `https://stffnb.github.io/edentext/`, and
2. the **EdenText logo**.

“Embed mode” means any use in which the editor is shown as part of another program or
web page. It includes opening the editor with the `embed` URL parameter, as
`public/embed.js` does.

Every copy and every modified version of the material that runs in embed mode must
preserve both author attributions:
- they must stay displayed to the user, legible and unaltered;
- they must be shown where the unmodified material shows them, or in an equally visible
  place;
- they may not be removed, hidden, covered or changed.

This is a requirement to preserve author attributions within the meaning of section 7(b)
of the AGPL. It does not restrict any other right the AGPL grants.

## Embed helper and npm tooling

These files are under neither the AGPL nor the term above. Their copyright holder,
Steffen Becker, licenses them under the MIT License ([`packages/LICENSE`](./packages/LICENSE)):

- `public/embed.js` and `public/embed.d.ts`, the helper a host page loads;
- every file in `packages/embed/` and `packages/app/`: the custom element, the React
  component, the copy tool and the Vite plugin.

They are the parts that run in a host's own page or build. As published on npm, that is
all of `@edentext/embed` and `edentext`, and in `@edentext/app` every file outside its
`dist/` folder other than the license and notice files. The `dist/` folder is the
editor: it stays under the AGPL with the term above, the copy of the helper in it stays
under the MIT License, and its fonts and language data keep their own licenses.

## Host applications

A “host” is a program or web page that shows the editor in an iframe and exchanges data
with it only through messages, as `docs/architecture/embed.md` describes, whether it
uses the helper or code of its own.

The copyright holder treats a host as a work separate from the editor. For the material
this notice covers, he grants the following as an additional permission under section 7
of the AGPL, as far as a permission is needed: neither the AGPL nor the term above
applies to a host's own code because the host shows and drives the editor. This holds
whatever license the host has, and also when host and editor are served from the same
server or the same origin or are delivered together.

Nothing in this section changes the terms of the editor itself. Every copy of it that
the host's operator serves or passes on stays under the AGPL and the term above: it keeps
its license files and its author attributions, and a modified version offers its source
to its users as section 13 of the AGPL requires. Third-party components keep their own
terms ([`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md)).

## Commercial license

Holders of a separate commercial license from the copyright holder
([`LICENSE.commercial.md`](./LICENSE.commercial.md)) are exempt from this term as far as
that license provides. The build setting `VITE_EDENTEXT_ATTRIBUTION=off` exists for them;
under the AGPL alone it may not be used for a build that runs in embed mode.

## Earlier versions

Versions up to and including 0.13.0 were released under the AGPL-3.0-only without this
term. Version 0.14.0 released the embed helper under the AGPL with the term; the MIT
License and the section on host applications apply to every later version.
