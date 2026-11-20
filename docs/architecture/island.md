# The island

The modern chrome: a floating overlay above the document, the alternative to `ribbon.md`'s docked
ribbon (`chromeMode`). It reaches every ribbon command, in its own layout of two rows.
Still a beta: only a development build offers it in *Settings* (see `ribbon.md`).

## Rows and categories

Row 1 (`Toolbar.svelte`, the App
header) holds the basics: marks with their line styles, font, size, colours, styles, lists,
alignment, undo, the command search and the File buttons. The Tools row (`ToolbarExpanded.svelte`)
shows one category at a time, named and keyed like the ribbon's tabs (`toolbar/island.ts`), each a
component in `toolbar/`; the open category persists as `edentext-toolbar-category`.

Menus are `toolbar/IslandMenu.svelte` on the ribbon's single open-menu id (`ribbon/menu.svelte.ts`).
Panels are `position: absolute`, not `anchored`: `.toolbar-stack` is transformed, so a fixed panel
would resolve against it; `keepInView` slides one back inside the window instead. Panel rows use
the global `.island-menu` classes in `styles/global.css`. The toolbar's own scroll offset (`tbScroll`,
`App.svelte`) counts from the stack's start edge, so stack, track and thumb move by `tbSign`.

Controls carry the ribbon's `data-cmd` ids, so `CommandSearch` (variant `island`) runs on the same
index. `App.svelte` finds a hit's control; when it is not on screen it opens the Tools row on the
command's category, then clicks the menu that holds it (`islandVia`, `ISLAND_PLACE`) and the
control. Context-tab commands live on the floating table, picture and text-box toolbars, which
both chromes share. `RIBBON_ONLY` lists the ids that have no island control by design.
