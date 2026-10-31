# World map source

- Dataset: Natural Earth 1:110m Admin 0 Countries.
- Original: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/9380cca83db5f9aef52d5e762765100745f84b27/geojson/ne_110m_admin_0_countries.geojson
- Upstream revision: `9380cca83db5f9aef52d5e762765100745f84b27`.
- Downloaded source SHA-256: `6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f`.
- Terms: https://www.naturalearthdata.com/about/terms-of-use/
- License: public domain, including localized country names.

The browser bundle contains 176 geographic features with Russian labels and country identifiers. Antarctica is omitted. At this overview scale some small states and islands are absent from the upstream dataset; a destination list must remain available as an alternative to map selection. Two upstream disputed-area features without an ISO alpha-2 code retain explicit internal identifiers (`CY-N` and `SO-L`); those identifiers are not service destinations. Boundaries represent the source dataset and are used only for geographic navigation.

Projection: equirectangular, with `(x, y) = (500 + 2.65 * longitude, 260 - 2.65 * latitude)`, on a 1000 × 520 viewBox. Coordinates are rounded to two decimals. Polygon rings, islands, and holes are preserved; set SVG `fill-rule="evenodd"` when rendering. Label anchor points come from the upstream LABEL_X/LABEL_Y coordinates.

This precomputed ES module needs no map service, API key, external requests, or JavaScript library at runtime.
