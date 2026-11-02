# Additional terms

EdenText is licensed under the GNU Affero General Public License, version 3 only
(AGPL-3.0-only), see [`LICENSE`](./LICENSE). Under section 7(b) of that license, the
additional term below applies to every version of EdenText released after 0.13.0. It
covers all material in this repository whose copyright Steffen Becker holds or which he
may license under the contributor license agreement ([`CLA.md`](./CLA.md)). It is part
of the license of that material and applies to every copy and every modified version of
it.

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

## Commercial license

Holders of a separate commercial license from the copyright holder
([`LICENSE.commercial.md`](./LICENSE.commercial.md)) are exempt from this term as far as
that license provides. The build setting `VITE_EDENTEXT_ATTRIBUTION=off` exists for them;
under the AGPL alone it may not be used for a build that runs in embed mode.

## Earlier versions

Versions up to and including 0.13.0 were released under the AGPL-3.0-only without this
term.
